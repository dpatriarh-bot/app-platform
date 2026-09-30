// ============================================================
// auth/service.ts — бизнес-логика аутентификации
// + ре-согласие с офертой, SMS-восстановление пароля.
// ============================================================

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { eq, and, isNull, desc, gt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  users,
  parents,
  children,
  sessions,
  passwordResets,
  childBalances,
  type User,
} from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { createTokenPair, verifyRefreshToken } from '../../lib/jwt.js';
import { encryptPII, hashPII, randomToken, safeEqual } from '../../lib/crypto.js';
import { normalizePhone } from '../../lib/phone.js';
import { logger } from '../../lib/logger.js';
import { writeAudit } from '../audit/service.js';
import { redis } from '../../lib/redis.js';
import { config } from '../../config.js';
import { verifyTotp, verifyRecoveryCode } from './totp.js';
import type { RegisterInput, LoginInput, ResetInput } from './schemas.js';
import { CONSENT_VERSION } from './schemas.js';
import { AppError } from '../../lib/errors.js';
import { sendMail } from '../../lib/mailer.js';
import { sendSms } from '../../lib/sms.js';

const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$' +
  'ZHVtbXlkdW1teWR1bW15ZHVtbXlkdW1teWR1bW15ZHVtbXk';

const SMS_CODE_TTL_SEC = 10 * 60;
const SMS_CODE_MAX_ATTEMPTS = 5;

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  mustChangePassword: boolean;
  consentUpdateRequired?: boolean;
}

// ============================================================
// Регистрация
// ============================================================

export async function register(
  input: RegisterInput,
  meta: { ip: string; userAgent: string }
): Promise<AuthResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError('INVALID_PHONE', 'Некорректный номер телефона', 400);

  const email = input.email.toLowerCase().trim();

  const existingByPhone = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);
  if (existingByPhone.length > 0) {
    throw new AppError('PHONE_TAKEN', 'Пользователь с таким номером телефона уже зарегистрирован', 409);
  }

  const existingByEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existingByEmail.length > 0) {
    throw new AppError('EMAIL_TAKEN', 'Пользователь с таким адресом уже зарегистрирован', 409);
  }

  const passwordHash = await hashPassword(input.password);
  const consentVersion = input.consentVersion ?? CONSENT_VERSION;

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        role: 'parent',
        status: 'active',
        phone,
        email,
        passwordHash,
        consentVersion,
        consentAt: new Date(),
      })
      .returning();

    const parentFio = input.fullName.trim();
    await tx.insert(parents).values({
      userId: user!.id,
      fullNameEnc: encryptPII(parentFio),
      fullNameHash: hashPII(parentFio),
      city: input.city || null,
    });

    const childFio = input.child.fullName.trim();
    const birthYear = new Date(input.child.birthDate).getFullYear();

    const [child] = await tx
      .insert(children)
      .values({
        parentId: user!.id,
        fullNameEnc: encryptPII(childFio),
        fullNameHash: hashPII(childFio),
        birthDateEnc: encryptPII(input.child.birthDate),
        birthYear,
        city: input.child.city || input.city || null,
        school: input.child.school || null,
        grade: input.child.grade ?? null,
      })
      .returning();

    await tx.insert(childBalances).values({
      childId: child!.id,
      balance: 0,
      lifetimeEarned: 0,
      lifetimeSpent: 0,
    });

    return { user: user!, child: child! };
  });

  const tokens = await createSession(result.user, meta);

  await writeAudit({
    actorId: result.user.id,
    actorRole: result.user.role,
    action: 'auth.register',
    entity: 'user',
    entityId: result.user.id,
    after: {
      phone: maskPhoneForAudit(phone),
      childId: result.child.id,
      consentVersion,
    },
  });

  void sendWelcomeEmail(email, input.fullName).catch((err) =>
    logger.error({ err }, 'welcome email failed')
  );

  return {
    user: result.user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: tokens.sessionId,
    mustChangePassword: false,
    consentUpdateRequired: false,
  };
}

// ============================================================
// Логин
// ============================================================

export async function login(
  input: LoginInput,
  meta: { ip: string; userAgent: string }
): Promise<AuthResult & { requiresTotp?: boolean }> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError('INVALID_PHONE', 'Некорректный номер телефона', 400);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);

  if (!user) {
    await verifyPassword(DUMMY_HASH, input.password).catch(() => false);
    throw new AppError('INVALID_CREDENTIALS', 'Неверный телефон или пароль', 401);
  }

  if (user.status === 'blocked') {
    throw new AppError('ACCOUNT_BLOCKED', 'Аккаунт заблокирован', 403);
  }
  if (user.status === 'deleted') {
    throw new AppError('INVALID_CREDENTIALS', 'Неверный телефон или пароль', 401);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const sec = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw new AppError(
      'ACCOUNT_LOCKED',
      `Аккаунт временно заблокирован. Попробуйте через ${sec} сек.`,
      423
    );
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);

  if (!passwordOk) {
    await handleFailedLogin(user);
    throw new AppError('INVALID_CREDENTIALS', 'Неверный телефон или пароль', 401);
  }

  if (user.totpEnabled && user.totpSecret) {
    if (!input.totp) {
      return {
        user,
        accessToken: '',
        refreshToken: '',
        sessionId: '',
        mustChangePassword: false,
        requiresTotp: true,
      };
    }

    const ok = verifyTotp(user.totpSecret, input.totp);
    if (!ok) {
      const codes = user.totpRecoveryCodes ?? [];
      const idx = verifyRecoveryCode(codes, input.totp);
      if (idx === -1) {
        await handleFailedLogin(user);
        throw new AppError('INVALID_TOTP', 'Неверный код подтверждения', 401);
      }
      const next = codes.filter((_, i) => i !== idx);
      await db
        .update(users)
        .set({ totpRecoveryCodes: next, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
  }

  await db
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: meta.ip,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const tokens = await createSession(user, meta);

  await writeAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'auth.login',
    entity: 'user',
    entityId: user.id,
  });

  const consentUpdateRequired =
    user.role === 'parent' && user.consentVersion !== CONSENT_VERSION;

  return {
    user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: tokens.sessionId,
    mustChangePassword: user.mustChangePassword,
    consentUpdateRequired,
  };
}

async function handleFailedLogin(user: User): Promise<void> {
  const attempts = user.failedLoginAttempts + 1;
  const lockAfter = 5;
  const lockMinutes = 15;

  const update: Partial<User> = {
    failedLoginAttempts: attempts,
    updatedAt: new Date(),
  };

  if (attempts >= lockAfter) {
    update.lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
  }

  await db.update(users).set(update).where(eq(users.id, user.id));
}

// ============================================================
// Ре-согласие с офертой
// ============================================================

export async function acceptConsent(
  userId: string,
  version: string
): Promise<void> {
  if (version !== CONSENT_VERSION) {
    throw new AppError(
      'INVALID_CONSENT_VERSION',
      `Актуальная версия оферты: ${CONSENT_VERSION}`,
      400
    );
  }

  await db
    .update(users)
    .set({
      consentVersion: version,
      consentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await writeAudit({
    actorId: userId,
    action: 'auth.accept_consent',
    entity: 'user',
    entityId: userId,
    after: { version },
  });
}

// ============================================================
// Refresh rotation
// ============================================================

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export async function refresh(
  refreshToken: string,
  meta: { ip: string; userAgent: string }
): Promise<RefreshResult> {
  let payload;
  try {
    payload = await verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('INVALID_REFRESH', 'Сессия истекла, войдите заново', 401);
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshJti, payload.jti))
    .limit(1);

  if (!session) {
    await revokeAllUserSessions(payload.sub, 'unknown_refresh');
    throw new AppError('INVALID_REFRESH', 'Сессия истекла, войдите заново', 401);
  }

  if (session.expiresAt < new Date()) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'expired' })
      .where(eq(sessions.id, session.id));
    throw new AppError('INVALID_REFRESH', 'Сессия истекла, войдите заново', 401);
  }

  const tokenHash = hashRefreshToken(refreshToken);
  if (!safeEqual(tokenHash, session.refreshHash)) {
    await revokeAllUserSessions(payload.sub, 'refresh_hash_mismatch');
    throw new AppError('INVALID_REFRESH', 'Сессия истекла, войдите заново', 401);
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
  if (!user || user.status !== 'active') {
    throw new AppError('INVALID_REFRESH', 'Сессия истекла, войдите заново', 401);
  }

  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: 'rotated' })
    .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  if (revoked.length === 0) {
    await revokeAllUserSessions(payload.sub, 'refresh_reuse');
    throw new AppError('REFRESH_REUSED', 'Обнаружено повторное использование сессии', 401);
  }

  const tokens = await createSession(user, meta);
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: tokens.sessionId,
  };
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ============================================================
// Сессии
// ============================================================

async function createSession(
  user: User,
  meta: { ip: string; userAgent: string }
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const sessionId = randomUUID();
  const tokens = await createTokenPair(user.id, user.role, sessionId);

  const refreshHash = hashRefreshToken(tokens.refreshToken);
  const ttlMs = parseTtlToMs(config.JWT_REFRESH_TTL);

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    refreshJti: tokens.refreshJti,
    refreshHash,
    userAgent: meta.userAgent.slice(0, 500),
    ip: meta.ip,
    expiresAt: new Date(Date.now() + ttlMs),
  });

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId,
  };
}

export async function revokeSession(sessionId: string, reason = 'logout'): Promise<void> {
  const result = await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .returning({ userId: sessions.userId });

  if (result[0]?.userId) {
    await redis.del(`user:${result[0].userId}`);
  }
}

export async function revokeAllUserSessions(userId: string, reason: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));

  await redis.del(`user:sessions:${userId}`);
  await redis.del(`user:${userId}`);
}

// ============================================================
// Активные сессии
// ============================================================

export interface SessionPublic {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
}

export async function listActiveSessions(
  userId: string,
  currentSessionId?: string
): Promise<SessionPublic[]> {
  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ip: sessions.ip,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .orderBy(desc(sessions.createdAt));

  return rows.map((r) => ({
    id: r.id,
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    current: r.id === currentSessionId,
  }));
}

export async function revokeSessionById(userId: string, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: 'user_revoked' })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt)
      )
    );

  await redis.del(`user:sessions:${userId}`);
}

// ============================================================
// Сброс пароля
// ============================================================

export async function requestPasswordReset(
  phoneInput: string,
  meta: { ip: string; userAgent: string; method?: 'email' | 'sms' }
): Promise<{ sent: boolean; method: 'email' | 'sms' | 'none' }> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { sent: true, method: 'none' };

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
    .limit(1);

  if (!user) return { sent: true, method: 'none' };

  const method = meta.method ?? (user.email ? 'email' : 'sms');

  if (method === 'sms') {
    await sendSmsResetCode(user.id, phone, meta);
    return { sent: true, method: 'sms' };
  }

  if (!user.email) {
    await sendSmsResetCode(user.id, phone, meta);
    return { sent: true, method: 'sms' };
  }

  const token = randomToken(32);
  const tokenHash = hashRefreshToken(token);
  const ttlMs = 15 * 60 * 1000;

  await db.insert(passwordResets).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + ttlMs),
    ip: meta.ip,
  });

  const resetUrl = `${config.APP_URL}/reset?token=${token}`;

  void sendPasswordResetEmail(user.email, resetUrl).catch((err) =>
    logger.error({ err }, 'reset email failed')
  );

  await writeAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'auth.password_reset_requested',
    entity: 'user',
    entityId: user.id,
    after: { method: 'email' },
  });

  return { sent: true, method: 'email' };
}

async function sendSmsResetCode(
  userId: string,
  phone: string,
  meta: { ip: string; userAgent: string }
): Promise<void> {
  const code = String(randomInt(100000, 999999));
  const codeHash = hashRefreshToken(code);

  await redis.setex(`pwreset:code:${userId}`, SMS_CODE_TTL_SEC, codeHash);
  await redis.del(`pwreset:attempts:${userId}`);

  void sendSms({
    to: phone,
    text: `Код для сброса пароля: ${code}. Действует 10 минут.`,
  }).catch((err) => logger.error({ err, userId }, 'sms reset code failed'));

  await writeAudit({
    actorId: userId,
    action: 'auth.password_reset_requested',
    entity: 'user',
    entityId: userId,
    after: { method: 'sms', ip: meta.ip },
  });
}

export async function resetPassword(
  input: ResetInput,
  _meta: { ip: string; userAgent: string }
): Promise<void> {
  let userId: string;

  if (input.token) {
    // Через email-токен
    const tokenHash = hashRefreshToken(input.token);

    const [reset] = await db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, tokenHash), isNull(passwordResets.usedAt)))
      .limit(1);

    if (!reset || reset.expiresAt < new Date()) {
      throw new AppError('INVALID_TOKEN', 'Ссылка недействительна или истекла', 400);
    }

    userId = reset.userId;

    await db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, reset.id));
  } else if (input.phone && input.code) {
    // Через SMS-код
    const phone = normalizePhone(input.phone);
    if (!phone) throw new AppError('INVALID_PHONE', 'Некорректный телефон', 400);

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
      .limit(1);

    if (!user) throw new AppError('INVALID_CODE', 'Неверный код', 400);

    const attempts = await redis.incr(`pwreset:attempts:${user.id}`);
    if (attempts === 1) {
      await redis.expire(`pwreset:attempts:${user.id}`, SMS_CODE_TTL_SEC);
    }
    if (attempts > SMS_CODE_MAX_ATTEMPTS) {
      throw new AppError('TOO_MANY_ATTEMPTS', 'Слишком много попыток. Запросите новый код.', 429);
    }

    const storedHash = await redis.get(`pwreset:code:${user.id}`);
    if (!storedHash) {
      throw new AppError('CODE_EXPIRED', 'Код истёк. Запросите новый.', 400);
    }

    const inputHash = hashRefreshToken(input.code);
    if (!safeEqual(storedHash, inputHash)) {
      throw new AppError('INVALID_CODE', 'Неверный код', 400);
    }

    await redis.del(`pwreset:code:${user.id}`);
    await redis.del(`pwreset:attempts:${user.id}`);

    userId = user.id;
  } else {
    throw new AppError('VALIDATION_ERROR', 'Укажите токен или телефон+код', 422);
  }

  const passwordHash = await hashPassword(input.password);

  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date(), mustChangePassword: false })
    .where(eq(users.id, userId));

  await revokeAllUserSessions(userId, 'password_reset');

  await writeAudit({
    actorId: userId,
    action: 'auth.password_reset_completed',
    entity: 'user',
    entityId: userId,
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  _meta: { ip: string; userAgent: string }
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) throw new AppError('INVALID_PASSWORD', 'Неверный текущий пароль', 401);

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date(), mustChangePassword: false })
    .where(eq(users.id, userId));

  await revokeAllUserSessions(userId, 'password_changed');

  await writeAudit({
    actorId: userId,
    action: 'auth.password_changed',
    entity: 'user',
    entityId: userId,
  });
}

// ============================================================
// 2FA
// ============================================================

export async function enableTotp(
  userId: string,
  secret: string,
  code: string
): Promise<{ recoveryCodes: string[] }> {
  const { verifyTotp: verify, generateRecoveryCodes } = await import('./totp.js');

  if (!verify(secret, code)) {
    throw new AppError('INVALID_TOTP', 'Неверный код', 400);
  }

  const codes = generateRecoveryCodes(10);

  await db
    .update(users)
    .set({
      totpSecret: secret,
      totpEnabled: true,
      totpRecoveryCodes: codes,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await writeAudit({
    actorId: userId,
    action: 'auth.totp_enabled',
    entity: 'user',
    entityId: userId,
  });

  return { recoveryCodes: codes };
}

export async function disableTotp(userId: string, password: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw new AppError('INVALID_PASSWORD', 'Неверный пароль', 401);

  await db
    .update(users)
    .set({
      totpEnabled: false,
      totpSecret: null,
      totpRecoveryCodes: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await writeAudit({
    actorId: userId,
    action: 'auth.totp_disabled',
    entity: 'user',
    entityId: userId,
  });
}

// ============================================================
// Утилиты
// ============================================================

function parseTtlToMs(ttl: string): number {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const [, num, unit] = match;
  const n = parseInt(num!, 10);
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 30 * 24 * 60 * 60 * 1000;
  }
}

function maskPhoneForAudit(phone: string): string {
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}

async function sendWelcomeEmail(email: string, name: string): Promise<void> {
  await sendMail({
    to: email,
    templateCode: 'welcome',
    variables: { parentName: name, planName: 'Месячная подписка', price: '190' },
  });
}

async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  await sendMail({
    to: email,
    templateCode: 'password_reset',
    variables: { resetUrl },
  });
}