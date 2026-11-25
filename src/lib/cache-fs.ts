import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setCacheBackend } from "./cache";

/** Cache plikowy na serwerze: .cache/<namespace>/<hash>.json */
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), ".cache");

setCacheBackend({
  async get(ns, key) {
    try {
      return await fs.readFile(path.join(CACHE_DIR, ns, `${key}.json`), "utf8");
    } catch {
      return null;
    }
  },
  async set(ns, key, value) {
    const file = path.join(CACHE_DIR, ns, `${key}.json`);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, value);
      await fs.rename(tmp, file);
    } catch (err) {
      // np. FS tylko do odczytu na serverless – działamy dalej bez cache
      console.warn("[cache] zapis nieudany:", (err as Error).message);
    }
  },
});
