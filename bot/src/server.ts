import { createServer, type Server } from 'node:http';
import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import { BOT_VERSION } from './version.js';

export function startHttpServer(bot: Bot, config: AppConfig, logger: Logger): Server {
  if (!config.webhookSecret) {
    throw new Error('Webhook secret is missing');
  }

  const handleWebhook = webhookCallback(bot, 'http', {
    secretToken: config.webhookSecret,
    onTimeout: 'return',
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          version: BOT_VERSION,
          uptimeSeconds: Math.round(process.uptime()),
        }),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === config.webhookPath) {
      try {
        await handleWebhook(req, res);
      } catch (error) {
        logger.error('webhook_failed', {}, error);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('webhook failed');
        }
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  server.listen(config.port, () => {
    logger.info('http_listening', { port: config.port, webhookPath: config.webhookPath });
  });

  return server;
}
