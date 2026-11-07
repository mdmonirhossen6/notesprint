# NoteSprint Telegram bot (stateless)

Telegram-native PDF intake and processing. The Next.js website stays in the repository
root; this folder is a separate Node.js service designed for **Render Free Web Service**.

The active runtime is **stateless**:

1. The user sends a PDF as a document.
2. The bot validates the MIME type and declared size (max **19 MiB**).
3. The file is streamed to a unique file in `/tmp`.
4. `pdf-lib` loads, validates, and re-saves the PDF to a temporary output.
5. The result is sent back to the same Telegram chat (max **49 MB**).
6. The input and output files are deleted in a `finally` block on every path.
7. A maintenance sweep removes abandoned temp files and expired in-memory state.

Nothing is archived. No file is sent to R2, Supabase, or any other storage provider. The
service keeps no database and no persistent user history.

## What is live

- grammY bot with long polling (local) and webhook (Render) modes.
- Static channel membership gate from `REQUIRED_CHANNELS`, cached in memory for
  2-5 minutes. Admins bypass the gate. Telegram API errors fail closed.
- Super admin access from `SUPER_ADMIN_ID`; the admin panel shows current jobs and the
  static channel list.
- PDF24 compression guidance for files above the limit. The button opens an external
  service; the bot never uploads anything to it.
- Streaming download with a hard byte limit, transfer timeout, `%PDF-` header check,
  and real-size re-check.
- One PDF job at a time (`PROCESS_CONCURRENCY=1`) and one job per user, with `/cancel`
  and timeout support.
- Duplicate-processing prevention: a second upload while a job is active is rejected.
- Temp cleanup on success, failure, cancellation, timeout, startup, and every five
  minutes.
- Health endpoint at `/healthz` that does not depend on any external service.
- Tests for config, membership, jobs, PDF validation, UI, and limits.

## Current processing behaviour

The initial server-side processor uses `pdf-lib` to load and re-save the PDF with object
streams. It validates the file, enforces the page cap, and produces a clean PDF copy. It
does not do OCR, handwriting cleanup, N-up imposition, merging, or enhancement yet; those
tool buttons show an honest placeholder. The point of this version is a complete, safe,
stateless delivery loop on free hosting.

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

`npm run start:prod` runs `node dist/src/index.js`. Render provides `PORT`
automatically; do not hardcode it in production. `bot/.node-version` pins Node 22, which
satisfies the `engines` requirement in `package.json`.

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
tap **Process PDF** and send a PDF as a document. A successful run replies with the
processed file and the temporary copies are deleted.

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

Failures map to clear replies: file too large, not a PDF, damaged or password-protected
PDF, too many pages, timeout, cancelled, disk space, or Telegram transfer failure. Temp
files are removed on all of them.

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
