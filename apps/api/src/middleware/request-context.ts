// ============================================================
// request-context.ts — плагин Fastify: requestId, IP, UA,
// fingerprint, request start time. Пишет requestId в ответ.
// ============================================================

import fp from 'fastify-plugin';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string;
  fingerprint: string;
  startedAt: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

function fingerprintOf(req: FastifyRequest): string {
  const parts = [
    req.headers['user-agent'] ?? '',
    req.headers['accept-language'] ?? '',
    req.headers['accept-encoding'] ?? '',
    req.ip ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

export default fp(async function requestContext(app: FastifyInstance) {
  app.decorateRequest('ctx', null as unknown as RequestContext);

  app.addHook('onRequest', async (req, reply) => {
    const requestId = (req.id as string) ?? crypto.randomUUID();
    req.ctx = {
      requestId,
      ip: req.ip ?? '0.0.0.0',
      userAgent: (req.headers['user-agent'] as string) ?? '',
      fingerprint: fingerprintOf(req),
      startedAt: Date.now(),
    };
    reply.header('X-Request-Id', requestId);
  });
});