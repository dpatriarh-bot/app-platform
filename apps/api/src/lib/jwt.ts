// ============================================================
// jwt.ts — access/refresh токены на jose (HS256)
// Refresh — одноразовый с rotation и отзывом цепочки.
// ============================================================

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';
import { randomToken } from './crypto.js';

const encoder = new TextEncoder();

const accessKey = encoder.encode(config.JWT_ACCESS_SECRET);
const refreshKey = encoder.encode(config.JWT_REFRESH_SECRET);

export interface AccessTokenPayload extends JWTPayload {
  sub: string;        // user id
  role: string;
  sid: string;        // session id
  typ: 'access';
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string;
  sid: string;
  jti: string;        // refresh id
  typ: 'refresh';
}

/**
 * Подписывает access-токен (короткоживущий).
 */
export async function signAccessToken(
  payload: Omit<AccessTokenPayload, 'typ' | 'iat' | 'exp' | 'iss' | 'aud'>
): Promise<string> {
  return new SignJWT({ ...payload, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setExpirationTime(config.JWT_ACCESS_TTL)
    .setSubject(payload.sub)
    .sign(accessKey);
}

/**
 * Подписывает refresh-токен (долгоживущий).
 */
export async function signRefreshToken(
  payload: Omit<RefreshTokenPayload, 'typ' | 'iat' | 'exp' | 'iss' | 'aud'>
): Promise<string> {
  return new SignJWT({ ...payload, typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setExpirationTime(config.JWT_REFRESH_TTL)
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .sign(refreshKey);
}

/**
 * Верифицирует access-токен.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, accessKey, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
  if (payload.typ !== 'access') throw new Error('Invalid token type');
  return payload as AccessTokenPayload;
}

/**
 * Верифицирует refresh-токен.
 */
export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, refreshKey, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
  if (payload.typ !== 'refresh') throw new Error('Invalid token type');
  return payload as RefreshTokenPayload;
}

/**
 * Создаёт пару токенов + session id + refresh jti.
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  refreshJti: string;
}

export async function createTokenPair(
  userId: string,
  role: string,
  sessionId: string
): Promise<TokenPair> {
  const refreshJti = randomToken(24);
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ sub: userId, role, sid: sessionId }),
    signRefreshToken({ sub: userId, sid: sessionId, jti: refreshJti }),
  ]);
  return { accessToken, refreshToken, sessionId, refreshJti };
}