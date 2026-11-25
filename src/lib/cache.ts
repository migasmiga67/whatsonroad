import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Prosty cache plikowy: .cache/<namespace>/<sha1>.json
 * Chroni limity darmowych API (ORS, Overpass, Wikipedia, Claude).
 */
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), ".cache");

type Entry<T> = { savedAt: number; value: T };

function keyFile(namespace: string, key: unknown) {
  const hash = createHash("sha1")
    .update(typeof key === "string" ? key : JSON.stringify(key))
    .digest("hex");
  return path.join(CACHE_DIR, namespace, `${hash}.json`);
}

export async function cacheGet<T>(namespace: string, key: unknown, ttlS: number): Promise<T | null> {
  try {
    const raw = await fs.readFile(keyFile(namespace, key), "utf8");
    const entry = JSON.parse(raw) as Entry<T>;
    if (Date.now() - entry.savedAt > ttlS * 1000) return null;
    return entry.value;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(namespace: string, key: unknown, value: T): Promise<void> {
  const file = keyFile(namespace, key);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ savedAt: Date.now(), value } satisfies Entry<T>));
    await fs.rename(tmp, file);
  } catch (err) {
    // Cache nie jest krytyczny – np. read-only FS na serverless.
    console.warn("[cache] zapis nieudany:", (err as Error).message);
  }
}

/** Zwraca wartość z cache albo wylicza ją i zapisuje. */
export async function cached<T>(
  namespace: string,
  key: unknown,
  ttlS: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(namespace, key, ttlS);
  if (hit !== null) return hit;
  const value = await compute();
  await cacheSet(namespace, key, value);
  return value;
}

export const DAY = 24 * 3600;
