import { spawnSync } from 'node:child_process';
import { randomFillSync } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import type { ToolSession } from '../src/files/tool-session.js';
import { DEFAULT_NUP_SETTINGS } from '../src/pdf/nup.js';
import { runTool } from '../src/tools/run.js';
import type { ToolId } from '../src/tools/definitions.js';
import type { ToolSettings } from '../src/files/tool-session.js';

const PAGE_COUNT = Number(process.env.BENCH_PAGES ?? 12);
const ONLY = process.env.BENCH_ONLY?.split(',').filter(Boolean);
const IMAGE_FIXTURE = process.env.BENCH_IMAGE === '1';
const QUALITY = (process.env.BENCH_QUALITY ?? 'medium') as 'low' | 'medium' | 'high';
const MAX_OUTPUT_BYTES = 49 * 1024 * 1024;
const TIMEOUT_MS = 180_000;

interface BenchRow {
  op: string;
  pages: number;
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
  maxRssMb: number;
  zip: boolean;
  detail: string;
}

async function buildFixture(path: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle('NoteSprint benchmark fixture');

  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const landscape = index % 5 === 4;
    const page = pdf.addPage(landscape ? [841.89, 595.28] : [595.28, 841.89]);
    const { width, height } = page.getSize();

    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: rgb(0.98, 0.98, 0.96),
    });

    if (IMAGE_FIXTURE) {
      const pixelWidth = landscape ? 1754 : 1240;
      const pixelHeight = landscape ? 1240 : 1754;
      const noise = Buffer.allocUnsafe(pixelWidth * pixelHeight * 3);
      randomFillSync(noise);
      const jpeg = await sharp(noise, {
        raw: { width: pixelWidth, height: pixelHeight, channels: 3 },
      })
        .jpeg({ quality: 55 })
        .toBuffer();
      const image = await pdf.embedJpg(jpeg);
      page.drawImage(image, { x: 0, y: 0, width, height });
    }

    page.drawRectangle({
      x: 36,
      y: height - 96,
      width: width - 72,
      height: 48,
      color: rgb(0.1 + (index % 4) * 0.12, 0.25, 0.45),
    });
    page.drawText(`NoteSprint benchmark page ${index + 1}`, {
      x: 48,
      y: height - 80,
      size: 18,
      font: bold,
      color: rgb(1, 1, 1),
    });

    for (let line = 0; line < 32; line += 1) {
      const y = height - 140 - line * 18;
      const textWidth = 0.55 + ((line * 7 + index) % 40) / 100;
      page.drawRectangle({
        x: 48,
        y: y - 2,
        width: (width - 96) * Math.min(0.95, textWidth),
        height: 7,
        color: rgb(0.15, 0.15, 0.15),
      });
      page.drawRectangle({
        x: 48,
        y: y - 12,
        width: (width - 96) * (0.3 + ((line * 3) % 30) / 100),
        height: 5,
        color: rgb(0.55, 0.55, 0.55),
      });
    }

    page.drawText(`Page ${index + 1} of ${PAGE_COUNT}`, {
      x: 48,
      y: 32,
      size: 10,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
  }

  await writeFile(path, await pdf.save({ useObjectStreams: true }));
}

function sessionFor(tool: ToolId, filePath: string, settings: ToolSettings): ToolSession {
  return {
    userId: 1,
    chatId: 1,
    tool,
    filePath,
    fileName: 'benchmark.pdf',
    sizeBytes: 0,
    pages: PAGE_COUNT,
    uploading: false,
    settings,
    controller: new AbortController(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const OPERATIONS: Record<string, { tool: ToolId; settings: ToolSettings; suffix: string }> = {
  'split-every': { tool: 'split', settings: { mode: 'every' }, suffix: 'zip' },
  'select-keep': {
    tool: 'select',
    settings: {
      mode: 'keep',
      indices: Array.from({ length: Math.ceil(PAGE_COUNT / 2) }, (_, i) => i * 2),
    },
    suffix: 'pdf',
  },
  reorder: {
    tool: 'reorder',
    settings: {
      indices: Array.from({ length: PAGE_COUNT }, (_, i) => PAGE_COUNT - 1 - i),
    },
    suffix: 'pdf',
  },
  'rotate-90': { tool: 'rotate', settings: { angle: 90, scope: 'all' }, suffix: 'pdf' },
  grayscale: { tool: 'gray', settings: { quality: QUALITY }, suffix: 'pdf' },
  'black-white': {
    tool: 'bw',
    settings: { quality: QUALITY, threshold: 'balanced' },
    suffix: 'pdf',
  },
  invert: { tool: 'invert', settings: { quality: QUALITY }, suffix: 'pdf' },
  'clear-background': {
    tool: 'clear',
    settings: { quality: QUALITY, clearLevel: 'medium' },
    suffix: 'pdf',
  },
  'nup-4': {
    tool: 'nup',
    settings: {
      nup: {
        ...DEFAULT_NUP_SETTINGS,
        perPage: 4,
        paper: 'a4',
        orientation: 'portrait',
        separators: true,
        pageNumbers: true,
      },
    },
    suffix: 'pdf',
  },
};

async function runChild(op: string, inputPath: string, workDir: string): Promise<BenchRow> {
  const spec = OPERATIONS[op];
  if (!spec) throw new Error(`Unknown operation: ${op}`);
  const outputPath = join(workDir, `${op}.${spec.suffix}`);
  const started = performance.now();
  const result = await runTool(sessionFor(spec.tool, inputPath, spec.settings), {
    tmpDir: workDir,
    outputPath,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    maxPages: 300,
    rasterMaxPages: 30,
    rasterMaxPixelsPerPage: 4_000_000,
    timeoutMs: TIMEOUT_MS,
  });
  const durationMs = performance.now() - started;
  const output = await stat(result.outputPath);
  const usage = process.resourceUsage();
  return {
    op,
    pages: result.pages,
    inputBytes: (await stat(inputPath)).size,
    outputBytes: output.size,
    durationMs,
    maxRssMb: usage.maxRSS / 1024,
    zip: result.zip,
    detail: result.detail,
  };
}

async function main(): Promise<void> {
  const op = process.argv.find((arg) => arg.startsWith('--op='))?.slice(5);
  const inputArg = process.argv.find((arg) => arg.startsWith('--input='))?.slice(8);
  const dirArg = process.argv.find((arg) => arg.startsWith('--dir='))?.slice(6);

  if (op) {
    if (!inputArg || !dirArg) throw new Error('Child mode needs --input and --dir');
    const row = await runChild(op, inputArg, dirArg);
    console.log(`BENCH ${JSON.stringify(row)}`);
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), 'notesprint-bench-'));
  const inputPath = join(workDir, 'input.pdf');
  try {
    await buildFixture(inputPath);
    const inputBytes = (await stat(inputPath)).size;
    console.log(
      `Fixture: ${PAGE_COUNT} pages, ${(inputBytes / 1024).toFixed(1)} KiB, ` +
        (IMAGE_FIXTURE ? 'noise-image + vector text/lines' : 'vector text/lines'),
    );
    console.log(`Node ${process.version}, platform ${process.platform}/${process.arch}`);
    console.log('');

    const header = [
      'operation'.padEnd(17),
      'pages'.padStart(5),
      'output'.padStart(10),
      'duration'.padStart(10),
      'peak RSS'.padStart(10),
      'result',
    ].join('  ');
    console.log(header);
    console.log('-'.repeat(header.length));

    const script = fileURLToPath(import.meta.url);
    for (const name of Object.keys(OPERATIONS)) {
      if (ONLY && !ONLY.includes(name)) continue;
      const child = spawnSync(
        process.execPath,
        ['--max-semi-space-size=2', '--import', 'tsx', script, `--op=${name}`, `--input=${inputPath}`, `--dir=${workDir}`],
        { encoding: 'utf8', timeout: TIMEOUT_MS + 60_000 },
      );
      const line = child.stdout
        .split(/\r?\n/)
        .find((value) => value.startsWith('BENCH '));
      if (child.status !== 0 || !line) {
        console.error(`${name}: failed`);
        console.error(child.stderr || child.stdout);
        continue;
      }
      const row = JSON.parse(line.slice(6)) as BenchRow;
      console.log(
        [
          row.op.padEnd(17),
          String(row.pages).padStart(5),
          `${(row.outputBytes / 1024).toFixed(0)} KiB`.padStart(10),
          `${row.durationMs.toFixed(0)} ms`.padStart(10),
          `${row.maxRssMb.toFixed(0)} MB`.padStart(10),
          `${row.zip ? 'ZIP' : 'PDF'} · ${row.detail}`,
        ].join('  '),
      );
    }

    console.log('');
    console.log('Each child runs with --max-semi-space-size=2, matching production start.');
    console.log('Peak RSS includes Node, pdf-lib, pdfjs, and Sharp in one child process.');
    console.log('Render Free has 512 MB and 0.1 CPU; these timings are a local machine.');
    console.log('Set BENCH_IMAGE=1 for a noise-image fixture, BENCH_QUALITY=high for 200 DPI.');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

await main();
