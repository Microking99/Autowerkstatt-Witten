import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { App } from '../types';

export async function healthRoutes(app: App): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: z.object({ status: z.literal('ok'), database: z.literal('ok'), time: z.string() }),
          503: z.object({ status: z.literal('degraded'), database: z.literal('error'), time: z.string() }),
        },
      },
    },
    async (_request, reply) => {
      const time = app.deps.now().toISOString();
      try {
        await app.deps.db.execute(sql`SELECT 1`);
        return reply.code(200).send({ status: 'ok' as const, database: 'ok' as const, time });
      } catch {
        return reply.code(503).send({ status: 'degraded' as const, database: 'error' as const, time });
      }
    },
  );
}
