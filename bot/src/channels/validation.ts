export type ParsedChannelRef =
  | { kind: 'username'; ref: string; username: string }
  | { kind: 'id'; ref: string; chatId: number };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const TELEGRAM_LINK_PREFIX = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\b/i;
const USERNAME_RE = /^@?([A-Za-z][A-Za-z0-9_]{4,31})$/;
const CHAT_ID_RE = /^-\d{5,}$/;
const JOIN_PATH_RE =
  /^\/(?:\+[A-Za-z0-9_-]{8,}|joinchat\/[A-Za-z0-9_-]{8,}|[A-Za-z][A-Za-z0-9_]{4,31})$/;

export function parseChannelRef(input: string): ParseResult<ParsedChannelRef> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Send @username or a numeric chat ID.' };
  }

  if (TELEGRAM_LINK_PREFIX.test(trimmed) || trimmed.startsWith('+')) {
    return {
      ok: false,
      error:
        'That is a link, not a chat ID. Invite links are join URLs only. Send @username or the numeric -100… chat ID.',
    };
  }

  const usernameMatch = USERNAME_RE.exec(trimmed);
  if (usernameMatch) {
    const username = (usernameMatch[1] as string).toLowerCase();
    return { ok: true, value: { kind: 'username', ref: `@${username}`, username } };
  }

  if (CHAT_ID_RE.test(trimmed)) {
    const chatId = Number(trimmed);
    if (!Number.isSafeInteger(chatId) || chatId >= 0) {
      return { ok: false, error: 'That numeric chat ID is not valid.' };
    }
    return { ok: true, value: { kind: 'id', ref: String(chatId), chatId } };
  }

  return {
    ok: false,
    error:
      'Could not read that. Send @username or a numeric -100… chat ID. Invite links cannot be used as chat IDs.',
  };
}

export function parseJoinUrl(input: string): ParseResult<string> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Send a t.me join link.' };
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'The join link must use https.' };
  }
  if (url.hostname !== 't.me') {
    return { ok: false, error: 'The join link must be a t.me link.' };
  }
  if (!JOIN_PATH_RE.test(url.pathname)) {
    return { ok: false, error: 'That t.me link does not look like a channel join link.' };
  }

  return { ok: true, value: `https://t.me${url.pathname}${url.search}` };
}

export function deriveJoinUrl(username: string): string {
  return `https://t.me/${username}`;
}

export function normalizeChannelRef(ref: string): string {
  return ref.trim().toLowerCase();
}
