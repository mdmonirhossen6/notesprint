import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { InputFile } from 'grammy';
import type { Api } from 'grammy';
import { checkDiskSpace } from '../src/files/disk.js';
import { downloadTelegramFile } from '../src/files/download.js';
import { FileHandlingError } from '../src/files/errors.js';
import { intakePdf } from '../src/files/intake.js';
import { validatePdfMetadata } from '../src/files/metadata.js';
import { cleanupExpiredFiles, createTempPdfPath, isPathInside } from '../src/files/paths.js';
import { createTaskQueue } from '../src/files/queue.js';
import { createRateLimiter } from '../src/files/rate-limit.js';
import { sendDocumentFromPath } from '../src/files/send.js';
import { createUploadSessionStore } from '../src/files/upload-session.js';

const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x41)]);
const BOT_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-files-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function startServer(
  handler: RequestListener,
): Promise<{ server: Server; base: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isMissing(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => false,
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function expectCode(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof FileHandlingError);
    assert.equal(error.code, code);
    return true;
  };
}

test('metadata validation accepts PDF documents and rejects other types', () => {
  assert.deepEqual(validatePdfMetadata({ file_id: 'a', mime_type: 'application/pdf' }, 100), {
    ok: true,
    declaredSize: null,
  });
  assert.deepEqual(validatePdfMetadata({ file_id: 'a', mime_type: 'application/x-pdf' }, 100), {
    ok: true,
    declaredSize: null,
  });
  assert.deepEqual(
    validatePdfMetadata(
      { file_id: 'a', mime_type: 'application/octet-stream', file_name: 'notes.PDF' },
      100,
    ),
    { ok: true, declaredSize: null },
  );
  assert.deepEqual(
    validatePdfMetadata({ file_id: 'a', file_name: 'notes.pdf', file_size: 50 }, 100),
    { ok: true, declaredSize: 50 },
  );

  assert.deepEqual(
    validatePdfMetadata({ file_id: 'a', mime_type: 'image/jpeg', file_name: 'x.jpg' }, 100),
    { ok: false, code: 'invalid_type' },
  );
  assert.deepEqual(
    validatePdfMetadata({ file_id: 'a', mime_type: 'application/octet-stream', file_name: 'x.bin' }, 100),
    { ok: false, code: 'invalid_type' },
  );
  assert.deepEqual(
    validatePdfMetadata({ file_id: 'a', mime_type: 'application/pdf', file_size: 0 }, 100),
    { ok: false, code: 'empty' },
  );
  assert.deepEqual(
    validatePdfMetadata({ file_id: 'a', mime_type: 'application/pdf', file_size: 101 }, 100),
    { ok: false, code: 'too_large' },
  );
  assert.deepEqual(
    validatePdfMetadata({ file_id: 'a', mime_type: 'application/pdf', file_size: -1 }, 100),
    { ok: false, code: 'invalid_type' },
  );
});

test('remote files stream to disk and the URL path is preserved', async () => {
  await withTempDir(async (dir) => {
    let seenUrl = '';
    const { server, base } = await startServer((request, response) => {
      seenUrl = request.url ?? '';
      response.writeHead(200, { 'content-length': String(PDF_BYTES.length) });
      response.end(PDF_BYTES);
    });

    try {
      const destination = join(dir, 'remote.pdf');
      const result = await downloadTelegramFile({
        apiRoot: base,
        botToken: BOT_TOKEN,
        filePath: 'documents/file_1.pdf',
        destination,
        maxBytes: 16 * 1024,
        timeoutMs: 5000,
      });

      assert.deepEqual(result, { sizeBytes: PDF_BYTES.length, source: 'remote' });
      assert.deepEqual(await readFile(destination), PDF_BYTES);
      assert.match(seenUrl, /\/file\/bot123456789:AAAA+\/documents\/file_1\.pdf$/);
    } finally {
      await stopServer(server);
    }
  });
});

test('remote streaming enforces the byte limit and removes partial files', async () => {
  await withTempDir(async (dir) => {
    const { server, base } = await startServer((_request, response) => {
      response.on('error', () => undefined);
      response.writeHead(200);
      response.write(Buffer.alloc(700, 0x41));
      response.write(Buffer.alloc(700, 0x42));
      response.end();
    });

    try {
      const destination = join(dir, 'too-large.pdf');
      await assert.rejects(
        downloadTelegramFile({
          apiRoot: base,
          botToken: BOT_TOKEN,
          filePath: 'documents/file_2.pdf',
          destination,
          maxBytes: 1024,
          timeoutMs: 5000,
        }),
        expectCode('too_large'),
      );
      assert.equal(await isMissing(destination), true);
    } finally {
      await stopServer(server);
    }
  });
});

test('remote content-length over the limit is rejected before writing', async () => {
  await withTempDir(async (dir) => {
    let requests = 0;
    const { server, base } = await startServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-length': String(PDF_BYTES.length) });
      response.end(PDF_BYTES);
    });

    try {
      const destination = join(dir, 'declared-large.pdf');
      await assert.rejects(
        downloadTelegramFile({
          apiRoot: base,
          botToken: BOT_TOKEN,
          filePath: 'documents/file_3.pdf',
          destination,
          maxBytes: 16,
          timeoutMs: 5000,
        }),
        expectCode('too_large'),
      );
      assert.equal(requests, 1);
      assert.equal(await isMissing(destination), true);
    } finally {
      await stopServer(server);
    }
  });
});

test('remote download timeout is reported and cleans up', async () => {
  await withTempDir(async (dir) => {
    const { server, base } = await startServer(() => {
      // Intentionally never respond.
    });

    try {
      const destination = join(dir, 'timeout.pdf');
      await assert.rejects(
        downloadTelegramFile({
          apiRoot: base,
          botToken: BOT_TOKEN,
          filePath: 'documents/file_4.pdf',
          destination,
          maxBytes: 16 * 1024,
          timeoutMs: 100,
        }),
        expectCode('timeout'),
      );
      assert.equal(await isMissing(destination), true);
    } finally {
      await stopServer(server);
    }
  });
});

test('remote HTTP errors and empty bodies are reported', async () => {
  await withTempDir(async (dir) => {
    const { server, base } = await startServer((request, response) => {
      if (request.url?.endsWith('missing.pdf')) {
        response.writeHead(404);
        response.end('no');
        return;
      }
      response.writeHead(200, { 'content-length': '0' });
      response.end();
    });

    try {
      await assert.rejects(
        downloadTelegramFile({
          apiRoot: base,
          botToken: BOT_TOKEN,
          filePath: 'documents/missing.pdf',
          destination: join(dir, 'missing.pdf'),
          maxBytes: 1024,
          timeoutMs: 5000,
        }),
        expectCode('download_failed'),
      );

      await assert.rejects(
        downloadTelegramFile({
          apiRoot: base,
          botToken: BOT_TOKEN,
          filePath: 'documents/empty.pdf',
          destination: join(dir, 'empty.pdf'),
          maxBytes: 1024,
          timeoutMs: 5000,
        }),
        expectCode('empty'),
      );
    } finally {
      await stopServer(server);
    }
  });
});

test('local Bot API paths are copied with containment and size checks', async () => {
  await withTempDir(async (dir) => {
    const root = join(dir, 'bot-api');
    await mkdir(root, { recursive: true });
    const source = join(root, 'document.pdf');
    await writeFile(source, PDF_BYTES);

    const inside = await downloadTelegramFile({
      apiRoot: 'http://127.0.0.1:8081',
      botToken: BOT_TOKEN,
      filePath: source,
      destination: join(dir, 'copy.pdf'),
      maxBytes: 16 * 1024,
      timeoutMs: 5000,
      localFileRoot: root,
    });
    assert.deepEqual(inside, { sizeBytes: PDF_BYTES.length, source: 'local' });

    const fromUri = await downloadTelegramFile({
      apiRoot: 'http://127.0.0.1:8081',
      botToken: BOT_TOKEN,
      filePath: pathToFileURL(source).href,
      destination: join(dir, 'copy-uri.pdf'),
      maxBytes: 16 * 1024,
      timeoutMs: 5000,
      localFileRoot: root,
    });
    assert.equal(fromUri.source, 'local');

    await assert.rejects(
      downloadTelegramFile({
        apiRoot: 'http://127.0.0.1:8081',
        botToken: BOT_TOKEN,
        filePath: source,
        destination: join(dir, 'outside.pdf'),
        maxBytes: 16 * 1024,
        timeoutMs: 5000,
        localFileRoot: join(root, 'nested'),
      }),
      expectCode('local_path'),
    );

    await assert.rejects(
      downloadTelegramFile({
        apiRoot: 'http://127.0.0.1:8081',
        botToken: BOT_TOKEN,
        filePath: source,
        destination: join(dir, 'too-large.pdf'),
        maxBytes: PDF_BYTES.length - 1,
        timeoutMs: 5000,
        localFileRoot: root,
      }),
      expectCode('too_large'),
    );

    const empty = join(root, 'empty.pdf');
    await writeFile(empty, '');
    await assert.rejects(
      downloadTelegramFile({
        apiRoot: 'http://127.0.0.1:8081',
        botToken: BOT_TOKEN,
        filePath: empty,
        destination: join(dir, 'empty-copy.pdf'),
        maxBytes: 1024,
        timeoutMs: 5000,
        localFileRoot: root,
      }),
      expectCode('empty'),
    );
  });
});

test('disk space checks reserve the upload plus the configured margin', async () => {
  await withTempDir(async (dir) => {
    const tight = await checkDiskSpace(dir, 100, 50, async () => ({ bavail: 1, bsize: 100 }));
    assert.deepEqual(tight, { ok: false, availableBytes: 100, requiredBytes: 150 });

    const roomy = await checkDiskSpace(dir, 100, 50, async () => ({ bavail: 2, bsize: 100 }));
    assert.deepEqual(roomy, { ok: true, availableBytes: 200, requiredBytes: 150 });
  });
});

test('intake downloads a local PDF and returns a temp path', async () => {
  await withTempDir(async (dir) => {
    const source = join(dir, 'source.pdf');
    await writeFile(source, PDF_BYTES);
    const tmp = join(dir, 'tmp');

    const result = await intakePdf({
      fileId: 'file-id',
      getFile: async () => ({ file_path: source, file_size: PDF_BYTES.length }),
      maxBytes: 16 * 1024,
      tmpDir: tmp,
      apiRoot: 'http://127.0.0.1:8081',
      botToken: BOT_TOKEN,
      timeoutMs: 5000,
      declaredBytes: PDF_BYTES.length,
      localFileRoot: dir,
      statfsFn: async () => ({ bavail: 1_000_000, bsize: 4096 }),
    });

    assert.equal(result.source, 'local');
    assert.equal(result.sizeBytes, PDF_BYTES.length);
    assert.match(result.filePath, /[0-9a-f]{32}\.pdf$/);
    assert.deepEqual(await readFile(result.filePath), PDF_BYTES);
  });
});

test('intake removes temp files when the PDF header is invalid', async () => {
  await withTempDir(async (dir) => {
    const source = join(dir, 'not-a-pdf.pdf');
    await writeFile(source, 'this is not a pdf');
    const tmp = join(dir, 'tmp');

    await assert.rejects(
      intakePdf({
        fileId: 'file-id',
        getFile: async () => ({ file_path: source, file_size: 16 }),
        maxBytes: 16 * 1024,
        tmpDir: tmp,
        apiRoot: 'http://127.0.0.1:8081',
        botToken: BOT_TOKEN,
        timeoutMs: 5000,
        localFileRoot: dir,
        statfsFn: async () => ({ bavail: 1_000_000, bsize: 4096 }),
      }),
      expectCode('invalid_pdf'),
    );

    assert.deepEqual(await readdir(tmp), []);
  });
});

test('intake checks disk space before contacting Telegram', async () => {
  await withTempDir(async (dir) => {
    let getFileCalls = 0;

    await assert.rejects(
      intakePdf({
        fileId: 'file-id',
        getFile: async () => {
          getFileCalls += 1;
          return { file_path: 'ignored' };
        },
        maxBytes: 16 * 1024,
        tmpDir: join(dir, 'tmp'),
        apiRoot: 'http://127.0.0.1:8081',
        botToken: BOT_TOKEN,
        timeoutMs: 5000,
        statfsFn: async () => ({ bavail: 0, bsize: 4096 }),
      }),
      expectCode('disk_space'),
    );

    assert.equal(getFileCalls, 0);
  });
});

test('intake rejects missing paths and oversized declarations', async () => {
  await withTempDir(async (dir) => {
    const statfsFn = async () => ({ bavail: 1_000_000, bsize: 4096 });

    await assert.rejects(
      intakePdf({
        fileId: 'file-id',
        getFile: async () => ({}),
        maxBytes: 16 * 1024,
        tmpDir: join(dir, 'tmp'),
        apiRoot: 'http://127.0.0.1:8081',
        botToken: BOT_TOKEN,
        timeoutMs: 5000,
        statfsFn,
      }),
      expectCode('download_failed'),
    );

    await assert.rejects(
      intakePdf({
        fileId: 'file-id',
        getFile: async () => ({ file_path: 'ignored', file_size: 32 * 1024 }),
        maxBytes: 16 * 1024,
        tmpDir: join(dir, 'tmp'),
        apiRoot: 'http://127.0.0.1:8081',
        botToken: BOT_TOKEN,
        timeoutMs: 5000,
        statfsFn,
      }),
      expectCode('too_large'),
    );
  });
});

test('path helpers create random names and contain paths', async () => {
  await withTempDir(async (dir) => {
    const first = createTempPdfPath(dir);
    const second = createTempPdfPath(dir);
    assert.notEqual(first, second);
    assert.match(first, /[0-9a-f]{32}\.pdf$/);

    const root = join(dir, 'root');
    const inside = join(root, 'a', 'file.pdf');
    const sibling = join(dir, 'root-2', 'file.pdf');
    assert.equal(isPathInside(root, inside), true);
    assert.equal(isPathInside(root, root), false);
    assert.equal(isPathInside(root, sibling), false);

    const stale = join(dir, 'stale.pdf');
    const fresh = join(dir, 'fresh.pdf');
    await writeFile(stale, 'old');
    await writeFile(fresh, 'new');
    const now = Date.now();
    await utimes(stale, new Date(now - 120_000), new Date(now - 120_000));

    const removed = await cleanupExpiredFiles(dir, 60_000, now);
    assert.equal(removed, 1);
    assert.equal(await isMissing(stale), true);
    assert.equal(await isMissing(fresh), false);
  });
});

test('rate limiter uses a sliding window per user', () => {
  let clock = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => clock });

  assert.deepEqual(limiter.tryAcquire(1), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  clock = 1_000;
  assert.deepEqual(limiter.tryAcquire(1), { allowed: true, remaining: 0, retryAfterSeconds: 0 });
  clock = 2_000;
  const denied = limiter.tryAcquire(1);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 58);

  assert.equal(limiter.tryAcquire(2).allowed, true);

  clock = 60_001;
  assert.equal(limiter.tryAcquire(1).allowed, true);

  limiter.reset(1);
  assert.equal(limiter.tryAcquire(1).allowed, true);

  clock = 130_000;
  assert.equal(limiter.prune(), 2);
  assert.equal(limiter.size(), 0);
});

test('upload sessions expire and are consumed once', () => {
  let clock = 0;
  const sessions = createUploadSessionStore({ ttlMs: 1_000, now: () => clock });

  assert.equal(sessions.isActive(1), false);
  sessions.start(1);
  assert.equal(sessions.isActive(1), true);
  assert.equal(sessions.take(1), true);
  assert.equal(sessions.take(1), false);

  sessions.start(2);
  clock = 1_001;
  assert.equal(sessions.isActive(2), false);
  assert.equal(sessions.size(), 0);

  sessions.start(3);
  sessions.start(4);
  clock = 3_000;
  assert.equal(sessions.prune(), 2);
});

test('task queue bounds concurrency and isolates failures', async () => {
  const queue = createTaskQueue({ concurrency: 2 });
  let active = 0;
  let maxActive = 0;
  const finished: number[] = [];

  for (let index = 0; index < 5; index += 1) {
    queue.enqueue(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active -= 1;
      finished.push(index);
    });
  }

  assert.equal(queue.pending > 0, true);
  await queue.idle();
  assert.equal(maxActive, 2);
  assert.deepEqual(finished.sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.equal(queue.pending, 0);
  await queue.idle();

  const errors: unknown[] = [];
  const failing = createTaskQueue({ concurrency: 1, onTaskError: (error) => errors.push(error) });
  let secondRan = false;
  failing.enqueue(async () => {
    throw new Error('boom');
  });
  failing.enqueue(async () => {
    secondRan = true;
  });

  await failing.idle();
  assert.equal(errors.length, 1);
  assert.equal(secondRan, true);
});

test('sendDocumentFromPath streams a path InputFile and validates limits', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'output.pdf');
    await writeFile(filePath, PDF_BYTES);

    const calls: unknown[][] = [];
    const api = {
      sendDocument: async (...args: unknown[]) => {
        calls.push(args);
        return {};
      },
    } as unknown as Api;

    const result = await sendDocumentFromPath({
      api,
      chatId: 42,
      filePath,
      maxBytes: 16 * 1024,
      fileName: 'result.pdf',
      caption: 'done',
    });

    assert.deepEqual(result, { sizeBytes: PDF_BYTES.length });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]![0], 42);
    assert.ok(calls[0]![1] instanceof InputFile);
    assert.equal((calls[0]![1] as InputFile).filename, 'result.pdf');
    assert.deepEqual(calls[0]![2], { caption: 'done' });

    await assert.rejects(
      sendDocumentFromPath({ api, chatId: 42, filePath, maxBytes: 16 }),
      expectCode('too_large'),
    );

    const empty = join(dir, 'empty.pdf');
    await writeFile(empty, '');
    await assert.rejects(
      sendDocumentFromPath({ api, chatId: 42, filePath: empty, maxBytes: 1024 }),
      expectCode('empty'),
    );
  });
});
