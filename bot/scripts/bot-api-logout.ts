const CLOUD_API_ROOT = 'https://api.telegram.org';
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

function fail(message: string): never {
  console.error(`bot-api-logout: ${message}`);
  process.exit(1);
}

const token = process.env.BOT_TOKEN?.trim();
if (!token || !TOKEN_RE.test(token)) {
  fail('BOT_TOKEN is missing or malformed (the value was not printed).');
}

if (process.env.CONFIRM_LOGOUT !== 'yes') {
  console.error(
    [
      'Refusing to log out without explicit confirmation.',
      '',
      'logOut detaches the bot from the Bot API server you target and can interrupt updates.',
      'For the cloud -> local migration, run it against the cloud API before starting the local server.',
      'For a local -> cloud rollback, target the local server instead.',
      '',
      `Cloud target (default): ${CLOUD_API_ROOT}`,
      'Local target:            LOGOUT_API_ROOT=http://127.0.0.1:8081',
      '',
      'Re-run with CONFIRM_LOGOUT=yes when you are ready.',
    ].join('\n'),
  );
  process.exit(1);
}

const target = (process.env.LOGOUT_API_ROOT?.trim() || CLOUD_API_ROOT).replace(/\/+$/, '');
let targetUrl: URL;
try {
  targetUrl = new URL(target);
} catch {
  fail('LOGOUT_API_ROOT is not a valid URL.');
}

const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
if (targetUrl.protocol !== 'https:' && !localHosts.includes(targetUrl.hostname)) {
  fail('LOGOUT_API_ROOT must use https unless it points to localhost.');
}
if (targetUrl.username || targetUrl.password || targetUrl.search) {
  fail('LOGOUT_API_ROOT must not contain credentials or a query string.');
}

const endpoint = `${target}/bot${token}/logOut`;

let response: Response;
try {
  response = await fetch(endpoint, { method: 'POST' });
} catch {
  fail(`Could not reach ${targetUrl.host}.`);
}

let payload: { ok?: boolean; description?: string } | null = null;
try {
  payload = (await response.json()) as { ok?: boolean; description?: string };
} catch {
  payload = null;
}

if (!response.ok || payload?.ok !== true) {
  const reason = payload?.description ? `: ${payload.description}` : '';
  fail(`logOut failed with HTTP ${response.status}${reason}`);
}

console.log(`bot-api-logout: logOut succeeded against ${targetUrl.host}.`);
if (targetUrl.hostname === new URL(CLOUD_API_ROOT).hostname) {
  console.log(
    'Start the local Bot API server and the bot next. Cloud Bot API access stays unavailable for about 10 minutes.',
  );
} else {
  console.log(
    'Local logout complete. Stop the local server, restore the cloud BOT_API_ROOT, and wait about 10 minutes before relying on the cloud Bot API.',
  );
}
