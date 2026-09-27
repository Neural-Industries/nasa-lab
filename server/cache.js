// Two-tier cache (memory + disk) with in-flight de-duplication and
// stale-on-error fallback, so a flaky upstream never blanks the UI and the
// NASA key's hourly quota is spent as rarely as possible.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

// Serverless filesystems are read-only except the temp dir, which lives as long
// as the warm instance does; locally the cache persists in ./.cache.
const CACHE_DIR = process.env.VERCEL ? path.join(os.tmpdir(), 'nasa-lab-cache') : path.resolve(process.cwd(), '.cache');
const MAX_MEMORY_ENTRIES = 400;
const memory = new Map();
const inflight = new Map();

let diskOk = true;
try { await mkdir(CACHE_DIR, { recursive: true }); } catch { diskOk = false; }

const keyFor = (id) => createHash('sha1').update(id).digest('hex');

function remember(id, entry) {
  memory.delete(id);
  memory.set(id, entry);
  while (memory.size > MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
}

async function readDisk(id) {
  if (!diskOk) return null;
  const base = path.join(CACHE_DIR, keyFor(id));
  try {
    const meta = JSON.parse(await readFile(base + '.json', 'utf8'));
    const body = await readFile(base + '.bin');
    return { ...meta, body };
  } catch {
    return null;
  }
}

async function writeDisk(id, entry) {
  if (!diskOk) return;
  const base = path.join(CACHE_DIR, keyFor(id));
  const { body, gz, ...meta } = entry;
  try {
    await writeFile(base + '.bin', body);
    await writeFile(base + '.json', JSON.stringify(meta));
  } catch (err) {
    console.warn('[cache] disk write failed', err.message);
  }
}

function withGzip(entry) {
  if (!entry.gz && /json|text|xml|javascript/.test(entry.type) && entry.body.length > 1024) {
    entry.gz = gzipSync(entry.body);
  }
  return entry;
}

/**
 * Returns a cache entry { body: Buffer, type, status, t, stale? }.
 * `producer` must resolve to { body: Buffer, type, status }.
 */
export async function cached(id, ttlMs, producer) {
  const now = Date.now();
  let entry = memory.get(id);
  if (!entry) {
    entry = await readDisk(id);
    if (entry) remember(id, withGzip(entry));
  }
  if (entry && now - entry.t < ttlMs) return entry;

  if (inflight.has(id)) return inflight.get(id);

  const job = (async () => {
    try {
      const fresh = await producer();
      if (fresh.status >= 200 && fresh.status < 300) {
        const stored = withGzip({ ...fresh, t: Date.now() });
        remember(id, stored);
        writeDisk(id, stored);
        return stored;
      }
      if (entry) return { ...entry, stale: true };
      return fresh;
    } catch (err) {
      if (entry) return { ...entry, stale: true };
      throw err;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, job);
  return job;
}
