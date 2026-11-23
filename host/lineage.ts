import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { linkSchema } from "./session-host";
import type { LineageStore } from "./session-host";

export function lineageDirectory(directory: string): LineageStore {
  return {
    async read() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
      return Promise.all(files.sort().map(async (file) =>
        linkSchema.parse(JSON.parse(await readFile(join(directory, file), "utf8"))),
      ));
    },
    async add(link) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const key = createHash("sha256").update(link.child).digest("hex");
      const temporary = join(directory, `${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(link) + "\n", { flag: "wx", mode: 0o600 });
        await rename(temporary, join(directory, `${Date.now()}-${key}.json`));
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
