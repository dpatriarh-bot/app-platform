// ============================================================
// auth/routes.ts — Fastify-роуты auth
// + acceptConsent, SMS-восстановление.
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  registerSchema,
  loginSchema,
  forgotSchema,
  resetSchema,
  totpEnableSchema,
  changePasswordSchema,
  acceptConsentSchema,
  CONSENT_VERSION,
} from './schemas.js';
import * as authService from './service.js';
import { requireAuth } from './middleware.js';
import { loginLimit, registerLimit, forgotLimit, resetLimit, resetAttempts } from './rate-limit.js';
import { verifyCaptcha, generatePowChallenge } from './captcha.js';
import { config } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { generateTotpSecret, generateTotpUri } from './totp.js';
import { logger } from '../../lib/logger.js';
import { normalizePhone } from '../../lib/phone.js';

const ACCESS_COOKIE = 'ulybka_access';
const REFRESH_COOKIE = 'ulybka_refresh';

function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string
): void {
  const isProd = config.isProd;

  reply.setCookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProd || config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAMESITE,
    path: '/',
    maxAge: 15 * 60,
    domain: config.COOKIE_DOMAIN,
  });

  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProd || config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAMESITE,
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60,
    domain: config.COOKIE_DOMAIN,
  });
}

function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: '/', domain: config.COOKIE_DOMAIN });
  reply.clearCookie(REFRESH_COOKIE, {
    path: '/api/v1/auth',
    domain: config.COOKIE_DOMAIN,
  });
}

function zodToFieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {

  app.get('/captcha/config', async () => ({
    provider: config.CAPTCHA_PROVIDER,
    siteKey: config.CAPTCHA_SITE_KEY,
  }));

  app.get('/captcha/challenge', async () => generatePowChallenge());

  app.get('/consent-version', async () => ({ version: CONSENT_VERSION }));

  // -------- Регистрация --------
  app.post('/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const limit = await registerLimit(req.ctx.ip);
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfterSec));
      throw new AppError('TOO_MANY_REQUESTS', 'Слишком много попыток регистрации. Попробуйте позже.', 429);
    }

    let input;
    try {
      input = registerSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте правильность заполнения', 422, {
          fields: zodToFieldErrors(err),
        });
      }
      throw err;
    }

    const captcha = await verifyCaptcha(input.captchaToken, req.ctx.ip);
    if (!captcha.success) {
      throw new AppError('CAPTCHA_FAILED', 'Не пройдена проверка капчи', 400);
    }

    const result = await authService.register(input, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
    });

    setAuthCookies(reply, result.accessToken, result.refreshToken);

    return reply.status(201).send({
      user: sanitizeUser(result.user),
      mustChangePassword: result.mustChangePassword,
      consentUpdateRequired: false,
      consentVersion: result.user.consentVersion,
    });
  });

  // -------- Логин --------
  app.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    let input;
    try {
      input = loginSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodToFieldErrors(err),
        });
      }
      throw err;
    }

    const phone = normalizePhone(input.phone) ?? input.phone;
    const limit = await loginLimit(phone, req.ctx.ip);
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfterSec));
      throw new AppError('TOO_MANY_REQUESTS', 'Слишком много попыток входа. Попробуйте позже.', 429);
    }

    const captcha = await verifyCaptcha(input.captchaToken, req.ctx.ip);
    if (!captcha.success) {
      throw new AppError('CAPTCHA_FAILED', 'Не пройдена проверка капчи', 400);
    }

    const result = await authService.login(input, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
    });

    if (result.requiresTotp) {
      return reply.status(200).send({ requiresTotp: true });
    }

    await resetAttempts(`login:${phone}`);

    setAuthCookies(reply, result.accessToken, result.refreshToken);

    return reply.send({
      user: sanitizeUser(result.user),
      mustChangePassword: result.mustChangePassword,
      consentUpdateRequired: result.consentUpdateRequired ?? false,
      consentVersion: result.user.consentVersion,
    });
  });

  // -------- Accept consent --------
  app.post('/accept-consent', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = acceptConsentSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodToFieldErrors(err),
        });
      }
      throw err;
    }

    await authService.acceptConsent(req.user.id, input.version);
    return reply.send({ ok: true, version: input.version });
  });

  // -------- Refresh --------
  app.post('/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw new AppError('INVALID_REFRESH', 'Сессия истекла', 401);

    const result = await authService.refresh(token, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
    });

    setAuthCookies(reply, result.accessToken, result.refreshToken);
    return reply.send({ ok: true });
  });

  // -------- Logout --------
  app.post('/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[ACCESS_COOKIE];
    if (token) {
      try {
        const { verifyAccessToken } = await import('../../lib/jwt.js');
        const payload = await verifyAccessToken(token);
        await authService.revokeSession(payload.sid, 'logout');
      } catch {
        // ignore
      }
    }

    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  app.post('/logout-all', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    await authService.revokeAllUserSessions(req.user.id, 'logout_all');
    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  // -------- Sessions --------
  app.get('/sessions', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const sessions = await authService.listActiveSessions(req.user.id);
    return reply.send({ sessions });
  });

  app.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      await authService.revokeSessionById(req.user.id, req.params.id);
      return reply.send({ ok: true });
    }
  );

  // -------- Forgot --------
  app.post('/forgot', async (req, reply) => {
    let input;
    try {
      input = forgotSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodToFieldErrors(err),
        });
      }
      throw err;
    }

    const phone = normalizePhone(input.phone) ?? input.phone;
    const limit = await forgotLimit(phone, req.ctx.ip);
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfterSec));
      throw new AppError('TOO_MANY_REQUESTS', 'Слишком много запросов', 429);
    }

    const captcha = await verifyCaptcha(input.captchaToken, req.ctx.ip);
    if (!captcha.success) {
      throw new AppError('CAPTCHA_FAILED', 'Не пройдена проверка капчи', 400);
    }

    const result = await authService.requestPasswordReset(phone, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
      method: input.method,
    });

    return reply.send({
      ok: true,
      method: result.method,
      message:
        result.method === 'sms'
          ? 'Если аккаунт существует, на телефон отправлен код'
          : 'Если аккаунт существует, на привязанную почту отправлена ссылка',
    });
  });

  // -------- Reset --------
  app.post('/reset', async (req, reply) => {
    let input;
    try {
      input = resetSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodToFieldErrors(err),
        });
      }
      throw err;
    }

    const limitKey = input.token ?? input.phone ?? '';
    const limit = await resetLimit(limitKey, req.ctx.ip);
    if (!limit.allowed) {
      throw new AppError('TOO_MANY_REQUESTS', 'Слишком много попыток', 429);
    }

    await authService.resetPassword(input, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
    });

    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  // -------- Change password --------
  app.post('/change-password', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = changePasswordSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodToFieldErrors(err),
        });
      }
      throw err;
    }

    await authService.changePassword(
      req.user.id,
      input.currentPassword,
      input.newPassword,
      { ip: req.ctx.ip, userAgent: req.ctx.userAgent }
    );

    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  // -------- 2FA --------
  app.post('/2fa/setup', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const secret = generateTotpSecret();
    const account = req.user.email ?? req.user.phone;
    const uri = generateTotpUri(secret, account, config.APP_NAME);
    return reply.send({ secret, uri });
  });

  app.post('/2fa/enable', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = totpEnableSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodToFieldErrors(err),
        });
      }
      throw err;
    }

    const result = await authService.enableTotp(req.user.id, input.secret, input.code);
    return reply.send(result);
  });

  app.post('/2fa/disable', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const body = req.body as { password?: string };
    if (!body.password) {
      throw new AppError('VALIDATION_ERROR', 'Введите пароль', 422);
    }

    await authService.disableTotp(req.user.id, body.password);
    return reply.send({ ok: true });
  });

  app.get('/me', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    return reply.send({ user: sanitizeUser(req.user) });
  });
}

function sanitizeUser(user: {
  id: string;
  role: string;
  status: string;
  phone: string;
  email: string | null;
  totpEnabled: boolean;
  consentVersion: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    phone: user.phone,
    email: user.email,
    totpEnabled: user.totpEnabled,
    consentVersion: user.consentVersion,
    createdAt: user.createdAt,
  };
}

void logger;