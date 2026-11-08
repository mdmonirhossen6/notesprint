import type { Context } from 'grammy';
import type { BotDeps } from './types.js';
import { editOrReply, joinRequiredKeyboard, joinRequiredText } from './ui.js';

export async function ensureMembership(ctx: Context, deps: BotDeps): Promise<boolean> {
  if (!ctx.from) return false;

  const summary = await deps.membership.check(ctx.from.id);
  if (summary.allJoined) return true;

  const lang = deps.languages.resolve(ctx.from.id, ctx.from.language_code);
  await editOrReply(ctx, joinRequiredText(lang, summary), joinRequiredKeyboard(lang, summary));
  return false;
}
