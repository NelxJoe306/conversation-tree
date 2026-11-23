import { z } from "zod";
import type { HostEntry, HostTurn, SessionHost } from "../host/session-host";
import { RpcError, stdioRpc } from "../host/rpc";
import type { RpcCall } from "../host/rpc";

const itemSchema = z.object({
  id: z.string(), type: z.string(), text: z.string().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  name: z.string().optional(), command: z.string().optional(),
  aggregatedOutput: z.string().nullish(),
});
const turnSchema = z.object({
  id: z.string(), status: z.string(), startedAt: z.number().nullish(), items: z.array(z.unknown()),
});
const threadSchema = z.object({ thread: z.object({
  id: z.string().min(1), name: z.string().nullish(), cwd: z.string().optional(), turns: z.array(turnSchema).optional(),
}) });
const pageSchema = z.object({ data: z.array(turnSchema), nextCursor: z.string().nullish() });

function project(turn: z.infer<typeof turnSchema>): HostTurn {
  const entries: HostEntry[] = [];
  for (const raw of turn.items) {
    const parsed = itemSchema.safeParse(raw);
    if (!parsed.success) continue;
    const item = parsed.data;
    const base = { id: item.id, timestamp: turn.startedAt ?? undefined };
    switch (item.type) {
      case "userMessage":
        entries.push({ ...base, role: "user", text: item.content?.map((part) => part.text ?? "（附件）").join("\n") ?? "" });
        break;
      case "agentMessage":
        entries.push({ ...base, role: "assistant", text: item.text ?? "" });
        break;
      case "commandExecution":
        entries.push({ ...base, role: "tool", text: [item.command, item.aggregatedOutput].filter(Boolean).join("\n") });
        break;
      case "fileChange":
      case "mcpToolCall":
      case "dynamicToolCall":
        entries.push({ ...base, role: "tool", text: item.name ?? item.type });
        break;
    }
  }
  return { id: turn.id, completed: turn.status === "completed", entries };
}

function resumeId(id: string) {
  if (!/^[\w-]+$/u.test(id)) throw new Error("Codex 会话 ID 格式无效。");
  return id;
}

export function codexHost(call: RpcCall, executable = "codex"): SessionHost {
  const command = /^[\w.-]+$/u.test(executable)
    ? executable
    : process.platform === "win32"
      ? `& '${executable.replaceAll("'", "''")}'`
      : `'${executable.replaceAll("'", "'\\''")}'`;
  return {
    name: "Codex",
    async readSession(id) {
      const { thread } = threadSchema.parse(await call("thread/read", { threadId: id }));
      const turns = new Map<string, HostTurn>();
      const seen = new Set<string>();
      let cursor: string | undefined;
      try {
        do {
          const page = pageSchema.parse(await call("thread/turns/list", {
            threadId: id, cursor, limit: 50, itemsView: "full", sortDirection: "asc",
          }));
          for (const turn of page.data) turns.set(turn.id, project(turn));
          cursor = page.nextCursor ?? undefined;
          if (cursor && seen.has(cursor)) throw new Error("Codex 返回了重复的历史游标。");
          if (cursor) seen.add(cursor);
        } while (cursor);
      } catch (error) {
        if (cursor || !(error instanceof RpcError) || ![-32601, -32602].includes(error.code)) throw error;
        const legacy = threadSchema.parse(await call("thread/read", { threadId: id, includeTurns: true }));
        if (legacy.thread.id !== id || !legacy.thread.turns) throw error;
        for (const turn of legacy.thread.turns) turns.set(turn.id, project(turn));
      }
      return { id: thread.id, title: thread.name || thread.id, cwd: thread.cwd, turns: [...turns.values()] };
    },
    resumeCommand: (session) => `${command} resume ${resumeId(session.id)}`,
    async forkAtTurn(id, turn) {
      const response = await call("thread/fork", { threadId: id, lastTurnId: turn, excludeTurns: true });
      return threadSchema.parse(response).thread.id;
    },
  };
}

export async function connectCodex(executable: string) {
  const rpc = stdioRpc(executable, ["app-server", "--listen", "stdio://"]);
  try {
    await rpc.call("initialize", { clientInfo: { name: "conversation-tree", version: "0.1.0" } });
    rpc.notify("initialized");
    return { host: codexHost(rpc.call, executable), close: rpc.close };
  } catch (error) {
    rpc.close();
    throw error;
  }
}
