import { Bot } from 'grammy';
import { loadConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.botMode !== 'webhook' || !config.webhookUrl || !config.webhookSecret) {
    throw new Error('Set BOT_MODE=webhook, WEBHOOK_URL and WEBHOOK_SECRET before running this script');
  }

  const bot = new Bot(config.botToken, {
    client: { apiRoot: config.botApiRoot },
  });

  const result = await bot.api.setWebhook(config.webhookUrl, {
    secret_token: config.webhookSecret,
    allowed_updates: ['message', 'callback_query'],
  });

  console.log(JSON.stringify({ ok: result, path: new URL(config.webhookUrl).pathname }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: 'error', event: 'set_webhook_failed', message }));
  process.exit(1);
});
