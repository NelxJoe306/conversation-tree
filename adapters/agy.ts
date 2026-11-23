import { z } from "zod";
import { readJsonLines } from "../host/json-lines";
import type { HostTurn, SessionHost } from "../host/session-host";

const stepSchema = z.object({
  step_index: z.number().int().nonnegative(),
  type: z.string(), source: z.string(), status: z.string(),
  created_at: z.string().optional(), content: z.string().optional(),
  tool_calls: z.array(z.object({ name: z.string() })).optional(),
});

export function agyHost({ id, path, title }: { id: string; path: string; title?: string }): SessionHost {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(id)) {
    throw new Error("AGY 需要有效的 conversation ID。");
  }
  return {
    name: "AGY",
    async readSession(sessionId) {
      if (sessionId !== id) throw new Error("该 AGY 会话未连接。");
      const rows = await readJsonLines(path);
      const steps = new Map<number, z.infer<typeof stepSchema>>();
      for (const raw of rows) {
        const step = stepSchema.parse(raw);
        steps.set(step.step_index, step);
      }
      const turns: HostTurn[] = [];
      let current: HostTurn | undefined;
      for (const step of [...steps.values()].sort((a, b) => a.step_index - b.step_index)) {
        const time = Date.parse(step.created_at ?? "");
        const timestamp = Number.isFinite(time) ? time / 1000 : undefined;
        const key = String(step.step_index);
        if (step.type === "USER_INPUT" && step.source === "USER_EXPLICIT") {
          current = { id: key, completed: false, entries: [{ id: key, role: "user", text: step.content ?? "", timestamp }] };
          turns.push(current);
        } else if (current && step.type === "PLANNER_RESPONSE" && step.source === "MODEL") {
          if (step.content) current.entries.push({ id: key, role: "assistant", text: step.content, timestamp });
          for (const [index, tool] of (step.tool_calls ?? []).entries()) {
            current.entries.push({ id: `${key}.${index}`, role: "tool", text: tool.name, timestamp });
          }
          current.completed = step.status === "DONE" && Boolean(step.content) && !step.tool_calls?.length;
        }
      }
      return { id, title: title ?? "Antigravity 会话", turns };
    },
    resumeCommand: () => `agy --conversation ${id}`,
  };
}
