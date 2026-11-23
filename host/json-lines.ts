import { readFile } from "node:fs/promises";

export async function readJsonLines(path: string): Promise<unknown[]> {
  const file = await readFile(path, "utf8");
  const lines = file.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const records: unknown[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      if (index === lines.length - 1 && !file.endsWith("\n")) break;
      throw new Error(`对话日志第 ${index + 1} 行无法读取。请检查导出格式。`);
    }
  }
  return records;
}
