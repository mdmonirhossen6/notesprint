# NoteSprint Telegram bot (stateless)

Telegram-native PDF intake and processing. The Next.js website stays in the repository
root; this folder is a separate Node.js service designed for **Render Free Web Service**.

The active runtime is **stateless**. The primary experience is a per-user **PDF
workspace**: upload PDFs once, then build an editable pipeline of operations and run it
without re-uploading.

1. The user opens **New PDF Workspace**, **My Current Workspace**, or **Available PDF
   Tools** from the bilingual main menu.
2. The bot validates the MIME type and declared size (max **19 MiB**) per file.
3. Each file is streamed to a unique file in `/tmp`; duplicates in the same workspace are
   rejected before download.
4. The workspace keeps up to **10 files**, **40 MB combined**, and **300 pages** for 30
   minutes of inactivity. Files can be added, removed, reordered, and replaced.
5. The user builds a typed pipeline from Document Organization, Color & Image, Printing &
   Layout, and Personalization operations, then reviews the preview.
6. Vector tools use `pdf-lib` and preserve text and vectors. Color tools render pages
   sequentially with `pdfjs-dist`, Node canvas, and Sharp.
7. The result is sent back to the same Telegram chat (max **49 MB**). Multi-file output is
   returned as a ZIP.
8. All input, intermediate, and output files are deleted after delivery, cancellation,
   workspace expiry, or failure. Originals are kept on failure/cancel so Retry does not
   need another upload.
9. A maintenance sweep removes abandoned temp files, expired workspaces, and language
   preferences.

Nothing is archived. No file is sent to R2, Supabase, or any other storage provider. The
service keeps no database and no persistent user history.

## What is live

- grammY bot with long polling (local) and webhook (Render) modes.
- **Unified PDF workspace**: upload once, then apply many operations without re-uploading.
  Workspaces are private per Telegram user and expire after 30 minutes of inactivity.
- **Two processing modes**: Combine First (merge all uploads, run the pipeline once) and
  Process Individually (run the pipeline per upload; multiple results return as ZIP).
- **Pipeline editing**: add, configure, remove, reorder, clear, preview, and run operations.
  Originals are preserved until successful delivery.
- **Document Organization**: split (every page, equal groups, extract), page selection
  (keep/remove), reorder, rotate (all or selected pages).
- **Color & Image**: grayscale, black & white with thresholds, invert, clear background.
- **Printing & Layout**: N-up 2/4/6/9 on A4/A3/A5/Letter/Legal, orientation, margins,
  gaps, separators, and page numbers.
- **Personalization**: text watermark, PDF metadata editor, optional Asia/Dhaka timestamp
  footer, and custom footer with page numbers and timestamp.
- **Smart presets**: Print Friendly, Compact Notes, Ink Saver, and Presentation Print.
  Every generated step remains editable.
- **Full Bangla/English UI** with a language selector, `/language`, and Telegram
  `language_code` inference. Preferences are in memory and expire after 30 days.
- Static channel membership gate from `REQUIRED_CHANNELS`, cached in memory for
  2-5 minutes. Admins bypass the gate. Telegram API errors fail closed.
- Super admin access from `SUPER_ADMIN_ID`; the admin panel shows current jobs, active
  workspaces, sessions, and the static channel list.
- PDF24 compression guidance for files above the limit. The button opens an external
  service; the bot never uploads anything to it.
- **Merge PDFs**: send 2-10 documents one at a time, then tap **Finish Uploading**. Files
  are merged in the order they were received, page sizes are preserved, and the result is
  a single vector PDF. Per-file 19 MiB, combined 40 MB, 300 pages, 49 MB output.
- Streaming download with a hard byte limit, transfer timeout, `%PDF-` header check,
  and real-size re-check.
- One PDF job at a time (`PROCESS_CONCURRENCY=1`) and one job per user, with `/cancel`
  and timeout support.
- Duplicate-processing prevention: a second upload while a job is active is rejected.
- Merge sessions live in memory for 30 minutes, use their own cancellation signal, and
  are pruned with their temp files by the maintenance sweep.
- Tool sessions remain available for the legacy single-tool flow; the workspace is the
  default path in the main menu.
- Temp cleanup on success, failure, cancellation, timeout, startup, and every five
  minutes.
- Health endpoint at `/healthz` that does not depend on any external service.
- 135 tests covering config, membership, jobs, PDF validation, merge order/limits, page
  parsing, vector tools, raster pixel output, N-up layout, workspace stores, simulation,
  bilingual dictionaries, full combine/individual pipelines, ZIP output, personalization,
  cleanup, UI, and resource limits.

## Processing behaviour

`Process PDF` loads the file with `pdf-lib`, validates it, enforces the page cap, and
returns a clean re-saved copy. `Merge PDFs` copies every page from each input into one
new document in receipt order; it never rasterises. Split, page selection, reorder,
rotate, and N-up also use `pdf-lib`, so text, vectors, and page sizes are preserved.

Color tools are different: each page is rendered with `pdfjs-dist` into a Node canvas,
filtered, and re-embedded as an image. They are intentionally sequential and have lower
page caps because they need far more memory than vector operations.

| Operation | Implementation | Status |
|---|---|---|
| Workspace pipeline (combine / individual) | `workspace/run.ts` + `yazl` | Live |
| Split (extract, every page, equal groups, ZIP) | `pdf-lib.copyPages` + `yazl` | Live |
| Page selection (keep / remove) | `pdf-lib.copyPages` | Live |
| Page reorder (explicit full order) | `pdf-lib.copyPages` | Live |
| Rotate 90/180/270, all or selected | `pdf-lib` page rotation | Live |
| Grayscale / invert / clear background | pdfjs + canvas + Sharp | Live |
| Black & white, 3 thresholds | pdfjs + canvas + Sharp | Live |
| N-up 2/4/6/9, paper, orientation, margins, gaps, separators, page numbers | `pdf-lib.embedPage` | Live |
| Text watermark, opacity, rotation, position, selected pages | `pdf-lib.drawText` | Live |
| Metadata editor (title, author, subject, keywords) | `pdf-lib` document metadata | Live |
| Timestamp footer (Asia/Dhaka) | `pdf-lib` footer band | Live |
| Custom footer (text, page numbers, timestamp) | `pdf-lib` footer band | Live |
| Enhance / OCR / logo removal | — | Not implemented; no button exposed |

### Workspace model and limits

The workspace is a typed pipeline, not a chain of ad-hoc uploads. Files are stored once
and every operation reads from the previous stage's output. Intermediate files live in a
unique work directory and are removed as soon as a stage completes; originals remain until
the final result is delivered. On failure or cancellation the originals stay in the
workspace for Retry.

- 10 files, 40 MB combined, 300 pages combined, 49 MB output.
- 19 MiB per uploaded file, one heavy job at a time.
- Maximum 40 pipeline outputs; split steps multiply the file count.
- Watermark and footer text must be drawable with the standard PDF fonts (Latin letters,
  digits, and common punctuation). Bengali PDF text is rejected with a localized message.
- Split is multi-output; later compatible operations run on each result and the final
  bundle is a ZIP when there is more than one file.
- Incompatible combinations are rejected in Review before processing starts.

### Language

All menu, button, status, error, upload, help, privacy, and admin strings come from
central dictionaries (`src/bot/i18n.ts`). Bengali is the fallback when Telegram does not
report a supported language. Preferences live in memory for 30 days. A Render restart or
free-plan sleep clears workspaces, language preferences, and temporary files.

### Privacy and restart behaviour

Workspace state is private to the Telegram user and chat. PDFs are never archived and are
never uploaded to an external compression service automatically. If the Render Free
instance restarts or sleeps, active workspaces and their temp files are lost; the bot
explains this in the workspace and help screens.

Quality caps for raster tools are enforced in the settings panel and again at processing
time:

| Quality | DPI | Grayscale / Invert / Clear | Black & White |
|---|---|---|---|
| Low | 100 | 30 pages | 20 pages |
| Medium | 150 | 20 pages | 12 pages |
| High | 200 | 12 pages | 8 pages |

`RASTER_MAX_PAGES` is an additional absolute cap. A PDF above the selected quality's cap
is rejected before rendering with a message suggesting a lower quality. This is deliberate:
the caps come from measured peak memory on a 512 MB instance.

## Performance notes

`npm run benchmark` runs two suites: the single-tool benchmark and the workspace pipeline
benchmark. Both use 12 generated pages and run with `--max-semi-space-size=2`. Peak RSS is
from `process.resourceUsage().maxRSS` in a separate child process per operation. Use
`BENCH_IMAGE=1 npm run benchmark` for the image-heavy single-tool fixture.

Workspace pipeline (12 pages across two inputs, 6 pages each):

| Scenario | Files | Steps | Output | Duration | Peak RSS |
|---|---|---|---|---|---|
| Combine, merge only | 2 | 0 | 8 KiB PDF | 14 ms | 96 MB |
| Combine, merge + rotate + watermark + timestamp + footer | 2 | 4 | 21 KiB PDF | 152 ms | 116 MB |
| Individual, split two 6-page PDFs into 12 pages, ZIP | 2 | 1 | 16 KiB ZIP | 64 ms | 99 MB |
| Single file, grayscale + N-up 4 | 1 | 2 | 673 KiB PDF | 2.1 s | 329 MB |

Single-tool benchmarks:

Vector fixture (13 KiB input):

| Operation | Duration | Peak RSS | Output |
|---|---|---|---|
| Split every page | 67 ms | 97 MB | 21 KiB ZIP |
| Page selection | 22 ms | 90 MB | 7 KiB PDF |
| Reorder | 23 ms | 90 MB | 13 KiB PDF |
| Rotate | 21 ms | 90 MB | 13 KiB PDF |
| Grayscale 150 DPI | 1.9 s | 331 MB | 1.2 MiB PDF |
| Black & White 150 DPI | 3.7 s | 386 MB | 150 KiB PDF |
| Invert 150 DPI | 1.9 s | 330 MB | 1.3 MiB PDF |
| Clear background 150 DPI | 2.0 s | 339 MB | 1.2 MiB PDF |
| N-up 4-in-1 | 58 ms | 97 MB | 29 KiB PDF |

Image-heavy fixture (10.3 MiB, noise-image pages):

| Operation | Duration | Peak RSS | Output |
|---|---|---|---|
| Split every page | 408 ms | 124 MB | 10.3 MiB ZIP |
| Page selection | 42 ms | 104 MB | 5.2 MiB PDF |
| Reorder | 49 ms | 109 MB | 10.3 MiB PDF |
| Rotate | 56 ms | 110 MB | 10.3 MiB PDF |
| Grayscale 150 DPI | 6.2 s | 392 MB | 10.1 MiB PDF |
| Black & White 150 DPI | 10.7 s | 428 MB | 4.2 MiB PDF |
| Invert 150 DPI | 5.9 s | 391 MB | 11.7 MiB PDF |
| Clear background 150 DPI | 5.8 s | 382 MB | 11.7 MiB PDF |
| N-up 4-in-1 | 84 ms | 116 MB | 10.3 MiB PDF |

These are local Windows timings on a development machine, not Render measurements.
Render Free's 0.1 CPU is substantially slower, so expect raster jobs to take much longer
there. A 20-page image-heavy PDF is near the memory ceiling even with the caps, which is
why the B&W quality caps are strict. Jobs are processed one at a time to keep the peak
bounded.

## Render deployment

### 1. Push the repository to GitHub

Render deploys from a connected GitHub repository. The service root is this `bot/`
folder, not the website root.

### 2. Create a Web Service

In Render: **New → Web Service → connect the repository**, then set:

| Setting | Value |
|---|---|
| Root Directory | `bot` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start:prod` |
| Health Check Path | `/healthz` |
| Instance Type | Free |

`npm run start:prod` runs `node --max-semi-space-size=2 dist/src/index.js`. Render
provides `PORT` automatically; do not hardcode it in production. `bot/.node-version`
pins Node 22, which satisfies the `engines` requirement in `package.json`. The smaller
semi-space keeps the raster peak around the measured values; it is not a general heap
limit, so vector PDFs are not artificially constrained.

### 3. Environment variables

Set these in **Dashboard → Environment**. Only `BOT_TOKEN` is secret.

| Variable | Required | Value / example |
|---|---|---|
| `BOT_TOKEN` | yes | New token from @BotFather. Never commit or log it. |
| `SUPER_ADMIN_ID` | yes | `6885443469` |
| `BOT_MODE` | yes | `webhook` |
| `WEBHOOK_URL` | yes (webhook) | `https://<service-name>.onrender.com/telegram` |
| `WEBHOOK_SECRET` | yes (webhook) | 16-256 chars, e.g. `openssl rand -hex 32` |
| `WEBHOOK_PATH` | no | `/telegram` |
| `NODE_ENV` | no | `production` |
| `LOG_LEVEL` | no | `info` |
| `REQUIRED_CHANNELS` | no | `@prostutibd,@admissionfreepdf` (empty disables the gate) |
| `PROSTUTI_APP_URL` | no | `https://prostuti.bd` |
| `MAX_UPLOAD_MB` | no | `19` (maximum allowed: 20) |
| `MAX_OUTPUT_MB` | no | `49` (maximum allowed: 49) |
| `MAX_PDF_PAGES` | no | `300` |
| `RASTER_MAX_PAGES` | no | `30` (absolute; quality caps still apply) |
| `RASTER_MAX_PIXELS_PER_PAGE` | no | `4000000` |
| `MERGE_MAX_FILES` | no | `10` (range 2-20) |
| `MERGE_MAX_TOTAL_MB` | no | `40` (range 2-49) |
| `PROCESS_TIMEOUT_SECONDS` | no | `180` |
| `FILE_TRANSFER_TIMEOUT_SECONDS` | no | `120` |
| `TEMP_FILE_TTL_MINUTES` | no | `60` |
| `UPLOAD_RATE_LIMIT_COUNT` | no | `10` |
| `UPLOAD_RATE_LIMIT_WINDOW_MINUTES` | no | `60` |
| `MEMBERSHIP_CACHE_TTL_SECONDS` | no | `180` |

There is no database, queue, Redis, Docker, or storage variable. Do not add one for this
version.

### 4. Register the webhook once

After the first successful deploy, open the Render service **Shell** (or run this locally
with `BOT_TOKEN`, `WEBHOOK_URL`, and `WEBHOOK_SECRET` set) and run:

```bash
npm run set-webhook
```

This calls Telegram's `setWebhook` with the URL and secret token. The bot does **not**
change the webhook automatically on startup or deploy. If the Render URL changes, update
`WEBHOOK_URL` and run the command again.

To remove it:

```bash
npm run delete-webhook
```

### 5. Verify

```bash
curl -s https://<service-name>.onrender.com/healthz
```

Expected: `{"ok":true,"version":"...","uptimeSeconds":...}`.

In Telegram: send `/start`, join the required channels, tap **Verify Membership**, then
tap **Process PDF** and send a PDF as a document. For merging, tap **Merge PDFs**, send
2 or more PDFs in order, tap **Finish Uploading**, and confirm the returned page count.
For the other tools, pick Split, Page Selection, Reorder, Rotate, Color Tools, or N-up,
send one PDF, choose settings with the inline buttons, and tap **Process**. Color tools
have quality-dependent page caps shown in the panel. A successful run deletes every
temporary copy.

## Render free-plan limitations

These are properties of the free instance, not bugs:

- **Sleep after inactivity.** The service sleeps after about 15 minutes without traffic.
  The first update after sleep waits for a cold start (tens of seconds); Telegram retries
  the webhook in the meantime.
- **In-memory state is lost on sleep, restart, or redeploy.** Upload sessions, rate-limit
  windows, membership cache, and queued jobs disappear. A job in progress is interrupted;
  the user should resend the file.
- **Ephemeral disk.** Anything in `/tmp` disappears on restart. The bot deletes files
  immediately anyway, and startup sweeps leftovers.
- **No persistent admin settings.** Activity-session limits, channel lists, and other
  admin values come from environment variables and reset to those values on restart.
  Changing `REQUIRED_CHANNELS` requires a redeploy/restart.
- **One instance.** Do not scale the service to multiple instances: webhook delivery and
  the one-job-at-a-time guarantee assume a single process.
- **Telegram Cloud Bot API limits.** Downloads are limited to 20 MB and uploads to 50 MB.
  The bot enforces 19 MiB in and 49 MB out. Larger files get PDF24 compression guidance.

## Local development

```bash
cd bot
cp .env.example .env
# set BOT_TOKEN and SUPER_ADMIN_ID in .env
npm ci
npm run typecheck
npm test
npm run dev
```

`npm run dev` uses long polling and needs no public URL. To test webhook mode locally you
need an HTTPS tunnel and `BOT_MODE=webhook`.

## How a job runs

Single-file Process:

```
user document
  -> membership + duplicate-job check
  -> declared-size check (19 MiB)
  -> free-disk check
  -> rate limit
  -> upload session must be active
  -> job runner reserves the user
  -> queue (concurrency 1)
  -> stream download to /tmp
  -> validate header + real size
  -> pdf-lib load / page cap / re-save
  -> sendDocument from disk
  -> delete input + output in finally
```

Merge:

```
tap Merge PDFs
  -> membership + duplicate-job check
  -> in-memory merge session (30 min TTL)
each document
  -> membership + per-file size + disk + rate limit
  -> reserve slot, download to /tmp, count pages
  -> commit in Telegram message order
  -> reject a file that pushes combined size or pages over the cap
tap Finish Uploading
  -> need 2+ files, no pending download, combined <= 40 MB
  -> job runner reserves the user, session files are detached
  -> queue (concurrency 1)
  -> pdf-lib copyPages in order, save one PDF
  -> sendDocument from disk
  -> delete every input + output in finally
```

Single-file tool (Split, Page Selection, Reorder, Rotate, Color, N-up):

```
tap a tool
  -> membership + duplicate-job check
  -> in-memory tool session (30 min TTL)
send one document
  -> membership + metadata + disk + rate limit
  -> job runner reserves the user, download and count pages
  -> validate the page cap for the tool and selected quality
  -> show a settings panel with inline buttons
choose settings (ranges, order, angle, quality, paper, margins, numbering, ...)
  -> panel revalidates the selection; Process stays unavailable until ready
tap Process
  -> job runner reserves the user, tool session is detached
  -> queue (concurrency 1)
  -> pdf-lib vector operation OR sequential pdfjs/canvas/Sharp raster loop
  -> enforce output size and progress to the chat
  -> sendDocument or ZIP from disk
  -> delete input + output in finally
```

Cancel or Retry is available at every step. A tool session used in one chat cannot be
continued from another chat, and a second job per user is rejected.

Failures map to clear replies: file too large, not a PDF, damaged or password-protected
PDF, too many pages, raster page cap for the selected quality, too many files, combined
size limit, invalid page selection, output too large, timeout, cancelled, disk space, or
Telegram transfer failure. Temp files are removed on all of them.

## Security rules

- `bot/.env` is ignored by git. Keep it `chmod 600`.
- Never log the bot token, webhook secret, or file contents. Logs contain event names,
  user IDs, sizes, and error messages only.
- Validate MIME type, real size, PDF header, page count, and free disk before processing.
- Use random temp names with mode `0600` and a dedicated temp directory.
- Never treat an invite URL as a chat ID; `REQUIRED_CHANNELS` accepts `@username` or a
  numeric `-100...` chat ID only.
- Authorize every admin callback independently. Only `SUPER_ADMIN_ID` can open the admin
  panel.
- Never archive files or send them to a third party. Compression is a user-initiated
  external link; the bot itself uploads nothing.

## Leaked credential warning

A previous bot token was hardcoded in `src/app/api/feedback/route.ts`. The fallback is
removed from the current code, but the token remains in public git history and must be
treated as compromised:

1. Open @BotFather, run `/revoke`, and create a new token.
2. Put the new token only in Render's environment (and `bot/.env` locally).
3. Clean history with `git filter-repo` or BFG, then force-push after coordinating with
   anyone who has clones.

Never reuse the old token.

## Not used by the stateless service

Earlier SQLite modules (`src/db`, `src/users`, `src/channels/repository.ts`,
`src/channels/membership.ts`, `src/bot/middleware/admin.ts`), the dynamic channel manager
under `legacy/`, and the Docker/local Bot API files under `docker/` are kept for
reference. They are not imported by the active runtime. The Render build and start
commands use only `src/index.ts` and its stateless imports.
