// ============================================================
// middleware/metrics.ts — Prometheus-метрики
// Экспозиция на /metrics, счётчики HTTP, latency, active attempts.
// ============================================================

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

// Собственный реестр (не глобальный), чтобы избежать конфликтов
const registry = new Registry();

// Системные метрики Node.js: CPU, memory, event loop lag
collectDefaultMetrics({ register: registry, prefix: 'ulybka_' });

const httpRequestsTotal = new Counter({
  name: 'ulybka_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

const httpRequestDuration = new Histogram({
  name: 'ulybka_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

const dbQueriesTotal = new Counter({
  name: 'ulybka_db_queries_total',
  help: 'Total DB queries',
  labelNames: ['operation'] as const,
  registers: [registry],
});

const activeAttemptsGauge = new Gauge({
  name: 'ulybka_active_attempts',
  help: 'Currently in-progress attempts',
  registers: [registry],
});

const queueJobsTotal = new Counter({
  name: 'ulybka_queue_jobs_total',
  help: 'Total queue jobs processed',
  labelNames: ['queue', 'status'] as const,
  registers: [registry],
});

export const metrics = {
  httpRequestsTotal,
  httpRequestDuration,
  dbQueriesTotal,
  activeAttemptsGauge,
  queueJobsTotal,
};

export default fp(async function metricsPlugin(app: FastifyInstance) {
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url;
    const labels = {
      method: req.method,
      route,
      status: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
});