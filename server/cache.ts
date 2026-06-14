// Tiny JSON file cache under .cache/ (git-ignored). Writes are atomic
// (temp file + rename) so a crash mid-write can never corrupt the cache.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache')

export async function readCache<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, name), 'utf8')) as T
  } catch {
    return fallback // missing or unreadable -> start fresh
  }
}

export async function writeCache(name: string, data: unknown): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true })
  const target = join(CACHE_DIR, name)
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data), 'utf8')
  await rename(tmp, target) // atomic on the same filesystem
}
