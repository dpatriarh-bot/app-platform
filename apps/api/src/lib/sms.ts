// ============================================================
// sms.ts — отправка SMS через провайдера
// Провайдеры: stub (лог), smsru, turbosms.
// ============================================================

import { config } from '../config.js';
import { logger } from './logger.js';

export interface SendSmsInput {
  to: string;
  text: string;
}

interface SmsProvider {
  name: string;
  send(input: SendSmsInput): Promise<void>;
}

class StubSmsProvider implements SmsProvider {
  readonly name = 'stub';

  async send(input: SendSmsInput): Promise<void> {
    logger.info(
      { to: maskPhone(input.to), text: input.text },
      'sms (stub, not sent)'
    );
  }
}

class SmsRuProvider implements SmsProvider {
  readonly name = 'smsru';

  async send(input: SendSmsInput): Promise<void> {
    if (!config.SMS_API_KEY) {
      throw new Error('SMS_API_KEY is empty — sms.ru requires an API key');
    }

    const url = new URL('https://sms.ru/sms/send');
    url.searchParams.set('api_id', config.SMS_API_KEY);
    url.searchParams.set('to', input.to);
    url.searchParams.set('msg', input.text);
    url.searchParams.set('json', '1');
    url.searchParams.set('from', config.SMS_SENDER);

    const res = await fetch(url.toString(), { method: 'POST' });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`sms.ru HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      status: string;
      status_text?: string;
      sms?: Record<string, { status: string; status_text?: string }>;
    };

    if (data.status !== 'OK') {
      throw new Error(`sms.ru error: ${data.status_text ?? data.status}`);
    }

    const first = Object.values(data.sms ?? {})[0];
    if (first && first.status !== 'OK') {
      throw new Error(`sms.ru recipient error: ${first.status_text ?? first.status}`);
    }
  }
}

class TurboSmsProvider implements SmsProvider {
  readonly name = 'turbosms';

  async send(input: SendSmsInput): Promise<void> {
    if (!config.SMS_API_KEY) {
      throw new Error('SMS_API_KEY is empty — turbosms requires an API key');
    }

    const url = 'https://api.turbosms.ua/message/send.json';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.SMS_API_KEY}`,
      },
      body: JSON.stringify({
        recipients: [input.to],
        sms: {
          sender: config.SMS_SENDER,
          text: input.text,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`turbosms HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { response?: { status?: string; status_text?: string } };
    if (data.response?.status !== 'OK') {
      throw new Error(`turbosms error: ${data.response?.status_text ?? 'unknown'}`);
    }
  }
}

let cached: SmsProvider | null = null;

function getProvider(): SmsProvider {
  if (cached) return cached;

  switch (config.SMS_PROVIDER) {
    case 'smsru':
      cached = new SmsRuProvider();
      break;
    case 'turbosms':
      cached = new TurboSmsProvider();
      break;
    case 'stub':
    default:
      cached = new StubSmsProvider();
      break;
  }

  logger.info({ provider: cached.name }, 'sms provider initialized');
  return cached;
}

export async function sendSms(input: SendSmsInput): Promise<void> {
  const provider = getProvider();

  if (config.SMS_PROVIDER === 'stub' || !config.SMS_API_KEY) {
    await provider.send(input);
    return;
  }

  try {
    await provider.send(input);
    logger.info({ to: maskPhone(input.to), provider: provider.name }, 'sms sent');
  } catch (err) {
    logger.error(
      { err, to: maskPhone(input.to), provider: provider.name },
      'sms send failed'
    );
    throw err;
  }
}

function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}