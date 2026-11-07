import type { Context, MiddlewareFn } from 'grammy';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/database.js';
import { getAdminRole } from '../../auth/roles.js';

async function deny(ctx: Context): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx
      .answerCallbackQuery({ text: 'Not authorized.', show_alert: true })
      .catch(() => undefined);
  } else {
    await ctx.reply('Not authorized.');
  }
}

export function requireAdmin(config: AppConfig, db: Database): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!ctx.from) return;

    const role = getAdminRole(db, ctx.from.id, config.superAdminId);
    if (!role) {
      await deny(ctx);
      return;
    }

    await next();
  };
}

export function requireSuperAdmin(config: AppConfig, db: Database): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!ctx.from) return;

    const role = getAdminRole(db, ctx.from.id, config.superAdminId);
    if (role !== 'super_admin') {
      await deny(ctx);
      return;
    }

    await next();
  };
}
