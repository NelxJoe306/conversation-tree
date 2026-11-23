import { z } from "zod";
import { messageSchema, snapshotSchema, topicId } from "../lib/topic-map";
import type { Snapshot, TopicId } from "../lib/topic-map";
import type { SnapshotQuery } from "../lib/tree-source";

export type HostEntry = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  timestamp?: number;
};

export type HostTurn = {
  id: string;
  entries: HostEntry[];
  completed: boolean;
};

export type HostSession = {
  id: string;
  title: string;
  cwd?: string;
  turns: HostTurn[];
};

export interface SessionHost {
  name: string;
  readSession(id: string): Promise<HostSession>;
  resumeCommand?(session: HostSession): string;
  forkAtTurn?(sessionId: string, turnId: string): Promise<string>;
}

export const linkSchema = z.object({
  child: topicId,
  parent: topicId,
  turn: z.string().min(1),
  inheritedTurns: z.number().int().positive(),
});
export type SessionLink = z.infer<typeof linkSchema>;

export interface LineageStore {
  read(): Promise<SessionLink[]>;
  add(link: SessionLink): Promise<void>;
}

const PAGE_SIZE = 60;
const entryKey = (session: string, turn: string, entry: string) =>
  JSON.stringify([session, turn, entry]);
const turnKey = (session: string, id: string) => JSON.stringify([session, id]);

export function sessionTree(host: SessionHost, rootId: TopicId, lineage: LineageStore) {
  let forking = false;

  async function graph() {
    const links = await lineage.read();
    const byId = new Map<TopicId, SessionLink | null>([[rootId, null]]);
    for (const link of links) {
      if (byId.has(link.child)) throw new Error("会话分支 ID 重复。");
      byId.set(link.child, link);
    }
    for (const id of byId.keys()) {
      const visited = new Set<TopicId>();
      let next = id;
      while (next !== rootId) {
        const link = byId.get(next);
        if (!link || visited.has(next)) throw new Error("会话分支的父子关系无效。");
        visited.add(next);
        next = link.parent;
      }
    }
    const sessions = new Map<TopicId, HostSession>();
    for (const id of byId.keys()) {
      const session = await host.readSession(id);
      if (session.id !== id) throw new Error("宿主返回了另一个会话。");
      sessions.set(id, session);
    }
    return { byId, sessions };
  }

  async function project() {
    const { byId, sessions } = await graph();
    const topics = [];
    const turns = [];
    const messages = new Map<TopicId, Snapshot["messages"]>();
    const entries = new Map<string, { topic_id: TopicId; entry_id: string; seq: number }>();
    const labels = new Map<TopicId, string>([[rootId, "主干"]]);
    for (const [index, id] of [...sessions.keys()].entries()) {
      if (id !== rootId) labels.set(id, `分支 ${index}`);
    }
    for (const [id, session] of sessions) {
      const link = byId.get(id);
      if (link && session.turns.length < link.inheritedTurns) {
        throw new Error("宿主分支的继承历史与该分支的起点不一致。");
      }
      const ownTurns = session.turns.slice(link?.inheritedTurns ?? 0);
      const parentTurn = link && sessions.get(link.parent)?.turns.find((turn) => turn.id === link.turn);
      const anchor = link && parentTurn?.entries.at(-1);
      const anchorId = link && anchor ? entryKey(link.parent, link.turn, anchor.id) : null;
      let parent = link && parentTurn ? turnKey(link.parent, link.turn) : null;
      let seq = 0;
      const records = [];
      for (const [index, turn] of ownTurns.entries()) {
        const idOfTurn = turnKey(id, turn.id);
        const turnEntries = turn.entries.map((entry) => ({
          ...entry,
          id: entryKey(id, turn.id, entry.id),
          seq: ++seq,
          timestamp: entry.timestamp ?? null,
          request_id: idOfTurn,
        }));
        const first = turnEntries[0];
        const last = turnEntries.at(-1);
        if (!first || !last) continue;
        for (const entry of turnEntries) {
          entries.set(entry.id, { topic_id: id, entry_id: entry.id, seq: entry.seq });
        }
        records.push(...turnEntries);
        turns.push({
          id: idOfTurn, topic_id: id, first_entry_id: first.id, last_entry_id: last.id,
          first_seq: first.seq, title: (turnEntries.find((entry) => entry.role === "user")?.text ?? "会话轮次").slice(0, 150),
          message_count: turnEntries.length, parent_turn_id: parent,
          entry_ids: turnEntries.map((entry) => entry.id), number: index + 1,
          forkable: Boolean(host.forkAtTurn && turn.completed),
        });
        parent = idOfTurn;
      }
      messages.set(id, z.array(messageSchema).parse(records));
      topics.push({
        id, title: session.title, parent_id: link?.parent ?? null, anchor_entry_id: anchorId,
        kind: link ? "branch" : "trunk", branch_label: labels.get(id),
        parent_label: link ? labels.get(link.parent) : null,
        latest_entry_id: records.at(-1)?.id ?? null, message_count: records.length,
      });
    }
    return { topics, turns, messages, entries, title: sessions.get(rootId)?.title ?? host.name };
  }

  return {
    name: host.name,
    open: Boolean(host.resumeCommand),
    fork: Boolean(host.forkAtTurn),
    async snapshot(query: SnapshotQuery = {}): Promise<Snapshot> {
      const graph = await project();
      const id = query.topic ?? rootId;
      const all = graph.messages.get(id);
      if (!all) throw new Error("Unknown topic");
      const { before = Infinity, after } = query;
      const page = after === undefined
        ? all.filter((entry) => entry.seq < before).slice(-PAGE_SIZE)
        : all.filter((entry) => entry.seq > after).slice(0, PAGE_SIZE);
      const first = page[0]?.seq ?? null;
      const last = page.at(-1)?.seq ?? after ?? null;
      return snapshotSchema.parse({
        session_id: rootId, title: graph.title, topics: graph.topics, turns: graph.turns,
        selected_topic_id: rootId, viewed_topic_id: id, active_topic_id: null, running: false,
        messages: page, before: first, after: last,
        has_more: first !== null && first > 1,
        has_newer: last !== null && last < all.length,
      });
    },
    async locate(entry: string) {
      const found = (await project()).entries.get(entry);
      if (!found) throw new Error("找不到该条记录。");
      return found;
    },
    async resume(id: TopicId) {
      if (!host.resumeCommand) throw new Error("此连接未提供续聊命令。");
      const session = (await graph()).sessions.get(id);
      if (!session) throw new Error("会话不在当前树内。");
      return { command: host.resumeCommand(session) };
    },
    async forkAt(id: TopicId, turn: string) {
      if (!host.forkAtTurn) throw new Error("此连接未提供原生分叉。");
      if (forking) throw new Error("已有分叉操作正在进行。");
      forking = true;
      try {
        const { byId, sessions } = await graph();
        const session = sessions.get(id);
        const index = session?.turns.findIndex((item) => turnKey(id, item.id) === turn) ?? -1;
        const target = session?.turns[index];
        if (!target?.completed || index < (byId.get(id)?.inheritedTurns ?? 0)) {
          throw new Error("请从当前会话中已完成的轮次分叉。");
        }
        const child = topicId.parse(await host.forkAtTurn(id, target.id));
        if (sessions.has(child)) throw new Error("宿主未返回新会话 ID。");
        try {
          await lineage.add({ child, parent: id, turn: target.id, inheritedTurns: index + 1 });
        } catch {
          throw new Error(`宿主已建立会话 ${child}。分支索引保存失败，请用该 ID 打开新会话。`);
        }
        return { topic_id: child };
      } finally {
        forking = false;
      }
    },
  };
}
