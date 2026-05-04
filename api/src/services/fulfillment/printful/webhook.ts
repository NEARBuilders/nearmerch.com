import * as crypto from 'crypto';
import { ORPCError } from 'every-plugin/orpc';
import type { OrderStatus, TrackingInfo } from '../../../schema';

type PrintfulWebhookPayload = {
  type?: string;
  data?: { 
    order?: { 
      external_id?: string;
      status?: string;
    };
    catalog_product?: {
      id?: number;
    };
    shipment?: {
      tracking_number?: string;
      tracking_url?: string;
      service?: string;
    };
  };
};

export function verifyPrintfulWebhookSignature(options: {
  rawBody: string;
  signature: string;
  webhookSecretHex: string;
}) {
  const { rawBody, signature, webhookSecretHex } = options;

  if (!signature) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Missing webhook signature' });
  }

  try {
    const secretBuffer = Buffer.from(webhookSecretHex, 'hex');
    const expected = crypto.createHmac('sha256', secretBuffer).update(rawBody).digest('hex');

    if (signature.length !== expected.length) {
      throw new ORPCError('UNAUTHORIZED', { message: 'Invalid webhook signature' });
    }

    const isValid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    if (!isValid) {
      throw new ORPCError('UNAUTHORIZED', { message: 'Invalid webhook signature' });
    }
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    throw new ORPCError('UNAUTHORIZED', { message: 'Webhook signature verification failed' });
  }
}

export function parsePrintfulWebhook(rawBody: string): {
  eventType: string;
  externalId?: string;
  catalogProductId?: number;
  data?: PrintfulWebhookPayload['data'];
} {
  let payload: PrintfulWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as PrintfulWebhookPayload;
  } catch {
    return { eventType: 'unknown' };
  }

  return {
    eventType: payload.type || 'unknown',
    externalId: payload.data?.order?.external_id,
    catalogProductId: payload.data?.catalog_product?.id,
    data: payload.data,
  };
}

export function computePrintfulUpdate(options: {
  eventType: string;
  data: PrintfulWebhookPayload['data'] | undefined;
  currentStatus: OrderStatus;
}): { newStatus?: OrderStatus; newTracking?: TrackingInfo[]; shouldRetryConfirmation?: boolean } {
  const { eventType, data, currentStatus } = options;

  let newStatus: OrderStatus | undefined;
  let newTracking: TrackingInfo[] | undefined;
  let shouldRetryConfirmation = false;

  switch (eventType) {
    case 'order_created':
      if (currentStatus === 'paid' || currentStatus === 'paid_pending_fulfillment') {
        newStatus = 'processing';
      }
      break;

    case 'order_updated':
      const orderStatus = data?.order?.status?.toLowerCase();
      switch (orderStatus) {
        case 'fulfilled':
          newStatus = 'shipped';
          break;
        case 'pending':
        case 'inprocess':
          if (currentStatus === 'paid' || currentStatus === 'paid_pending_fulfillment') {
            newStatus = 'processing';
          }
          break;
        case 'draft':
          if (currentStatus === 'paid_pending_fulfillment') {
            shouldRetryConfirmation = true;
          }
          break;
        case 'canceled':
        case 'cancelled':
          newStatus = 'cancelled';
          break;
        case 'failed':
          newStatus = 'failed';
          break;
        case 'onhold':
          newStatus = 'on_hold';
          break;
      }
      break;

    case 'shipment_sent':
      newStatus = 'shipped';
      if (data?.shipment) {
        newTracking = [
          {
            trackingCode: data.shipment.tracking_number || '',
            trackingUrl: data.shipment.tracking_url || '',
            shipmentMethodName: data.shipment.service || 'Standard',
          },
        ];
      }
      break;

    case 'shipment_delivered':
      newStatus = 'delivered';
      break;

    case 'shipment_returned':
      newStatus = 'returned';
      break;

    case 'shipment_canceled':
      newStatus = 'partially_cancelled';
      break;

    case 'shipment_out_of_stock':
      newStatus = 'on_hold';
      break;

    case 'shipment_put_hold':
    case 'shipment_put_hold_approval':
      newStatus = 'on_hold';
      break;

    case 'shipment_remove_hold':
      if (currentStatus === 'on_hold') {
        newStatus = 'processing';
      }
      break;

    case 'order_put_hold':
    case 'order_put_hold_approval':
      newStatus = 'on_hold';
      break;

    case 'order_remove_hold':
      if (currentStatus === 'on_hold') {
        newStatus = 'processing';
      }
      break;

    case 'order_canceled':
      newStatus = 'cancelled';
      break;

    case 'order_failed':
      newStatus = 'failed';
      break;

    case 'order_refunded':
      newStatus = 'refunded';
      break;

    default:
      break;
  }

  return { newStatus, newTracking, shouldRetryConfirmation };
}
