// ============================================================
// lib/mailer.ts — отправка писем через SMTP (nodemailer)
// + token-bucket rate limit (не более N писем в секунду)
// ============================================================

import nodemailer, { type Transporter } from 'nodemailer';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mailTemplates } from '../db/schema.js';
import { config } from '../config.js';
import { logger } from './logger.js';

let transporter: Transporter | null = null;

// ---------- Token bucket ----------
const RATE_LIMIT_PER_SEC = 5;
const BUCKET_CAPACITY = 20;

let tokens = BUCKET_CAPACITY;
let lastRefill = Date.now();

async function acquireToken(): Promise<void> {
  while (true) {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    if (elapsed > 0) {
      tokens = Math.min(BUCKET_CAPACITY, tokens + elapsed * RATE_LIMIT_PER_SEC);
      lastRefill = now;
    }

    if (tokens >= 1) {
      tokens -= 1;
      return;
    }

    const waitMs = Math.ceil(((1 - tokens) / RATE_LIMIT_PER_SEC) * 1000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function getTransporter(): Transporter | null {
  if (!config.SMTP_HOST) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
      : undefined,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: RATE_LIMIT_PER_SEC,
  });

  return transporter;
}

export interface SendMailInput {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
  templateCode?: string;
  variables?: Record<string, string>;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  let subject = input.subject;
  let html = input.html;
  let text = input.text;

  if (input.templateCode) {
    const [tpl] = await db
      .select()
      .from(mailTemplates)
      .where(eq(mailTemplates.code, input.templateCode))
      .limit(1);

    if (!tpl) {
      logger.warn({ code: input.templateCode }, 'mail template not found');
      return;
    }

    subject = subject ?? tpl.subject;
    html = html ?? renderTemplate(tpl.bodyHtml, input.variables ?? {});
    text = text ?? (tpl.bodyText ? renderTemplate(tpl.bodyText, input.variables ?? {}) : undefined);
  }

  const tx = getTransporter();
  if (!tx) {
    logger.info({ to: maskEmail(input.to), subject }, 'email (dev, not sent)');
    return;
  }

  // Ждём свободный токен из bucket
  await acquireToken();

  try {
    await tx.sendMail({
      from: config.SMTP_FROM,
      to: input.to,
      subject: subject ?? '(без темы)',
      html,
      text,
    });
    logger.info({ to: maskEmail(input.to), subject }, 'email sent');
  } catch (err) {
    logger.error({ err, to: maskEmail(input.to) }, 'email send failed');
    throw err;
  }
}

function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => variables[key] ?? '');
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  return `${user.slice(0, 2)}***@${domain}`;
}