import { z } from "zod";
import { snapshotSchema, topicId } from "../lib/topic-map";
import type { TreeSource } from "../lib/tree-source";

const prefix = "/api/tree/v1";
const capabilitySchema = z.object({
  version: z.literal(1), name: z.string(), open: z.boolean(), fork: z.boolean(),
});
const anchorSchema = z.object({ topic_id: topicId, seq: z.number().int(), entry_id: z.string() });
const errorSchema = z.object({ error: z.string() });

export async function browserHostSource(): Promise<TreeSource> {
  const fragment = new URLSearchParams(location.hash.slice(1)).get("token");
  const token = fragment ?? sessionStorage.getItem("host-tree-token");
  if (!token) throw new Error("请通过宿主连接生成的完整地址打开对话树。");
  const headers = { "X-Tree-Token": token };
  if (fragment) {
    sessionStorage.setItem("host-tree-token", fragment);
    history.replaceState(null, "", location.pathname + location.search);
  }

  async function request(path: string, body?: object): Promise<unknown> {
    const response = await fetch(prefix + path, {
      method: body ? "POST" : "GET", cache: "no-store", credentials: "omit", redirect: "error",
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return payload;
    const error = errorSchema.safeParse(payload);
    throw new Error(error.success ? error.data.error : "读取宿主失败，请检查连接进程。");
  }

  const capabilities = capabilitySchema.parse(await request(""));
  return {
    kind: "sessions",
    name: capabilities.name,
    async readSnapshot({ topic, before, after } = {}) {
      const params = new URLSearchParams();
      if (topic) params.set("topic", topic);
      if (before !== undefined) params.set("before", String(before));
      if (after !== undefined) params.set("after", String(after));
      return snapshotSchema.parse(await request(`/snapshot?${params}`));
    },
    async locateEntry(entry) {
      const params = new URLSearchParams({ entry });
      return anchorSchema.parse(await request(`/anchor?${params}`));
    },
    ...(capabilities.open && {
      async resume(topic: z.infer<typeof topicId>) {
        const params = new URLSearchParams({ topic });
        return z.object({ command: z.string() }).parse(await request(`/resume?${params}`)).command;
      },
    }),
    ...(capabilities.fork && {
      async fork(topic: z.infer<typeof topicId>, turn: string) {
        return z.object({ topic_id: topicId }).parse(await request("/fork", { topic, turn })).topic_id;
      },
    }),
  };
}
