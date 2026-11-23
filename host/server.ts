import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { z } from "zod";
import { topicId } from "../lib/topic-map";
import type { SnapshotQuery } from "../lib/tree-source";
import { sessionTree } from "./session-host";
import type { LineageStore, SessionHost } from "./session-host";

const querySchema = z.strictObject({
  topic: topicId.optional(), before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
}).refine((query) => query.before === undefined || query.after === undefined);
const actionSchema = z.object({ topic: topicId, turn: z.string().min(1).max(512) });
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8",
};

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  const length = Number(request.headers["content-length"]);
  if (!Number.isInteger(length) || length < 1 || length > 8192 ||
    request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new Error("需要有效的 JSON 请求。");
  }
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.from(part));
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export async function serveTree({ host, rootId, lineage, assets, port = 0 }: {
  host: SessionHost; rootId: string; lineage: LineageStore; assets: string; port?: number;
}) {
  const tree = sessionTree(host, topicId.parse(rootId), lineage);
  const directory = resolve(assets);
  await readFile(resolve(directory, "index.html")).catch(() => {
    throw new Error("请先运行 npm run build 生成静态页面。");
  });
  await tree.snapshot();
  const token = randomBytes(32).toString("base64url");
  const secret = Buffer.from(token);
  let origin = "";
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) {
        return json(response, 403, { error: "请使用本机连接地址。" });
      }
      const url = new URL(request.url ?? "/", origin);
      if (url.pathname.startsWith("/api/")) {
        const received = Buffer.from(String(request.headers["x-tree-token"] ?? ""));
        if (received.length !== secret.length || !timingSafeEqual(received, secret)) {
          return json(response, 403, { error: "请通过连接命令生成的完整地址打开。" });
        }
        if (request.method === "GET") {
          switch (url.pathname) {
            case "/api/tree/v1":
              return json(response, 200, { version: 1, name: tree.name, open: tree.open, fork: tree.fork });
            case "/api/tree/v1/snapshot": {
              const { topic, before, after } = querySchema.parse(Object.fromEntries(url.searchParams));
              const query: SnapshotQuery = after === undefined ? { topic, before } : { topic, after };
              return json(response, 200, await tree.snapshot(query));
            }
            case "/api/tree/v1/anchor":
              return json(response, 200, await tree.locate(url.searchParams.get("entry") ?? ""));
            case "/api/tree/v1/resume":
              return json(response, 200, await tree.resume(topicId.parse(url.searchParams.get("topic"))));
          }
        }
        if (request.method === "POST" && url.pathname === "/api/tree/v1/fork") {
          const { topic, turn } = actionSchema.parse(await body(request));
          return json(response, 201, await tree.forkAt(topic, turn));
        }
        return json(response, 404, { error: "接口不存在。" });
      }
      if (request.method !== "GET") return json(response, 405, { error: "方法不支持。" });
      const path = resolve(directory, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
      if (!path.startsWith(directory + sep)) return json(response, 404, { error: "文件不存在。" });
      const contents = await readFile(path).catch(() => null);
      if (!contents) return json(response, 404, { error: "文件不存在。" });
      response.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream" });
      response.end(contents);
    } catch (error) {
      const message = error instanceof z.ZodError ? "接口参数或宿主记录格式无效。"
        : error instanceof Error && !("code" in error && typeof error.code === "string") ? error.message
        : "读取宿主会话失败。请检查导出文件或宿主状态。";
      json(response, 400, { error: message });
    }
  });
  await new Promise<void>((onListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("无法确定本机监听地址。"));
      origin = `http://127.0.0.1:${address.port}`;
      onListen();
    });
  });
  return { url: `${origin}/?source=host#token=${token}`, close: () => server.close() };
}
