import { randomBytes } from 'node:crypto';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export function createTempPdfPath(tmpDir: string): string {
  return resolve(tmpDir, `${randomBytes(16).toString('hex')}.pdf`);
}

export function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export async function cleanupFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function cleanupExpiredFiles(
  dirPath: string,
  maxAgeMs: number,
  now = Date.now(),
): Promise<number> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  let removed = 0;

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      removed += await cleanupExpiredFiles(fullPath, maxAgeMs, now);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const info = await stat(fullPath);
      if (now - info.mtimeMs > maxAgeMs) {
        await unlink(fullPath);
        removed += 1;
      }
    } catch {
      // The file may have been cleaned up by another task.
    }
  }

  return removed;
}
