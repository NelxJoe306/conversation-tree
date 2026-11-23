import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

export type RpcCall = (method: string, params: object) => Promise<unknown>;

const reply = z.object({
  id: z.number().int(), result: z.unknown().optional(),
  error: z.object({ code: z.number().int() }).optional(),
});

export class RpcError extends Error {
  constructor(readonly code: number, method: string) {
    super(`${method} 返回错误 ${code}。请检查宿主版本和会话 ID。`);
  }
}

export function stdioRpc(executable: string, args: string[]) {
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, (result: { value: unknown } | Error) => void>();
  let id = 0;
  let closed: Error | undefined;

  function disconnect(error: Error) {
    closed ??= error;
    for (const finish of pending.values()) finish(closed);
  }

  child.on("error", () => disconnect(new Error("无法启动宿主。请检查可执行文件路径。")));
  child.stdin.on("error", () => disconnect(new Error("宿主连接已关闭。")));
  child.on("close", () => disconnect(new Error("宿主已退出，请重启连接。")));
  lines.on("line", (line) => {
    let payload: unknown;
    try { payload = JSON.parse(line); } catch { return; }
    if (typeof payload === "object" && payload !== null && "method" in payload) return;
    const parsed = reply.safeParse(payload);
    if (!parsed.success) return;
    const response = parsed.data;
    pending.get(response.id)?.({ value: response });
  });

  const call: RpcCall = (method, params) => new Promise((resolve, reject) => {
    if (closed) return reject(closed);
    const request = ++id;
    const timeout = setTimeout(() => finish(new Error(`${method} 超时。若操作可能已提交，请先检查宿主。`)), 20_000);
    function finish(result: { value: unknown } | Error) {
      clearTimeout(timeout);
      pending.delete(request);
      if (result instanceof Error) return reject(result);
      const response = reply.parse(result.value);
      if (response.error) return reject(new RpcError(response.error.code, method));
      resolve(response.result);
    }
    pending.set(request, finish);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: request, method, params }) + "\n");
  });

  return {
    call,
    notify(method: string) {
      if (closed) throw closed;
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
    },
    close() {
      disconnect(new Error("宿主连接已关闭。"));
      child.stdin.end();
      lines.close();
      child.kill();
    },
  };
}
