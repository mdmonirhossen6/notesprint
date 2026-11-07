import { open } from 'node:fs/promises';

const PDF_HEADER = '%PDF-';

export async function hasPdfHeader(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(PDF_HEADER.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead === buffer.length && buffer.toString('latin1') === PDF_HEADER;
  } finally {
    await handle.close();
  }
}
