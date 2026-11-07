import { statfs as nodeStatfs } from 'node:fs/promises';
import { ensureDirectory } from './paths.js';

export type StatfsLike = (path: string) => Promise<{ bavail: number; bsize: number }>;

export interface DiskSpaceResult {
  ok: boolean;
  availableBytes: number;
  requiredBytes: number;
}

const defaultStatfs: StatfsLike = async (path) => {
  const info = await nodeStatfs(path);
  return { bavail: info.bavail, bsize: info.bsize };
};

export async function checkDiskSpace(
  dirPath: string,
  requiredBytes: number,
  reserveBytes: number,
  statfsFn: StatfsLike = defaultStatfs,
): Promise<DiskSpaceResult> {
  await ensureDirectory(dirPath);

  const info = await statfsFn(dirPath);
  const availableBytes = info.bavail * info.bsize;
  const needed = Math.max(0, requiredBytes) + Math.max(0, reserveBytes);

  return {
    ok: availableBytes >= needed,
    availableBytes,
    requiredBytes: needed,
  };
}
