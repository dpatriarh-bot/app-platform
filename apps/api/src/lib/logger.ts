// ============================================================
// logger.ts — Pino с redact PII и trace correlation
// В prod — JSON, в dev — pretty.
// ============================================================

import pino, { type LoggerOptions } from 'pino';
import { config } from '../config.js';

const redactPaths = [
  // Auth
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  // Тело запросов
  'req.body.password',
  'req.body.passwordConfirm',
  'req.body.totp',
  'req.body.code',
  'req.body.cardNumber',
  'req.body.cvv',
  // PII
  'req.body.fullName',
  'req.body.fio',
  'req.body.phone',
  'req.body.email',
  'req.body.birthDate',
  'req.body.school',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.totpSecret',
  '*.fio',
  '*.fullName',
  '*.birthDate',
  '*.phone',
  '*.email',
];

const options: LoggerOptions = {
  level: config.LOG_LEVEL,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
    remove: false,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings(bindings) {
      return {
        pid: bindings.pid,
        host: bindings.hostname,
        app: config.APP_NAME,
        env: config.NODE_ENV,
      };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    req(req: {
      method?: string;
      url?: string;
      ip?: string;
      headers?: Record<string, unknown>;
    }) {
      return {
        method: req.method,
        url: req.url,
        remoteAddress: req.ip,
        requestId: req.headers?.['x-request-id'],
      };
    },
    res(res: { statusCode?: number }) {
      return { statusCode: res.statusCode };
    },
  },
};

export const logger = config.LOG_PRETTY
  ? pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,app,env',
          singleLine: false,
        },
      },
    })
  : pino(options);

export type Logger = typeof logger;