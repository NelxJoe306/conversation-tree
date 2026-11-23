import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readJsonLines } from "../host/json-lines";
import type { HostEntry, HostTurn, SessionHost } from "../host/session-host";

const headerSchema = z.object({ id: z.string().min(1), cwd: z.string().nullish() });
const eventSchema = z.object({
  seq: z.number().int().nonnegative(), time: z.number(), type: z.string(),
  data: z.record(z.string(), z.unknown()), surfaceOp: z.unknown().optional(),
});
const logSchema = z.object({ session: headerSchema, events: z.array(eventSchema) });
const textBlockSchema = z.object({ type: z.string(), text: z.string().optional() });
const contentSchema = z.array(textBlockSchema.extend({ content: z.array(textBlockSchema).optional() }));
const messageSchema = z.object({ content: contentSchema, source: z.object({ kind: z.string() }).optional() });
const completedReason = z.object({ kind: z.literal("completed") });

type DshConnection = {
  readSession(sessionId: string): Promise<unknown>;
  fork?(params: { sessionId: string; atSeq: number; allowMigration: false }): Promise<unknown>;
};

function project(log: z.infer<typeof logSchema>) {
  const turns: HostTurn[] = [];
  const cuts = new Map<string, number>();
  let current: HostTurn | undefined;
  let title = "DeepSeek Harness 会话";
  for (const event of log.events) {
    const append = event.surfaceOp === undefined || event.surfaceOp === "append";
    const turn = event.data.turn;
    if (event.type === "session/title" && typeof event.data.title === "string") title = event.data.title;
    if (event.type === "turn/start") {
      current = { id: String(event.seq), entries: [], completed: false };
      turns.push(current);
    }
    if (!current) continue;
    if (event.type === "turn/end" && typeof turn === "number") {
      current.completed = completedReason.safeParse(event.data.reason).success;
      if (current.completed) cuts.set(current.id, event.seq);
      current = undefined;
      continue;
    }
    let entry: Pick<HostEntry, "role" | "text"> | undefined;
    if (event.type === "user/message" && append) {
      const message = messageSchema.safeParse(event.data);
      if (message.success && message.data.source?.kind === "user") {
        entry = { role: "user", text: message.data.content.map((part) => part.text ?? "（附件）").join("\n") };
      }
    } else if (append && (event.type === "assistant/message" || event.type === "tool/result")) {
      const message = messageSchema.safeParse(event.data.message);
      const blocks = message.success ? message.data.content : [];
      const text = blocks.flatMap((part) => part.type === "tool-result" ? part.content ?? [] : [part])
        .filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
      if (text || event.type === "tool/result") entry = { role: event.type === "tool/result" ? "tool" : "assistant", text };
    } else if (event.type === "tool/call" && typeof event.data.name === "string") {
      entry = { role: "tool", text: event.data.name };
    }
    if (entry) current.entries.push({ ...entry, id: String(event.seq), timestamp: event.time / 1000 });
  }
  return { session: { id: log.session.id, title, cwd: log.session.cwd ?? undefined, turns }, cuts };
}

export function dshHost(connection: DshConnection): SessionHost {
  async function read(id: string) {
    const log = logSchema.parse(await connection.readSession(id));
    if (log.session.id !== id) throw new Error("DSH 返回了另一个会话。");
    return project(log);
  }
  const fork = connection.fork;
  return {
    name: "DSH",
    async readSession(id) { return (await read(id)).session; },
    ...(fork && {
      async forkAtTurn(id: string, turn: string) {
        const cut = (await read(id)).cuts.get(turn);
        if (cut === undefined) throw new Error("DSH 找不到已完成轮次的切点。");
        const response = await fork({ sessionId: id, atSeq: cut, allowMigration: false });
        return z.object({ sessionId: z.string().min(1) }).parse(response).sessionId;
      },
    }),
  };
}

export function dshFileHost(path: string): SessionHost {
  return dshHost({ async readSession() {
    if (path.endsWith(".json")) return JSON.parse(await readFile(path, "utf8"));
    if (!path.endsWith(".jsonl")) throw new Error("请指定 DSH 会话快照 JSON 或解压后的 JSONL 日志。");
    const [header, ...events] = await readJsonLines(path);
    const session = headerSchema.extend({ type: z.literal("session"), version: z.union([z.literal(2), z.literal(3), z.literal(4)]) }).parse(header);
    return { session, events };
  } });
}
