import { useCart } from "@/hooks/use-cart";
import { apiClient } from "@/utils/orpc";
import type { Order } from "@/integrations/api/orders";
import { type OrderStatus, statusLabels } from "@/lib/order-status";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle,
  ExternalLink,
  Loader2,
  Package,
  Truck,
  XCircle,
  Clock,
  AlertTriangle,
  History,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type SearchParams = {
  orderNumber?: string;
  email?: string;
  sessionId?: string;
};

export const Route = createFileRoute("/_marketplace/_authenticated/order-confirmation")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    orderNumber:
      typeof search.orderNumber === "string" ? search.orderNumber : undefined,
    email: typeof search.email === "string" ? search.email : undefined,
    sessionId:
      typeof search.sessionId === "string" ? search.sessionId : undefined,
  }),
  component: OrderConfirmationPage,
});

type OrderStep = 'payment' | 'processing' | 'shipped';

interface StepConfig {
  label: string;
  icon: React.ReactNode;
  activeStatuses: OrderStatus[];
  completedStatuses: OrderStatus[];
  errorStatuses: OrderStatus[];
}

const steps: Record<OrderStep, StepConfig> = {
  payment: {
    label: 'Payment',
    icon: <CheckCircle className="size-5" />,
    activeStatuses: ['pending', 'draft_created', 'payment_pending'],
    completedStatuses: ['paid', 'paid_pending_fulfillment', 'processing', 'shipped', 'delivered', 'on_hold', 'refunded'],
    errorStatuses: ['payment_failed', 'expired', 'cancelled', 'failed'],
  },
  processing: {
    label: 'Processing',
    icon: <Package className="size-5" />,
    activeStatuses: ['paid', 'paid_pending_fulfillment', 'on_hold'],
    completedStatuses: ['processing', 'shipped', 'delivered'],
    errorStatuses: ['failed', 'cancelled', 'partially_cancelled'],
  },
  shipped: {
    label: 'Shipped',
    icon: <Truck className="size-5" />,
    activeStatuses: ['processing'],
    completedStatuses: ['shipped', 'delivered'],
    errorStatuses: ['returned', 'cancelled'],
  },
};

function getStepStatus(step: OrderStep, orderStatus?: OrderStatus): 'pending' | 'active' | 'completed' | 'error' {
  if (!orderStatus) return 'pending';
  
  const config = steps[step];
  
  if (config.errorStatuses.includes(orderStatus)) return 'error';
  if (config.completedStatuses.includes(orderStatus)) return 'completed';
  if (config.activeStatuses.includes(orderStatus)) return 'active';
  
  return 'pending';
}

function OrderProgressIndicator({ status }: { status?: OrderStatus }) {
  const stepOrder: OrderStep[] = ['payment', 'processing', 'shipped'];
  
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between max-w-md mx-auto">
        {stepOrder.map((step, index) => {
          const stepStatus = getStepStatus(step, status);
          const config = steps[step];
          
          return (
            <div key={step} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "size-10 rounded-full flex items-center justify-center transition-colors border-2",
                    stepStatus === 'completed' && "bg-[#00EC97] border-[#00EC97] text-black",
                    stepStatus === 'active' && "bg-yellow-500/20 border-yellow-500 text-yellow-600 animate-pulse",
                    stepStatus === 'pending' && "bg-background/60 border-border/60 text-foreground/50 dark:text-muted-foreground",
                    stepStatus === 'error' && "bg-destructive/20 border-destructive text-destructive"
                  )}
                >
                  {stepStatus === 'active' ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : stepStatus === 'error' ? (
                    <XCircle className="size-5" />
                  ) : stepStatus === 'completed' ? (
                    <CheckCircle className="size-5" />
                  ) : (
                    config.icon
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs mt-2 font-semibold",
                    stepStatus === 'completed' && "text-[#00EC97]",
                    stepStatus === 'active' && "text-yellow-600",
                    stepStatus === 'pending' && "text-foreground/50 dark:text-muted-foreground",
                    stepStatus === 'error' && "text-destructive"
                  )}
                >
                  {config.label}
                </span>
              </div>
              
              {index < stepOrder.length - 1 && (
                <div
                  className={cn(
                    "w-16 h-0.5 mx-2 mt-[-1rem]",
                    getStepStatus(stepOrder[index + 1], status) !== 'pending'
                      ? "bg-[#00EC97]"
                      : "bg-border/60"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusMessage({ status }: { status?: OrderStatus }) {
  const defaultMessage = {
    icon: <Clock className="size-12 text-gray-400" />,
    title: "Waiting for payment...",
    description: "Please complete your payment to proceed with your order.",
  };

  const messages: Partial<Record<OrderStatus, { icon: React.ReactNode; title: string; description: string }>> = {
    pending: defaultMessage,
    draft_created: {
      icon: <Clock className="size-12 text-yellow-500 animate-pulse" />,
      title: "Waiting for payment confirmation...",
      description: "Your order is ready. Complete the payment to proceed.",
    },
    payment_pending: {
      icon: <Loader2 className="size-12 text-yellow-500 animate-spin" />,
      title: "Payment is being processed...",
      description: "Please wait while we confirm your payment. This may take a moment.",
    },
    paid: {
      icon: <CheckCircle className="size-12 text-green-500" />,
      title: "Payment confirmed!",
      description: "Your payment was successful. We're now processing your order.",
    },
    paid_pending_fulfillment: {
      icon: <Package className="size-12 text-blue-500 animate-pulse" />,
      title: "Payment confirmed!",
      description: "Your payment was successful. We're finalizing your order with our fulfillment partners.",
    },
    processing: {
      icon: <CheckCircle className="size-12 text-green-500" />,
      title: "Order placed successfully!",
      description: "Your order has been confirmed and is being prepared for shipment.",
    },
    shipped: {
      icon: <Truck className="size-12 text-blue-500" />,
      title: "Your order has shipped!",
      description: "Your package is on its way. Check below for tracking information.",
    },
    delivered: {
      icon: <CheckCircle className="size-12 text-green-500" />,
      title: "Order delivered!",
      description: "Your order has been delivered. Enjoy your purchase!",
    },
    payment_failed: {
      icon: <XCircle className="size-12 text-red-500" />,
      title: "Payment failed",
      description: "Unfortunately, your payment could not be processed. Please try again.",
    },
    expired: {
      icon: <AlertTriangle className="size-12 text-orange-500" />,
      title: "Session expired",
      description: "Your payment session has expired. Please create a new checkout.",
    },
    cancelled: {
      icon: <XCircle className="size-12 text-red-500" />,
      title: "Order cancelled",
      description: "This order has been cancelled.",
    },
    on_hold: {
      icon: <AlertTriangle className="size-12 text-orange-500" />,
      title: "Order on hold",
      description: "Your order is on hold. Our team is reviewing it and will reach out if needed.",
    },
    returned: {
      icon: <Package className="size-12 text-red-500" />,
      title: "Order returned",
      description: "Your shipment has been returned. Please contact support for assistance.",
    },
    failed: {
      icon: <XCircle className="size-12 text-red-500" />,
      title: "Order failed",
      description: "Unfortunately, your order could not be processed. Please contact support.",
    },
    refunded: {
      icon: <CheckCircle className="size-12 text-purple-500" />,
      title: "Order refunded",
      description: "Your order has been refunded. The amount will appear in your account shortly.",
    },
    partially_cancelled: {
      icon: <AlertTriangle className="size-12 text-orange-500" />,
      title: "Order partially cancelled",
      description: "Some items in your order have been cancelled. Check your order details.",
    },
  };

  const message = (status && messages[status]) || defaultMessage;

  return (
    <div className="text-center mb-8">
      <div className="flex justify-center mb-4">{message.icon}</div>
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">{message.title}</h1>
      <p className="text-sm text-foreground/90 dark:text-muted-foreground">{message.description}</p>
    </div>
  );
}

const TERMINAL_STATUSES: OrderStatus[] = ['shipped', 'delivered', 'cancelled', 'failed', 'returned', 'refunded', 'on_hold', 'partially_cancelled'];

type AuditLog = Awaited<ReturnType<typeof apiClient.getOrderAuditLog>>['logs'][0];

function OrderHistory({ logs }: { logs: AuditLog[] }) {
  if (logs.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold tracking-tight mb-4 flex items-center gap-2">
        <History className="h-5 w-5" />
        Order History
      </h3>
      <div className="space-y-3">
        {logs.map((log, index) => (
          <div key={log.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn(
                "w-2 h-2 rounded-full",
                index === 0 ? "bg-[#00EC97]" : "bg-border/60"
              )} />
              {index < logs.length - 1 && (
                <div className="w-0.5 flex-1 bg-border/30 my-1" />
              )}
            </div>
            <div className="flex-1 pb-4">
              <p className="text-sm font-medium text-foreground">
                {log.action === 'status_change' && 'Status changed'}
                {log.action === 'tracking_update' && 'Tracking information added'}
              </p>
              {log.oldValue && log.newValue && (
                <p className="text-xs text-foreground/70 mt-1">
                  {statusLabels[log.oldValue as OrderStatus] || log.oldValue}
                  {' → '}
                  <span className="text-foreground font-medium">
                    {statusLabels[log.newValue as OrderStatus] || log.newValue}
                  </span>
                </p>
              )}
              {typeof log.metadata?.reason === 'string' && log.metadata.reason.trim().length > 0 && (
                <p className="mt-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs text-foreground/80 whitespace-pre-wrap break-words">
                  {log.metadata.reason}
                </p>
              )}
              <p className="text-xs text-foreground/50 mt-1">
                {new Date(log.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderConfirmationPage() {
  const { sessionId } = Route.useSearch();
  const { clearCart } = useCart();

  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setError] = useState<Error | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false);
      return;
    }

    const abortController = new AbortController();

    (async () => {
      try {
        const initialData = await apiClient.getOrderByCheckoutSession({ sessionId: sessionId });
        if (initialData.order) {
          setOrder(initialData.order);
          setIsLoading(false);

          if (TERMINAL_STATUSES.includes(initialData.order.status)) {
            return;
          }
        }

        const stream = await apiClient.subscribeOrderStatus(
          { sessionId: sessionId },
          { signal: abortController.signal }
        );

        for await (const event of stream) {
          setOrder((prev: Order | null) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: event.status,
              trackingInfo: event.trackingInfo,
              updatedAt: event.updatedAt,
            };
          });
          setIsLoading(false);

          if (TERMINAL_STATUSES.includes(event.status)) {
            break;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('[OrderConfirmation] Stream error:', err);
        setError(err instanceof Error ? err : new Error('Failed to load order'));
        setIsLoading(false);
      }
    })();

    return () => abortController.abort();
  }, [sessionId]);

  useEffect(() => {
    if (order?.id) {
      apiClient.getOrderAuditLog({ id: order.id })
        .then(result => setAuditLogs(result.logs))
        .catch(error => console.error('Failed to fetch audit log:', error));
    }
  }, [order?.id]);

  useEffect(() => {
    if (order && ['paid', 'processing', 'shipped', 'delivered'].includes(order.status)) {
      clearCart();
    }
  }, [order?.status]);

  if (isLoading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center pt-32">
        <div className="flex flex-col items-center">
          <Loader2 className="size-8 animate-spin text-[#00EC97] mb-4" />
          <p className="text-foreground/90 dark:text-muted-foreground">Loading order details...</p>
        </div>
      </div>
    );
  }

  const isErrorState = ['payment_failed', 'expired', 'cancelled', 'failed', 'returned'].includes(order?.status || '');
  const isSuccessState = ['processing', 'shipped', 'delivered'].includes(order?.status || '');

  return (
    <div className="bg-background min-h-screen pt-32">
      <div className="max-w-[1408px] mx-auto px-4 md:px-8 lg:px-16 mb-8">
          <Link
            to="/"
          className="inline-flex items-center gap-2 rounded-2xl border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8 hover:border-[#00EC97] hover:text-[#00EC97] transition-colors"
          >
          <svg className="size-5" fill="none" viewBox="0 0 16 16">
              <path
                d="M8 12.6667L3.33333 8L8 3.33333"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.33333"
              />
              <path
                d="M12.6667 8H3.33333"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.33333"
              />
            </svg>
          <span className="text-sm font-semibold">Back to Store</span>
          </Link>
      </div>

      <div className="max-w-[672px] mx-auto px-4 md:px-8 lg:px-16 pb-16">
        <OrderProgressIndicator status={order?.status} />
        <StatusMessage status={order?.status} />

        {isErrorState && (
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link
              to="/checkout"
              className="inline-flex items-center justify-center px-8 py-3 rounded-lg bg-[#00EC97] text-black text-sm font-semibold hover:bg-[#00d97f] transition-colors"
            >
              Try Again
            </Link>
            <Link
              to="/"
              className="inline-flex items-center justify-center px-8 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground text-sm font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        )}

        {order && !isErrorState && (
          <div className="rounded-2xl bg-background border border-border/60 p-6 md:p-8 space-y-6">
            <div>
              <h3 className="text-xl font-bold tracking-tight mb-4">Order Details</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground/90 dark:text-muted-foreground">Order ID</span>
                  <span className="font-mono text-foreground font-medium">
                    {order.id.substring(0, 8)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/90 dark:text-muted-foreground">Status</span>
                  <OrderStatusBadge
                    status={order.status}
                    note={order.currentStatusNote}
                    noteCreatedAt={order.currentStatusNoteCreatedAt}
                  />
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/90 dark:text-muted-foreground">Items</span>
                  <span className="text-foreground font-medium">
                    {order.items.length} item
                    {order.items.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/90 dark:text-muted-foreground">Total Quantity</span>
                  <span className="text-foreground font-medium">
                    {order.items.reduce(
                      (sum, item) => sum + item.quantity,
                      0
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground/90 dark:text-muted-foreground">Total</span>
                  <span className="font-semibold text-foreground">
                    ${order.totalAmount.toFixed(2)} {order.currency}
                  </span>
                </div>
              </div>
            </div>

            <div className="h-px bg-border/60" />

            {auditLogs.length > 0 && (
              <>
                <OrderHistory logs={auditLogs} />
                <div className="h-px bg-border/60" />
              </>
            )}

            {order?.trackingInfo && order.trackingInfo.length > 0 && (
              <>
                <div>
                  <h3 className="text-lg font-bold tracking-tight mb-4">
                    Tracking Information
                  </h3>
                  <div className="space-y-3">
                    {order.trackingInfo.map((tracking, index) => (
                      <div key={index} className="rounded-lg bg-background/60 border border-border/60 p-4">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground mb-1">
                              {tracking.shipmentMethodName}
                            </p>
                            <p className="text-xs text-foreground/70 dark:text-muted-foreground font-mono">
                              {tracking.trackingCode}
                            </p>
                          </div>
                          {tracking.trackingUrl && (
                            <a
                              href={tracking.trackingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors shrink-0"
                            >
                              Track <ExternalLink className="size-3 ml-1" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-border/60" />
              </>
            )}

            {order?.shippingAddress && (
              <>
                <div>
                  <h3 className="text-lg font-bold tracking-tight mb-4">Shipping Address</h3>
                  <div className="text-sm text-foreground/90 dark:text-muted-foreground space-y-1">
                    <p className="text-foreground font-medium">
                      {order.shippingAddress.firstName}{" "}
                      {order.shippingAddress.lastName}
                    </p>
                    <p>{order.shippingAddress.addressLine1}</p>
                    {order.shippingAddress.addressLine2 && (
                      <p>{order.shippingAddress.addressLine2}</p>
                    )}
                    <p>
                      {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
                      {order.shippingAddress.postCode}
                    </p>
                    <p>{order.shippingAddress.country}</p>
                    {order.shippingAddress.phone && (
                      <p className="pt-1">{order.shippingAddress.phone}</p>
                    )}
                  </div>
                </div>

                <div className="h-px bg-border/60" />
              </>
            )}

            <div>
              <h3 className="text-lg font-bold tracking-tight mb-4">What's Next?</h3>

              <div className="space-y-4">
                {order.status === 'shipped' || order.status === 'delivered' ? (
                  <div className="flex gap-4">
                    <div className="size-10 rounded-full bg-background/60 border border-border/60 flex items-center justify-center flex-shrink-0">
                      <Truck className="size-5 text-foreground/90 dark:text-muted-foreground" />
                    </div>
                    <div>
                      <h4 className="text-base font-semibold mb-1 text-foreground">
                        {order.status === 'delivered' ? 'Order delivered' : 'Your order is on the way'}
                      </h4>
                      <p className="text-sm text-foreground/90 dark:text-muted-foreground leading-5">
                        {order?.trackingInfo?.some((item) => item.trackingUrl)
                          ? 'Use the tracking link above to follow your shipment.'
                          : order?.deliveryEstimate
                            ? `Expected delivery: ${new Date(
                                order.deliveryEstimate.minDeliveryDate
                              ).toLocaleDateString()} - ${new Date(
                                order.deliveryEstimate.maxDeliveryDate
                              ).toLocaleDateString()}`
                            : 'Your fulfillment partner has dispatched this order.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-4">
                      <div className="size-10 rounded-full bg-background/60 border border-border/60 flex items-center justify-center flex-shrink-0">
                        <Package className="size-5 text-foreground/90 dark:text-muted-foreground" />
                      </div>
                      <div>
                        <h4 className="text-base font-semibold mb-1 text-foreground">Processing Your Order</h4>
                        <p className="text-sm text-foreground/90 dark:text-muted-foreground leading-5">
                          We're preparing your items for shipment. This typically
                          takes 1-2 business days.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <div className="size-10 rounded-full bg-background/60 border border-border/60 flex items-center justify-center flex-shrink-0">
                        <Truck className="size-5 text-foreground/90 dark:text-muted-foreground" />
                      </div>
                      <div>
                        <h4 className="text-base font-semibold mb-1 text-foreground">Shipping & Delivery</h4>
                        <p className="text-sm text-foreground/90 dark:text-muted-foreground leading-5">
                          {order?.deliveryEstimate
                            ? `Expected delivery: ${new Date(
                                order.deliveryEstimate.minDeliveryDate
                              ).toLocaleDateString()} - ${new Date(
                                order.deliveryEstimate.maxDeliveryDate
                              ).toLocaleDateString()}`
                            : "You'll receive tracking information once your order ships."}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {isSuccessState && (
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/account"
              className="inline-flex items-center justify-center px-8 py-3 rounded-lg bg-[#00EC97] text-black text-sm font-semibold hover:bg-[#00d97f] transition-colors"
            >
              View Your Orders
            </Link>
            <Link
              to="/"
              className="inline-flex items-center justify-center px-8 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground text-sm font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        )}

        <p className="text-sm text-foreground/90 dark:text-muted-foreground text-center mt-8">
          Need help with your order? Contact us at{" "}
          <a
            href="mailto:merch@near.foundation"
            className="underline hover:text-[#00EC97] transition-colors"
          >
            merch@near.foundation
          </a>
        </p>
      </div>
    </div>
  );
}
