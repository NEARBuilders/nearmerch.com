import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { customAlphabet } from "nanoid";
import * as schema from "../db/schema";
import type { CreateOrderInput, DeliveryEstimate, OrderAuditLog, OrderItem, OrderStatus, OrderWithItems, ShippingAddress, TrackingInfo } from "../schema";
import { Database } from "./database";

const makeFulfillmentReferenceId = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  15
);

export class OrderStore extends Context.Tag("OrderStore")<
  OrderStore,
  {
    readonly create: (input: CreateOrderInput) => Effect.Effect<OrderWithItems, Error>;
    readonly find: (id: string) => Effect.Effect<OrderWithItems | null, Error>;
    readonly findAll: (options: { limit?: number; offset?: number; status?: OrderStatus; search?: string; includeDeleted?: boolean }) => Effect.Effect<{ orders: OrderWithItems[]; total: number }, Error>;
    readonly findByUser: (userId: string, options: { limit?: number; offset?: number; includeDeleted?: boolean }) => Effect.Effect<{ orders: OrderWithItems[]; total: number }, Error>;
    readonly findByCheckoutSession: (checkoutSessionId: string) => Effect.Effect<OrderWithItems | null, Error>;
    readonly findByFulfillmentRef: (fulfillmentReferenceId: string) => Effect.Effect<OrderWithItems | null, Error>;
    readonly findAbandonedDrafts: (olderThanHours: number) => Effect.Effect<OrderWithItems[], Error>;
    readonly findPendingConfirmation: (olderThanMinutes?: number) => Effect.Effect<OrderWithItems[], Error>;
    readonly updateCheckout: (orderId: string, checkoutSessionId: string, checkoutProvider: 'stripe' | 'near' | 'pingpay') => Effect.Effect<OrderWithItems, Error>;
    readonly updateDraftOrderIds: (orderId: string, draftOrderIds: Record<string, string>) => Effect.Effect<OrderWithItems, Error>;
    readonly updatePaymentDetails: (orderId: string, paymentDetails: Record<string, unknown>) => Effect.Effect<OrderWithItems, Error>;
    readonly updateStatus: (orderId: string, status: OrderStatus, actor?: string, reason?: string, metadata?: Record<string, unknown>) => Effect.Effect<OrderWithItems, Error>;
    readonly updateShipping: (orderId: string, shippingAddress: ShippingAddress) => Effect.Effect<OrderWithItems, Error>;
    readonly updateFulfillment: (orderId: string, fulfillmentOrderId: string, actor?: string) => Effect.Effect<OrderWithItems, Error>;
    readonly updateTracking: (orderId: string, trackingInfo: TrackingInfo[], actor?: string, metadata?: Record<string, unknown>) => Effect.Effect<OrderWithItems, Error>;
    readonly updateDeliveryEstimate: (orderId: string, deliveryEstimate: DeliveryEstimate) => Effect.Effect<OrderWithItems, Error>;
    readonly getAuditLog: (orderId: string) => Effect.Effect<OrderAuditLog[], Error>;
    readonly deleteOrders: (orderIds: string[], actor: string) => Effect.Effect<{ deleted: number; errors: { orderId: string; error: string }[] }, Error>;
    readonly createAuditLog: (input: { orderId: string; actor: string; action: string; field?: string; oldValue?: string; newValue?: string; metadata?: Record<string, unknown> }) => Effect.Effect<void, Error>;
  }
>() { }

export const OrderStoreLive = Layer.effect(
  OrderStore,
  Effect.gen(function* () {
    const db = yield* Database;

    const getOrderItems = async (orderId: string): Promise<OrderItem[]> => {
      const items = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId));

      return items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        variantId: item.variantId || undefined,
        productName: item.productName,
        variantName: item.variantName || undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice / 100,
        attributes: item.attributes || undefined,
        fulfillmentProvider: item.fulfillmentProvider || undefined,
        fulfillmentConfig: (item.fulfillmentConfig as Record<string, unknown> | null) || undefined,
      }));
    };

    const getCurrentStatusNote = async (orderId: string, status: OrderStatus) => {
      const logs = await db
        .select()
        .from(schema.orderAuditLogs)
        .where(and(
          eq(schema.orderAuditLogs.orderId, orderId),
          eq(schema.orderAuditLogs.action, 'status_change'),
          eq(schema.orderAuditLogs.newValue, status),
        ))
        .orderBy(desc(schema.orderAuditLogs.createdAt));

      const noteLog = logs.find((log) => {
        const reason = log.metadata?.reason;
        return typeof reason === 'string' && reason.trim().length > 0;
      });

      if (!noteLog) {
        return undefined;
      }

      return {
        currentStatusNote: String(noteLog.metadata?.reason),
        currentStatusNoteActor: noteLog.actor,
        currentStatusNoteCreatedAt: noteLog.createdAt.toISOString(),
      };
    };

    const rowToOrder = async (row: typeof schema.orders.$inferSelect): Promise<OrderWithItems> => {
      const items = await getOrderItems(row.id);
      const currentStatusNote = await getCurrentStatusNote(row.id, row.status as OrderStatus);

      return {
        id: row.id,
        userId: row.userId,
        status: row.status as OrderStatus,
        currentStatusNote: currentStatusNote?.currentStatusNote,
        currentStatusNoteActor: currentStatusNote?.currentStatusNoteActor,
        currentStatusNoteCreatedAt: currentStatusNote?.currentStatusNoteCreatedAt,
        subtotal: row.subtotal !== null ? row.subtotal / 100 : undefined,
        shippingCost: row.shippingCost !== null ? row.shippingCost / 100 : undefined,
        taxAmount: row.taxAmount !== null ? row.taxAmount / 100 : undefined,
        vatAmount: row.vatAmount !== null ? row.vatAmount / 100 : undefined,
        taxRequired: row.taxRequired ?? undefined,
        taxRate: row.taxRate ?? undefined,
        taxShippingTaxable: row.taxShippingTaxable ?? undefined,
        taxExempt: row.taxExempt ?? undefined,
        customerTaxId: row.customerTaxId ?? undefined,
        totalAmount: row.totalAmount / 100,
        currency: row.currency,
        checkoutSessionId: row.checkoutSessionId || undefined,
        checkoutProvider: row.checkoutProvider === 'stripe' || row.checkoutProvider === 'near' || row.checkoutProvider === 'pingpay'
          ? row.checkoutProvider 
          : undefined,
        draftOrderIds: row.draftOrderIds || undefined,
        paymentDetails: row.paymentDetails || undefined,
        shippingMethod: row.shippingMethod || undefined,
        shippingAddress: row.shippingAddress || undefined,
        fulfillmentOrderId: row.fulfillmentOrderId || undefined,
        fulfillmentReferenceId: row.fulfillmentReferenceId || undefined,
        trackingInfo: row.trackingInfo || undefined,
        deliveryEstimate: row.deliveryEstimate || undefined,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        items,
      };
    };

    const findOrderById = async (id: string): Promise<OrderWithItems | null> => {
      const results = await db
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.id, id), eq(schema.orders.isDeleted, false)))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      return await rowToOrder(results[0]!);
    };

    return {
      create: (input) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            const orderId = crypto.randomUUID();
            const fulfillmentReferenceId = `o${makeFulfillmentReferenceId()}`;

            await db.insert(schema.orders).values({
              id: orderId,
              userId: input.userId,
              status: 'pending',
              subtotal: input.subtotal !== undefined ? Math.round(input.subtotal * 100) : null,
              shippingCost: input.shippingCost !== undefined ? Math.round(input.shippingCost * 100) : null,
              taxAmount: input.taxAmount !== undefined ? Math.round(input.taxAmount * 100) : null,
              vatAmount: input.vatAmount !== undefined ? Math.round(input.vatAmount * 100) : null,
              taxRequired: input.taxRequired ?? null,
              taxRate: input.taxRate ?? null,
              taxShippingTaxable: input.taxShippingTaxable ?? null,
              taxExempt: input.taxExempt ?? false,
              customerTaxId: input.customerTaxId ?? null,
              totalAmount: Math.round(input.totalAmount * 100),
              currency: input.currency,
              shippingMethod: input.shippingMethod || null,
              fulfillmentReferenceId,
              createdAt: now,
              updatedAt: now,
            });

            if (input.items.length > 0) {
              await db.insert(schema.orderItems).values(
                input.items.map((item, index) => ({
                  id: `${orderId}-item-${index}`,
                  orderId,
                  productId: item.productId,
                  variantId: item.variantId || null,
                  productName: item.productName,
                  variantName: item.variantName || null,
                  quantity: item.quantity,
                  unitPrice: Math.round(item.unitPrice * 100),
                  attributes: item.attributes || null,
                  fulfillmentProvider: item.fulfillmentProvider || null,
                  fulfillmentConfig: item.fulfillmentConfig || null,
                  createdAt: now,
                }))
              );
            }

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Failed to create order');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to create order: ${error}`),
        }),

      find: (id) =>
        Effect.tryPromise({
          try: async () => findOrderById(id),
          catch: (error) => new Error(`Failed to find order: ${error}`),
        }),

      findAll: (options) =>
        Effect.tryPromise({
          try: async () => {
            const { limit = 50, offset = 0, status, search, includeDeleted = false } = options;

            const conditions = [];

            // Always filter deleted unless explicitly included
            if (!includeDeleted) {
              conditions.push(eq(schema.orders.isDeleted, false));
            }

            if (status) {
              conditions.push(eq(schema.orders.status, status));
            }

            if (search) {
              conditions.push(
                or(
                  like(schema.orders.id, `%${search}%`),
                  like(schema.orders.userId, `%${search}%`)
                )
              );
            }

            const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

            const countResult = await db
              .select({ count: sql<number>`count(*)` })
              .from(schema.orders)
              .where(whereClause);

            const total = Number(countResult[0]?.count || 0);

            const results = await db
              .select()
              .from(schema.orders)
              .where(whereClause)
              .orderBy(desc(schema.orders.createdAt))
              .limit(limit)
              .offset(offset);

            const orders = await Promise.all(results.map(rowToOrder));

            return { orders, total };
          },
          catch: (error) => new Error(`Failed to find all orders: ${error}`),
        }),

      findByUser: (userId, options) =>
        Effect.tryPromise({
          try: async () => {
            const { limit = 10, offset = 0, includeDeleted = false } = options;

            const baseConditions = [eq(schema.orders.userId, userId)];
            if (!includeDeleted) {
              baseConditions.push(eq(schema.orders.isDeleted, false));
            }

            const allOrders = await db
              .select()
              .from(schema.orders)
              .where(and(...baseConditions));

            const total = allOrders.length;

            const results = await db
              .select()
              .from(schema.orders)
              .where(and(...baseConditions))
              .orderBy(desc(schema.orders.createdAt))
              .limit(limit)
              .offset(offset);

            const orders = await Promise.all(results.map(rowToOrder));

            return { orders, total };
          },
          catch: (error) => new Error(`Failed to find orders: ${error}`),
        }),

      findByCheckoutSession: (checkoutSessionId) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(schema.orders)
              .where(eq(schema.orders.checkoutSessionId, checkoutSessionId))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToOrder(results[0]!);
          },
          catch: (error) => new Error(`Failed to find order by checkout session: ${error}`),
        }),

      findByFulfillmentRef: (fulfillmentReferenceId) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(schema.orders)
              .where(eq(schema.orders.fulfillmentReferenceId, fulfillmentReferenceId))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToOrder(results[0]!);
          },
          catch: (error) => new Error(`Failed to find order by fulfillment ref: ${error}`),
        }),

      findAbandonedDrafts: (olderThanHours) =>
        Effect.tryPromise({
          try: async () => {
            const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

            const results = await db
              .select()
              .from(schema.orders)
              .where(and(
                eq(schema.orders.status, 'draft_created'),
                eq(schema.orders.isDeleted, false)
              ))
              .orderBy(desc(schema.orders.createdAt));

            const abandoned = results.filter(order => order.createdAt < cutoffTime);

            return await Promise.all(abandoned.map(rowToOrder));
          },
          catch: (error) => new Error(`Failed to find abandoned drafts: ${error}`),
        }),

      findPendingConfirmation: (olderThanMinutes = 5) =>
        Effect.tryPromise({
          try: async () => {
            const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);

            const results = await db
              .select()
              .from(schema.orders)
              .where(and(
                eq(schema.orders.status, 'paid_pending_fulfillment'),
                eq(schema.orders.isDeleted, false)
              ))
              .orderBy(desc(schema.orders.createdAt));

            const pending = results.filter(order => order.createdAt < cutoffTime);

            return await Promise.all(pending.map(rowToOrder));
          },
          catch: (error) => new Error(`Failed to find pending confirmation orders: ${error}`),
        }),

      updateCheckout: (orderId, checkoutSessionId, checkoutProvider) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(schema.orders)
              .set({
                checkoutSessionId,
                checkoutProvider,
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, orderId));

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Order not found');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to update order checkout: ${error}`),
        }),

      updateDraftOrderIds: (orderId, draftOrderIds) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(schema.orders)
              .set({
                draftOrderIds,
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, orderId));

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Order not found');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to update draft order IDs: ${error}`),
        }),

      updatePaymentDetails: (orderId, paymentDetails) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(schema.orders)
              .set({
                paymentDetails,
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, orderId));

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Order not found');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to update payment details: ${error}`),
        }),

      updateStatus: (orderId, status, actor?, reason?, metadata?) =>
        Effect.tryPromise({
          try: async () => {
            // Get the current order to log the old status
            const currentOrder = await findOrderById(orderId);
            const oldStatus = currentOrder?.status;

            await db
              .update(schema.orders)
              .set({
                status,
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, orderId));

            // Create audit log entry
            const auditActor = actor || 'system';
            const auditMetadata = metadata || {};
            if (reason) {
              auditMetadata.reason = reason;
            }

            await db.insert(schema.orderAuditLogs).values({
              id: crypto.randomUUID(),
              orderId,
              actor: auditActor,
              action: 'status_change',
              field: 'status',
              oldValue: oldStatus,
              newValue: status,
              metadata: auditMetadata,
              createdAt: new Date(),
            });

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Order not found');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to update order status: ${error}`),
        }),

      updateShipping: (orderId, shippingAddress) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(schema.orders)
              .set({
                shippingAddress,
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, orderId));

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Order not found');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to update order shipping: ${error}`),
        }),

      updateFulfillment: (orderId, fulfillmentOrderId, actor?) =>
        Effect.tryPromise({
          try: async () => {
            const oldFulfillmentId = (await findOrderById(orderId))?.fulfillmentOrderId;

            await db
              .update(schema.orders)
              .set({
                fulfillmentOrderId,
                status: 'processing',
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, orderId));

            // Log the fulfillment update
            await db.insert(schema.orderAuditLogs).values({
              id: crypto.randomUUID(),
              orderId,
              actor: actor || 'system',
              action: 'fulfillment_update',
              field: 'fulfillmentOrderId',
              oldValue: oldFulfillmentId || null,
              newValue: fulfillmentOrderId,
              metadata: {},
              createdAt: new Date(),
            });

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Order not found');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to update order fulfillment: ${error}`),
        }),

      updateTracking: (orderId, trackingInfo, actor?, metadata?) =>
        Effect.tryPromise({
          try: async () => {
            const oldTracking = (await findOrderById(orderId))?.trackingInfo;

            await db
              .update(schema.orders)
              .set({
                trackingInfo,
                status: 'shipped',
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, orderId));

            // Log the tracking update
            await db.insert(schema.orderAuditLogs).values({
              id: crypto.randomUUID(),
              orderId,
              actor: actor || 'system',
              action: 'tracking_update',
              field: 'trackingInfo',
              oldValue: oldTracking ? JSON.stringify(oldTracking) : null,
              newValue: JSON.stringify(trackingInfo),
              metadata: metadata || {},
              createdAt: new Date(),
            });

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Order not found');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to update order tracking: ${error}`),
        }),

      updateDeliveryEstimate: (orderId, deliveryEstimate) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(schema.orders)
              .set({
                deliveryEstimate,
                updatedAt: new Date(),
              })
              .where(eq(schema.orders.id, orderId));

            const order = await findOrderById(orderId);
            if (!order) {
              throw new Error('Order not found');
            }
            return order;
          },
          catch: (error) => new Error(`Failed to update delivery estimate: ${error}`),
        }),

      createAuditLog: (input) =>
        Effect.tryPromise({
          try: async () => {
            await db.insert(schema.orderAuditLogs).values({
              id: crypto.randomUUID(),
              orderId: input.orderId,
              actor: input.actor,
              action: input.action,
              field: input.field || null,
              oldValue: input.oldValue || null,
              newValue: input.newValue || null,
              metadata: input.metadata || {},
              createdAt: new Date(),
            });
          },
          catch: (error) => new Error(`Failed to create audit log: ${error}`),
        }),

      getAuditLog: (orderId) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(schema.orderAuditLogs)
              .where(eq(schema.orderAuditLogs.orderId, orderId))
              .orderBy(desc(schema.orderAuditLogs.createdAt));

            return results.map(row => ({
              id: row.id,
              orderId: row.orderId,
              actor: row.actor,
              action: row.action as OrderAuditLog['action'],
              field: row.field || undefined,
              oldValue: row.oldValue || undefined,
              newValue: row.newValue || undefined,
              metadata: row.metadata || undefined,
              createdAt: row.createdAt.toISOString(),
            }));
          },
          catch: (error) => new Error(`Failed to get audit log: ${error}`),
        }),

      deleteOrders: (orderIds, actor) =>
        Effect.tryPromise({
          try: async () => {
            const errors: { orderId: string; error: string }[] = [];
            let deleted = 0;

            for (const orderId of orderIds) {
              try {
                const order = await findOrderById(orderId);
                if (!order) {
                  errors.push({ orderId, error: 'Order not found' });
                  continue;
                }

                const isDraft = order.status === 'draft_created' || order.status === 'pending';

                if (isDraft) {
                  // Hard delete drafts
                  await db.delete(schema.orders).where(eq(schema.orders.id, orderId));
                } else {
                  // Soft delete non-drafts
                  await db
                    .update(schema.orders)
                    .set({
                      isDeleted: true,
                      updatedAt: new Date(),
                    })
                    .where(eq(schema.orders.id, orderId));

                  // Log the deletion
                  await db.insert(schema.orderAuditLogs).values({
                    id: crypto.randomUUID(),
                    orderId,
                    actor,
                    action: 'delete',
                    field: 'isDeleted',
                    oldValue: 'false',
                    newValue: 'true',
                    metadata: { status: order.status, hardDelete: false },
                    createdAt: new Date(),
                  });
                }

                deleted++;
              } catch (err) {
                errors.push({ orderId, error: err instanceof Error ? err.message : String(err) });
              }
            }

            return { deleted, errors };
          },
          catch: (error) => new Error(`Failed to delete orders: ${error}`),
        }),
    };
  })
);

export type { OrderItem };
