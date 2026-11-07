import type { Context, MiddlewareFn } from 'grammy';
import type { AppConfig } from '../../config.js';
import { getAccessRole } from '../../auth/access.js';

async function deny(ctx: Context): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx
      .answerCallbackQuery({ text: 'Not authorized.', show_alert: true })
      .catch(() => undefined);
  } else {
    await ctx.reply('Not authorized.');
  }
}

export function requireSuperAdmin(config: AppConfig): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!ctx.from) return;
    if (getAccessRole(ctx.from.id, config.superAdminId) !== 'super_admin') {
      await deny(ctx);
      return;
    }
    await next();
  };
}
