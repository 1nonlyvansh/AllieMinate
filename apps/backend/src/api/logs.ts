import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { saveUserLog, recordAutomatedLog, listLogs, listLogImages, logsRoot } from '../logs';

export function registerLogRoutes(app: FastifyInstance): void {
  app.get('/logs', async () => ({
    logs: listLogs().map((l) => ({ ...l, dirPath: path.join(logsRoot(), l.id), imagePaths: listLogImages(l.id) })),
  }));

  app.post<{ Body: { description: string; images?: { name: string; dataUrl: string }[] } }>(
    '/logs',
    async (req, reply) => {
      const description = req.body.description?.trim();
      if (!description) return reply.code(400).send({ error: 'missing description' });
      const meta = saveUserLog(description, req.body.images ?? []);
      return { ok: true, log: meta };
    },
  );

  // called by the Electron main process after the backend crashes and comes back up — main process has no
  // clean way to write into this same log store itself (it doesn't share this process's data-path/username
  // resolution), so it just asks the backend to record it once the backend is reachable again.
  app.post<{ Body: { message: string } }>('/logs/automated', async (req, reply) => {
    const message = req.body.message?.trim();
    if (!message) return reply.code(400).send({ error: 'missing message' });
    const meta = recordAutomatedLog(message);
    return { ok: true, log: meta };
  });
}
