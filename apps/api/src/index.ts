// ============================================================
// index.ts — точка входа Fastify
// + плагин /metrics для Prometheus.
// ============================================================

import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';

import { config } from './config.js';
import { logger } from './lib/logger.js';
import { redis, pingRedis, closeRedis } from './lib/redis.js';
import { db, pingDatabase, closeDatabase } from './db/client.js';
import { closeQueues } from './lib/queues.js';
import { AppError } from './lib/errors.js';
import requestContext from './middleware/request-context.js';
import metricsPlugin from './middleware/metrics.js';

import { authRoutes } from './modules/auth/index.js';
import { usersRoutes } from './modules/users/index.js';
import { notificationsRoutes } from './modules/notifications/index.js';
import { subjectsRoutes } from './modules/subjects/index.js';
import { testsRoutes } from './modules/tests/index.js';
import { questionsRoutes } from './modules/questions/index.js';
import { attemptsRoutes } from './modules/attempts/index.js';
import { pointsRoutes } from './modules/points/index.js';
import { paymentsRoutes } from './modules/payments/index.js';
import { catalogRoutes } from './modules/catalog/index.js';
import { partnersRoutes, partnerPortalRoutes } from './modules/partners/index.js';
import { spotChecksRoutes } from './modules/spot-checks/index.js';
import { mailingsRoutes } from './modules/mailings/index.js';
import { adminRoutes } from './modules/admin/index.js';
import { auditRoutes } from './modules/audit/index.js';
import { achievementsRoutes } from './modules/achievements/index.js';
import { charityRoutes } from './modules/charity/index.js';

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: config.UPLOAD_MAX_SIZE_MB * 1024 * 1024,
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Partner-Api-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });

  await app.register(cookie, {
    secret: config.SESSION_SECRET,
    parseOptions: {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      domain: config.COOKIE_DOMAIN,
      path: '/',
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: config.RATE_LIMIT_GLOBAL_WINDOW * 1000,
    redis,
    keyGenerator: (req) => req.ip ?? 'unknown',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Слишком много запросов. Попробуйте позже.',
    }),
  });

  await app.register(sensible);

  await app.register(multipart, {
    limits: {
      fileSize: config.UPLOAD_MAX_SIZE_MB * 1024 * 1024,
      files: 5,
    },
  });

  await app.register(websocket);

  await app.register(requestContext);

  await app.register(metricsPlugin);

  app.get('/health', async () => {
    const [dbOk, redisOk] = await Promise.all([pingDatabase(), pingRedis()]);
    const healthy = dbOk && redisOk;
    return {
      status: healthy ? 'ok' : 'degraded',
      checks: { database: dbOk, redis: redisOk },
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.decorate('db', db);
  app.decorate('redis', redis);
  app.decorate('config', config);

  await app.register(
    async (api) => {
      api.get('/', async () => ({
        name: config.APP_NAME,
        version: '1.0.0',
      }));

      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(usersRoutes, { prefix: '/me' });
      await api.register(notificationsRoutes, { prefix: '/notifications' });
      await api.register(subjectsRoutes, { prefix: '/subjects' });
      await api.register(testsRoutes, { prefix: '/tests' });
      await api.register(questionsRoutes, { prefix: '/questions' });
      await api.register(attemptsRoutes, { prefix: '/attempts' });
      await api.register(pointsRoutes, { prefix: '/points' });
      await api.register(paymentsRoutes, { prefix: '/payments' });
      await api.register(catalogRoutes, { prefix: '/catalog' });
      await api.register(partnersRoutes, { prefix: '/partners' });
      await api.register(partnerPortalRoutes, { prefix: '/partner' });
      await api.register(spotChecksRoutes, { prefix: '/spot-checks' });
      await api.register(mailingsRoutes, { prefix: '/mailings' });
      await api.register(adminRoutes, { prefix: '/admin' });
      await api.register(auditRoutes, { prefix: '/audit' });
      await api.register(achievementsRoutes, { prefix: '/achievements' });
      await api.register(charityRoutes, { prefix: '/charity' });
    },
    { prefix: '/api/v1' }
  );

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Маршрут ${req.method} ${req.url} не найден`,
    });
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      req.log.warn({ err: error }, 'zod validation error');
      return reply.status(422).send({
        statusCode: 422,
        error: 'VALIDATION_ERROR',
        message: 'Ошибка валидации',
        details: error.flatten(),
      });
    }

    if (error instanceof AppError) {
      const level = error.statusCode >= 500 ? 'error' : 'warn';
      req.log[level]({ err: error, code: error.code }, 'app error');
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    const status = error.statusCode ?? 500;

    if (status >= 500) {
      req.log.error({ err: error }, 'internal error');
    } else {
      req.log.warn({ err: error }, 'request error');
    }

    const isProd = config.isProd;
    const message =
      status >= 500 && isProd ? 'Внутренняя ошибка сервера' : error.message;

    return reply.status(status).send({
      statusCode: status,
      error: error.name || 'Error',
      message,
      ...(isProd ? {} : { stack: error.stack }),
    });
  });

  return app;
}

async function start(): Promise<void> {
  try {
    const app = await buildServer();

    await app.listen({
      port: config.API_PORT,
      host: config.API_HOST,
    });

    logger.info(
      { port: config.API_PORT, env: config.NODE_ENV },
      `🚀 ${config.APP_NAME} API started`
    );

    let shuttingDown = false;

    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info({ signal }, 'shutdown initiated');

      const forceExit = setTimeout(() => {
        logger.error('shutdown timeout, forcing exit');
        process.exit(1);
      }, 15_000);
      forceExit.unref();

      try {
        await app.close();
        await Promise.all([closeDatabase(), closeRedis()]);
        try {
          await closeQueues();
        } catch (err) {
          logger.warn({ err }, 'closeQueues failed (probably not initialized)');
        }
        logger.info('shutdown complete');
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'shutdown failed');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error({ reason }, 'unhandled rejection');
    });

    process.on('uncaughtException', (err) => {
      logger.fatal({ err }, 'uncaught exception');
      process.exit(1);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

void start();