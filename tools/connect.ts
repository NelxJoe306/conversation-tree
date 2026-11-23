import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { agyHost } from "../adapters/agy";
import { connectCodex } from "../adapters/codex";
import { dshFileHost } from "../adapters/dsh";
import { lineageDirectory } from "../host/lineage";
import { serveTree } from "../host/server";

const help = [
  "npm run connect -- codex --session ID [--command path/to/codex]",
  "npm run connect -- dsh --session ID --file session.jsonl",
  "npm run connect -- agy --session UUID --file transcript.jsonl",
  "Optional: --port 18301   --state path/to/lineage-directory",
].join("\n");

async function main() {
  const { values, positionals: [kind] } = parseArgs({ allowPositionals: true, options: {
    session: { type: "string" }, file: { type: "string" }, command: { type: "string" },
    port: { type: "string" }, state: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help || !kind) { console.log(help); return; }
  if (!values.session || !["codex", "dsh", "agy"].includes(kind)) throw new Error(help);
  const port = Number(values.port ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("端口必须在 0–65535 之间。");
  const rootId = values.session;
  const file = values.file ? resolve(values.file) : undefined;
  if (kind !== "codex" && !file) throw new Error("请用 --file 指定要查看的会话文件。");
  const executable = values.command ?? (process.platform === "win32" ? "codex.exe" : "codex");
  const connection = kind === "codex" ? await connectCodex(executable) : null;
  try {
    const host = connection?.host ?? (kind === "agy" ? agyHost({ id: rootId, path: file ?? "" }) : dshFileHost(file ?? ""));
    const key = createHash("sha256").update(JSON.stringify([kind, rootId, file])).digest("hex");
    const state = values.state ?? join(homedir(), ".conversation-tree", kind, key);
    const server = await serveTree({ host, rootId, lineage: lineageDirectory(state), assets: "out", port });
    console.log(server.url);
    function shutdown() { server.close(); connection?.close(); }
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    connection?.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "无法启动对话树连接。");
  process.exitCode = 1;
});
