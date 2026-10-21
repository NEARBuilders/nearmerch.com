import { Effect, Schedule } from 'every-plugin/effect';
import type { MarketplaceRuntime } from '../../runtime';
import type { OrderStatus, OrderWithItems, TrackingInfo } from '../../schema';
import { OrderStore } from '../../store';
import { computePrintfulUpdate } from './printful/webhook';
import { LuluService } from './lulu/service';
import type { LuluPrintJobResponse } from './lulu/types';

type WebhookMetadata = Record<string, unknown>;

export function findOrderByFulfillmentRefEffect(externalId: string) {
  return Effect.gen(function* () {
    const store = yield* OrderStore;
    let order = yield* store.findByFulfillmentRef(externalId);
    if (!order) {
      order = yield* store.find(externalId);
    }
    return order;
  });
}

export function findPrintfulWebhookOrderEffect(identifiers: {
  externalId?: string;
  printfulOrderId?: string;
}) {
  return Effect.gen(function* () {
    const store = yield* OrderStore;
    const { externalId, printfulOrderId } = identifiers;

    if (externalId) {
      const byRef = yield* findOrderByFulfillmentRefEffect(externalId);
      if (byRef) return byRef;
    }

    if (printfulOrderId) {
      return yield* store.findByProviderOrderId(printfulOrderId);
    }

    return null;
  });
}

export function processPrintfulWebhookEffect(options: {
  runtime: MarketplaceRuntime;
  order: OrderWithItems;
  eventType: string;
  data: unknown;
  actor: string;
  metadata?: WebhookMetadata;
}): Effect.Effect<{
  order: OrderWithItems;
  confirmationResults?: Record<string, { success: boolean; error?: string }>;
  allProviderConfirmationsSucceeded?: boolean;
}, Error, OrderStore> {
  const { runtime, order, eventType, data, actor, metadata } = options;

  return Effect.gen(function* () {
    const orderStore = yield* OrderStore;
    const update = computePrintfulUpdate({
      eventType,
      data: data as Parameters<typeof computePrintfulUpdate>[0]['data'],
      currentStatus: order.status,
    });

    let currentOrder = order;
    let confirmationResults: Record<string, { success: boolean; error?: string }> | undefined;
    let allProviderConfirmationsSucceeded: boolean | undefined;

    if (update.newStatus) {
      currentOrder = yield* orderStore.updateStatus(
        order.id,
        update.newStatus,
        actor,
        eventType,
        { eventType, ...metadata },
      );
    }

    if (update.shouldRetryConfirmation) {
      const draftOrderIds = currentOrder.draftOrderIds || {};
      if (Object.keys(draftOrderIds).length > 0) {
        confirmationResults = {};
        for (const [providerName, draftId] of Object.entries(draftOrderIds)) {
          if (providerName === 'manual') continue;
          const provider = runtime.getProvider(providerName);
          if (!provider) {
            confirmationResults[providerName] = { success: false, error: 'Provider not configured' };
            continue;
          }
          try {
            yield* Effect.tryPromise({
              try: () => provider.client.confirmOrder({ id: draftId as string }),
              catch: (e) => new Error(`Failed to confirm: ${e instanceof Error ? e.message : String(e)}`),
            }).pipe(Effect.retry({ times: 3, schedule: Schedule.exponential('100 millis') }));
            confirmationResults[providerName] = { success: true };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            confirmationResults[providerName] = { success: false, error: errorMsg };
          }
        }

        allProviderConfirmationsSucceeded = Object.values(confirmationResults).every((result) => result.success);
        currentOrder = yield* orderStore.updateStatus(
          order.id,
          allProviderConfirmationsSucceeded ? 'processing' : 'paid_pending_fulfillment',
          actor,
          `fulfillment:retry_${allProviderConfirmationsSucceeded ? 'confirmed' : 'partial'}`,
          { confirmationResults, allSuccess: allProviderConfirmationsSucceeded, ...metadata },
        );
      }
    }

    if (update.newTracking) {
      currentOrder = yield* orderStore.updateTracking(
        order.id,
        update.newTracking,
        actor,
        { eventType, ...metadata },
      );
    }

    return {
      order: currentOrder,
      ...(confirmationResults ? { confirmationResults } : {}),
      ...(typeof allProviderConfirmationsSucceeded === 'boolean'
        ? { allProviderConfirmationsSucceeded }
        : {}),
    };
  });
}

export function processLuluWebhookEffect(options: {
  order: OrderWithItems;
  eventType: string;
  data: LuluPrintJobResponse;
  actor: string;
  luluService: LuluService;
  metadata?: WebhookMetadata;
}): Effect.Effect<{ order: OrderWithItems; trackingInfo?: TrackingInfo[] }, Error, OrderStore> {
  const { order, eventType, data, actor, luluService, metadata } = options;

  return Effect.gen(function* () {
    const orderStore = yield* OrderStore;

    let newStatus: OrderStatus | undefined;
    let trackingInfo: TrackingInfo[] | undefined;
    const errorDetails =
      data.errors?.map((error) => ({
        code: error.code,
        message: error.message,
      })) || undefined;

    if (eventType === 'PRINT_JOB_STATUS_CHANGED') {
      const luluStatus = typeof data.status === 'string' ? data.status : data.status?.name || 'CREATED';
      newStatus = luluService.mapStatus(luluStatus) as OrderStatus;

      if (data.line_items?.length) {
        const shippedItems = data.line_items.filter((item) => item.tracking_id);
        if (shippedItems.length > 0) {
          trackingInfo = shippedItems.map((item) => ({
            trackingCode: item.tracking_id || '',
            trackingUrl: item.tracking_urls?.[0] || '',
            shipmentMethodName: 'Standard',
            fulfillmentCountry: data.shipping_address?.country_code,
          }));
          newStatus = 'shipped';
        }
      }

      if (luluStatus === 'REJECTED' || luluStatus === 'ERROR') {
        console.error(`[Lulu Webhook] Print job ${typeof data.status === 'string' ? data.status : data.status?.name} for order ${order.id}:`, {
          errors: errorDetails,
          rawData: data,
        });
      }
    }

    let currentOrder = order;
    if (newStatus) {
      currentOrder = yield* orderStore.updateStatus(
        order.id,
        newStatus,
        actor,
        eventType,
        { eventType, errorDetails, ...metadata },
      );
    }

    if (trackingInfo) {
      currentOrder = yield* orderStore.updateTracking(
        order.id,
        trackingInfo,
        actor,
        { eventType, ...metadata },
      );
    }

    return { order: currentOrder, ...(trackingInfo ? { trackingInfo } : {}) };
  });
}
