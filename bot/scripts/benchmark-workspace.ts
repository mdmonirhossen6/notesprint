import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DEFAULT_NUP_SETTINGS } from '../src/pdf/nup.js';
import { cleanupWorkspaceRun, runWorkspacePipeline } from '../src/workspace/run.js';
import type { Workspace, WorkspaceFile, WorkspaceOperation } from '../src/workspace/types.js';

const PAGE_COUNT = Number(process.env.BENCH_PAGES ?? 12);
const ONLY = process.env.BENCH_ONLY?.split(',').filter(Boolean);
const QUALITY = (process.env.BENCH_QUALITY ?? 'medium') as 'low' | 'medium' | 'high';
const MAX_OUTPUT_BYTES = 49 * 1024 * 1024;
const TIMEOUT_MS = 180_000;

interface BenchRow {
  scenario: string;
  files: number;
  operations: number;
  pages: number;
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
  maxRssMb: number;
  detail: string;
}

type Scenario = {
  files: number;
  mode: 'combine' | 'individual';
  operations: WorkspaceOperation[];
};

const HALF = Math.max(1, Math.ceil(PAGE_COUNT / 2));

const SCENARIOS: Record<string, Scenario> = {
  'combine-merge': { files: 2, mode: 'combine', operations: [] },
  'combine-multi-op': {
    files: 2,
    mode: 'combine',
    operations: [
      { id: 'o1', type: 'rotate', angle: 90, scope: 'all' },
      { id: 'o2', type: 'watermark', text: 'NOTESPRINT', size: 42, opacity: 0.25, rotation: 45, position: 'center', scope: 'all' },
      { id: 'o3', type: 'timestamp', customText: '' },
      { id: 'o4', type: 'footer', text: 'Workspace benchmark', pageNumbers: true, timestamp: false, position: 'center', size: 10 },
    ],
  },
  'individual-split-zip': {
    files: 2,
    mode: 'individual',
    operations: [{ id: 'o1', type: 'split', mode: 'every' }],
  },
  'gray-nup': {
    files: 1,
    mode: 'combine',
    operations: [
      { id: 'o1', type: 'gray', quality: QUALITY },
      { id: 'o2', type: 'nup', settings: { ...DEFAULT_NUP_SETTINGS, perPage: 4, pageNumbers: true } },
    ],
  },
};

async function buildFixture(path: string, pages: number, label: string): Promise<number> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.98, 0.98, 0.96) });
    page.drawText(`${label} page ${index + 1}`, { x: 48, y: height - 80, size: 18, font });
    for (let line = 0; line < 24; line += 1) {
      page.drawRectangle({
        x: 48,
        y: height - 130 - line * 18,
        width: (width - 96) * (0.4 + ((line * 7 + index) % 50) / 100),
        height: 6,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
    page.drawText(`Page ${index + 1} of ${pages}`, { x: 48, y: 32, size: 10, font });
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  await writeFile(path, bytes);
  return bytes.length;
}

function workspaceFor(
  files: Array<{ path: string; name: string; pages: number; bytes: number }>,
  scenario: Scenario,
): Workspace {
  const now = Date.now();
  return {
    id: 'bench',
    userId: 1,
    chatId: 1,
    files: files.map((file, index): WorkspaceFile => ({
      id: `f${index + 1}`,
      fileUniqueId: `bench-${index + 1}`,
      path: file.path,
      name: file.name,
      sizeBytes: file.bytes,
      pages: file.pages,
      uploadedAt: now,
    })),
    mode: scenario.mode,
    operations: scenario.operations,
    status: 'ready',
    awaitingUpload: false,
    replacingFileId: null,
    awaitingText: null,
    uploading: false,
    controller: new AbortController(),
    createdAt: now,
    updatedAt: now,
    uploadStartedAt: now,
    processingStartedAt: null,
    processingCompletedAt: null,
    lastError: null,
    cancelRequested: false,
    expiryNotified: false,
    nextFileSeq: files.length + 1,
    nextOpSeq: scenario.operations.length + 1,
  };
}

async function runScenario(name: string, dir: string): Promise<BenchRow> {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario: ${name}`);

  const pagesPerFile = scenario.files === 1 ? PAGE_COUNT : HALF;
  const files: Array<{ path: string; name: string; pages: number; bytes: number }> = [];
  for (let index = 0; index < scenario.files; index += 1) {
    const name = `part-${index + 1}.pdf`;
    const path = join(dir, name);
    const bytes = await buildFixture(path, pagesPerFile, `Part ${index + 1}`);
    files.push({ path, name, pages: pagesPerFile, bytes });
  }

  const workspace = workspaceFor(files, scenario);
  const started = performance.now();
  const result = await runWorkspacePipeline(workspace, {
    tmpDir: dir,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    maxPages: 300,
    mergeMaxFiles: 10,
    rasterMaxPages: 30,
    rasterMaxPixelsPerPage: 4_000_000,
    timeoutMs: TIMEOUT_MS,
  });
  const durationMs = performance.now() - started;
  const output = await stat(result.outputPath);
  const usage = process.resourceUsage();

  await cleanupWorkspaceRun(result);
  for (const file of files) await rm(file.path, { force: true });

  return {
    scenario: name,
    files: files.length,
    operations: scenario.operations.length,
    pages: result.totalPages,
    inputBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    outputBytes: output.size,
    durationMs,
    maxRssMb: usage.maxRSS / 1024,
    detail: `${result.zip ? 'ZIP' : 'PDF'} · ${result.outputs.length} output(s) · ${result.operationCount} step(s)`,
  };
}

async function main(): Promise<void> {
  const scenario = process.argv.find((arg) => arg.startsWith('--scenario='))?.slice(11);
  const dirArg = process.argv.find((arg) => arg.startsWith('--dir='))?.slice(6);

  if (scenario) {
    if (!dirArg) throw new Error('Child mode needs --dir');
    const row = await runScenario(scenario, dirArg);
    console.log(`BENCH ${JSON.stringify(row)}`);
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), 'notesprint-ws-bench-'));
  try {
    console.log(
      `Workspace benchmark: ${PAGE_COUNT} pages per scenario (2 inputs split evenly)`,
    );
    console.log(`Node ${process.version}, platform ${process.platform}/${process.arch}`);
    console.log('');

    const header = [
      'scenario'.padEnd(21),
      'files'.padStart(5),
      'ops'.padStart(4),
      'pages'.padStart(5),
      'output'.padStart(10),
      'duration'.padStart(10),
      'peak RSS'.padStart(10),
      'result',
    ].join('  ');
    console.log(header);
    console.log('-'.repeat(header.length));

    const script = fileURLToPath(import.meta.url);
    for (const name of Object.keys(SCENARIOS)) {
      if (ONLY && !ONLY.includes(name)) continue;
      const child = spawnSync(
        process.execPath,
        [
          '--max-semi-space-size=2',
          '--import',
          'tsx',
          script,
          `--scenario=${name}`,
          `--dir=${workDir}`,
        ],
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
          row.scenario.padEnd(21),
          String(row.files).padStart(5),
          String(row.operations).padStart(4),
          String(row.pages).padStart(5),
          `${(row.outputBytes / 1024).toFixed(0)} KiB`.padStart(10),
          `${row.durationMs.toFixed(0)} ms`.padStart(10),
          `${row.maxRssMb.toFixed(0)} MB`.padStart(10),
          row.detail,
        ].join('  '),
      );
    }

    console.log('');
    console.log('Each child runs with --max-semi-space-size=2, matching production start.');
    console.log('Render Free has 512 MB and 0.1 CPU; timings are from the local machine.');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

await main();
