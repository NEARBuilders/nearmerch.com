import * as crypto from 'crypto';
import { Context, Effect, Layer } from 'every-plugin/effect';
import type { CheckoutSessionInput, CheckoutSessionOutput } from '../schema';
import type { FeeConfig } from '../../../schema';
import { PingWebhookPayloadSchema, type PingWebhookResult } from './schema';
import { WebhookSignatureError, WebhookParseError, PingApiError } from './errors';
import { PingPayClient } from './client';

export interface PingPayConfig {
  baseUrl: string;
  recipientAddress: string;
  webhookSecret?: string;
  apiKey?: string;
}

export interface PingSessionInfo {
  id: string;
  status: string;
  paymentStatus: string;
  amountTotal: number;
  currency: string;
  paymentId?: string;
  metadata: Record<string, unknown>;
}

export const verifyPingPayWebhookSignature = (
  payload: string,
  timestamp: string,
  signature: string,
  webhookSecret?: string
): Effect.Effect<void, WebhookSignatureError> =>
  Effect.gen(function* () {
    if (!webhookSecret) {
      console.warn('[PingPay] No webhook secret configured');
      return;
    }

    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    if (signature.length !== expected.length) {
      return yield* Effect.fail(new WebhookSignatureError({ message: 'Signature length mismatch' }));
    }

    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex')
      );

      if (!isValid) {
        return yield* Effect.fail(new WebhookSignatureError({ message: 'Invalid signature' }));
      }
    } catch {
      return yield* Effect.fail(new WebhookSignatureError({ message: 'Signature verification failed' }));
    }
  });

export class PingPayService extends Context.Tag('PingPayService')<
  PingPayService,
  {
    readonly createCheckout: (input: CheckoutSessionInput, fees?: FeeConfig[]) => Effect.Effect<CheckoutSessionOutput, PingApiError>;
    readonly verifyWebhook: (body: string, signature: string, timestamp: string) => Effect.Effect<PingWebhookResult, WebhookSignatureError | WebhookParseError>;
    readonly getSession: (sessionId: string) => Effect.Effect<PingSessionInfo, PingApiError>;
  }
>() {}

export const PingPayServiceLive = (config: PingPayConfig) =>
  Layer.succeed(
    PingPayService,
    {
      createCheckout: (input, fees) =>
        Effect.gen(function* () {
          const client = new PingPayClient(config.baseUrl, config.apiKey);
          const amountInCents = Math.round(input.amount);
          const amountInUSDC = amountInCents * 10000;

          const pingFees = fees?.map(f => ({
            type: f.type,
            label: f.label,
            recipient: f.recipient,
            bps: f.bps,
          }));

          const response = yield* Effect.tryPromise({
            try: () =>
              client.createCheckoutSession({
                amount: String(amountInUSDC),
                recipient: { address: config.recipientAddress },
                asset: { chain: 'NEAR', symbol: 'USDC' },
                successUrl: input.successUrl,
                cancelUrl: input.cancelUrl,
                metadata: { orderId: input.orderId },
                fees: pingFees,
              }),
            catch: (e) =>
              new PingApiError({
                message: `Checkout creation failed: ${e instanceof Error ? e.message : String(e)}`,
                cause: e,
              }),
          });

          return {
            sessionId: response.session.sessionId,
            url: response.sessionUrl,
          };
        }),

      verifyWebhook: (body, signature, timestamp) =>
        Effect.gen(function* () {
          yield* verifyPingPayWebhookSignature(body, timestamp, signature, config.webhookSecret);

          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch (e) {
            return yield* Effect.fail(
              new WebhookParseError({ message: 'Invalid JSON', cause: e })
            );
          }

          const parseResult = PingWebhookPayloadSchema.safeParse(parsed);
          if (!parseResult.success) {
            return yield* Effect.fail(
              new WebhookParseError({
                message: 'Invalid webhook payload',
                cause: parseResult.error,
              })
            );
          }

          const payload = parseResult.data;
          const sessionId = payload.sessionId ?? payload.data?.sessionId;
          const orderId = payload.metadata?.orderId ?? (payload.data?.metadata?.orderId as string | undefined);

          console.log(`[PingPay Webhook] Received event: ${payload.type}, sessionId: ${sessionId}`);

          return { eventId: payload.id, eventType: payload.type, orderId, sessionId };
        }),

      getSession: (sessionId) =>
        Effect.gen(function* () {
          const client = new PingPayClient(config.baseUrl, config.apiKey);

          const response = yield* Effect.tryPromise({
            try: () => client.getCheckoutSession(sessionId),
            catch: (e) =>
              new PingApiError({
                message: `Failed to retrieve session: ${e instanceof Error ? e.message : String(e)}`,
                cause: e,
              }),
          });

          const session = response.session;
          const isCompleted = session.status === 'COMPLETED';

          return {
            id: session.sessionId,
            status: session.status.toLowerCase(),
            paymentStatus: isCompleted ? 'paid' : 'unpaid',
            amountTotal: parseInt(session.amount, 10),
            currency: session.asset.symbol,
            paymentId: session.paymentId,
            metadata: session.metadata || {},
          };
        }),
    }
  );
