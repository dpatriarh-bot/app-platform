// ============================================================
// payments/provider.ts — абстракция платёжного провайдера
// Интерфейс PaymentProvider + StubProvider + фабрика.
// Позже добавляются YooKassa/CloudPayments/Tinkoff без
// изменения кода подписок.
// ============================================================

import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

export interface CreateSubscriptionInput {
  parentId: string;
  amountRub: number;
  periodDays: number;
  description: string;
  returnUrl: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface CreateSubscriptionResult {
  providerSubscriptionId: string;
  providerPaymentId: string;
  paymentMethodId: string;
  confirmationUrl: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  rawPayload: Record<string, unknown>;
}

export interface ChargeResult {
  providerPaymentId: string;
  status: 'succeeded' | 'failed';
  amountRub: number;
  failureReason?: string;
  rawPayload: Record<string, unknown>;
}

export interface CancelResult {
  success: boolean;
  message?: string;
}

export interface WebhookEvent {
  externalId: string;
  type: string;
  payload: Record<string, unknown>;
  signatureValid: boolean;
}

export interface PaymentProvider {
  readonly name: 'stub' | 'yookassa' | 'cloudpayments' | 'tinkoff';

  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>;

  chargeRecurrent(
    providerSubscriptionId: string,
    amountRub: number,
    idempotencyKey: string
  ): Promise<ChargeResult>;

  cancelSubscription(providerSubscriptionId: string): Promise<CancelResult>;

  parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): Promise<WebhookEvent | null>;
}

// ============================================================
// StubProvider — заглушка для разработки и демо
// Всегда успешен, если PAYMENT_STUB_ALWAYS_SUCCESS=true.
// ============================================================

class StubProvider implements PaymentProvider {
  readonly name = 'stub' as const;

  async createSubscription(
    input: CreateSubscriptionInput
  ): Promise<CreateSubscriptionResult> {
    const success = config.PAYMENT_STUB_ALWAYS_SUCCESS;

    logger.info(
      { parentId: input.parentId, amount: input.amountRub, success },
      'stub provider: createSubscription'
    );

    return {
      providerSubscriptionId: `stub_sub_${randomUUID()}`,
      providerPaymentId: `stub_pay_${randomUUID()}`,
      paymentMethodId: `stub_pm_${randomUUID()}`,
      confirmationUrl: null,
      status: success ? 'succeeded' : 'failed',
      rawPayload: {
        stub: true,
        amountRub: input.amountRub,
        periodDays: input.periodDays,
        idempotencyKey: input.idempotencyKey,
      },
    };
  }

  async chargeRecurrent(
    providerSubscriptionId: string,
    amountRub: number,
    idempotencyKey: string
  ): Promise<ChargeResult> {
    const success = config.PAYMENT_STUB_ALWAYS_SUCCESS;

    logger.info(
      { providerSubscriptionId, amountRub, success },
      'stub provider: chargeRecurrent'
    );

    return {
      providerPaymentId: `stub_pay_${randomUUID()}`,
      status: success ? 'succeeded' : 'failed',
      amountRub,
      failureReason: success ? undefined : 'stub_declined',
      rawPayload: {
        stub: true,
        idempotencyKey,
        providerSubscriptionId,
      },
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<CancelResult> {
    logger.info({ providerSubscriptionId }, 'stub provider: cancelSubscription');
    return { success: true };
  }

  async parseWebhook(
    rawBody: string,
    _headers: Record<string, string | string[] | undefined>
  ): Promise<WebhookEvent | null> {
    try {
      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      return {
        externalId: String(payload.id ?? randomUUID()),
        type: String(payload.type ?? 'unknown'),
        payload,
        signatureValid: true,
      };
    } catch {
      return null;
    }
  }
}

// ============================================================
// Фабрика
// ============================================================

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  switch (config.PAYMENT_PROVIDER) {
    case 'stub':
      cached = new StubProvider();
      break;
    // case 'yookassa':
    //   cached = new YooKassaProvider();
    //   break;
    default:
      cached = new StubProvider();
  }

  logger.info({ provider: cached.name }, 'payment provider initialized');
  return cached;
}