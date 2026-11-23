import { z } from "zod";
import { snapshotSchema, topicId } from "@/lib/topic-map";
import type { TopicCommand } from "@/lib/topic-map";
import type { TreeSource } from "@/lib/tree-source";

const anchorSchema = z.object({
  topic_id: topicId,
  seq: z.number().int(),
  entry_id: z.string(),
});
const commandResultSchema = z.object({ topic_id: topicId });
const errorSchema = z.object({ error: z.string() });

export function readOctoToken(): string | null {
  const passed = new URLSearchParams(location.hash.slice(1)).get("token");
  if (passed) {
    sessionStorage.setItem("octo-map-token", passed);
    history.replaceState(null, "", location.pathname + location.search);
  }
  return passed || sessionStorage.getItem("octo-map-token");
}

export function octoSource(token: string): TreeSource {
  async function request(path: string, command?: TopicCommand): Promise<unknown> {
    const response = await fetch(path, {
      method: command ? "POST" : "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: {
        "X-Octo-Token": token,
        ...(command ? { "Content-Type": "application/json" } : {}),
      },
      body: command ? JSON.stringify(command) : undefined,
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const parsed = errorSchema.safeParse(payload);
      throw new Error(
        parsed.success ? parsed.data.error : "无法连接 Octo，请在终端输入 /map。",
      );
    }
    return response.json();
  }

  return {
    kind: "topics",
    name: "Octo",
    async readSnapshot(query = {}) {
      const params = new URLSearchParams();
      if (query.topic) params.set("topic_id", query.topic);
      if (query.before !== undefined) params.set("before", String(query.before));
      if (query.after !== undefined) params.set("after", String(query.after));
      return snapshotSchema.parse(await request(`/api/snapshot?${params}`));
    },
    async locateEntry(entry) {
      const params = new URLSearchParams({ entry_id: entry });
      return anchorSchema.parse(await request(`/api/anchor?${params}`));
    },
    async editTopic(command) {
      return commandResultSchema.parse(await request("/api/topics", command)).topic_id;
    },
    watch(onChange, onDisconnect) {
      const params = new URLSearchParams({ token });
      const stream = new EventSource(`/api/events?${params}`);
      stream.onmessage = onChange;
      stream.onerror = () => onDisconnect("终端连接已断开，正在重新连接…");
      return () => stream.close();
    },
  };
}
