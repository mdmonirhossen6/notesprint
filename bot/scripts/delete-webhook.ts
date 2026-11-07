import { Bot } from 'grammy';
import { loadConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = new Bot(config.botToken, {
    client: { apiRoot: config.botApiRoot },
  });

  const result = await bot.api.deleteWebhook({ drop_pending_updates: false });
  console.log(JSON.stringify({ ok: result }));
  console.log('Webhook removed. Stop the webhook server before switching to polling.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: 'error', event: 'delete_webhook_failed', message }));
  process.exit(1);
});
