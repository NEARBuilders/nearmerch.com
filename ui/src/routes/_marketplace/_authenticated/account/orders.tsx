import { createFileRoute, useRouter, Link } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ExternalLink, Package, History } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { apiClient } from '@/utils/orpc';
import { cn } from '@/lib/utils';
import { AuditLogViewer } from '@/components/orders/audit-log-viewer';
import { OrderIdCell } from '@/components/orders/order-id-cell';
import { OrderItemsCell } from '@/components/orders/order-items-cell';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute('/_marketplace/_authenticated/account/orders')({
  loader: () => apiClient.getOrders({ limit: 100, offset: 0 }),
  errorComponent: OrdersError,
  component: OrdersPage,
});

type Order = Awaited<ReturnType<typeof apiClient.getOrders>>['orders'][0];

function OrdersError({ error }: { error: Error }) {
  const router = useRouter();

  return (
    <div className="text-center py-12">
      <p className="text-destructive mb-2 font-semibold">Failed to load orders</p>
      <p className="text-sm text-foreground/90 dark:text-muted-foreground mb-4">{error.message}</p>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="px-6 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors mx-auto"
      >
        Try Again
      </button>
    </div>
  );
}

function OrderTimelineModal({ order, isOpen, onClose }: { order: Order; isOpen: boolean; onClose: () => void }) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl bg-background border border-border/60">
        <DialogHeader>
          <DialogTitle>Order Timeline - {order.id.substring(0, 8)}...</DialogTitle>
          <DialogDescription>
            Track your order's journey
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <AuditLogViewer orderId={order.id} variant="customer" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrdersPage() {
  const loaderData = Route.useLoaderData();
  const [auditLogOrder, setAuditLogOrder] = useState<Order | null>(null);
  const [isTimelineModalOpen, setIsTimelineModalOpen] = useState(false);

  if (!loaderData) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div>
          <h2 className="text-xl md:text-2xl lg:text-3xl font-bold tracking-tight mb-1 md:mb-2">My Orders</h2>
          <p className="text-xs md:text-sm text-foreground/90 dark:text-muted-foreground">
            View your order history and track shipments
          </p>
        </div>
        <div className="rounded-xl md:rounded-2xl bg-background border border-border/60 px-4 md:px-6 py-8 md:py-12">
          <div className="flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-6 w-6 md:h-8 md:w-8 border-b-2 border-[#00EC97] mx-auto mb-2"></div>
              <p className="text-xs md:text-sm text-foreground/90 dark:text-muted-foreground">Loading orders...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { orders: rawOrders } = loaderData ?? { orders: [] };
  const orders = rawOrders?.filter(Boolean) ?? [];

  const handleViewTimeline = (order: Order) => {
    setAuditLogOrder(order);
    setIsTimelineModalOpen(true);
  };

  const columns: ColumnDef<Order>[] = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Order ID',
        cell: ({ row }) => <OrderIdCell orderId={row.original.id} />,
      },
      {
        accessorKey: 'createdAt',
        header: 'Date',
        cell: ({ row }) => (
          <span className="text-sm text-foreground/90 dark:text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
      },
      {
        accessorKey: 'items',
        header: 'Items',
        cell: ({ row }) => (
          <OrderItemsCell items={row.original.items || []} />
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <OrderStatusBadge
            status={row.original.status}
            note={row.original.currentStatusNote}
            noteCreatedAt={row.original.currentStatusNoteCreatedAt}
          />
        ),
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total',
        cell: ({ row }) => (
          <span className="font-semibold text-foreground">
            ${row.original.totalAmount.toFixed(2)} {row.original.currency}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const order = row.original;
          const hasTracking = order.trackingInfo?.[0]?.trackingUrl;

          return (
            <div className="flex items-center gap-2">
              {hasTracking && (
                  <a
                    href={order.trackingInfo![0]!.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
              >
                  Track <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              )}
              <button
                type="button"
                onClick={() => handleViewTimeline(order)}
                className="px-3 py-1.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
              >
                <History className="h-3 w-3 mr-1" />
                Timeline
              </button>
              <Link
                to="/order-confirmation"
                search={{ sessionId: order.checkoutSessionId || '' }}
                className="px-3 py-1.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
              >
                  View Details
                </Link>
            </div>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h2 className="text-xl md:text-2xl lg:text-3xl font-bold tracking-tight mb-1 md:mb-2">My Orders</h2>
        <p className="text-xs md:text-sm text-foreground/90 dark:text-muted-foreground">View and track your order history</p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl md:rounded-2xl bg-background/40 border border-border/60 p-8 md:p-12 text-center">
          <Package className="mx-auto h-8 w-8 md:h-12 md:w-12 text-foreground/50 dark:text-muted-foreground mb-3 md:mb-4" />
          <p className="text-sm md:text-base text-foreground/90 dark:text-muted-foreground font-medium mb-1">No orders yet</p>
          <p className="text-xs md:text-sm text-foreground/70 dark:text-muted-foreground">Your orders will appear here once you make a purchase</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-hidden">
        <DataTable columns={columns} data={orders} />
        </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {orders.map((order) => {
              const hasTracking = order.trackingInfo?.[0]?.trackingUrl;

              return (
                <div key={order.id} className="rounded-xl bg-background border border-border/60 p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <OrderIdCell
                          orderId={order.id}
                          textClassName="text-xs font-semibold"
                        />
                        <OrderStatusBadge
                          status={order.status}
                          note={order.currentStatusNote}
                          noteCreatedAt={order.currentStatusNoteCreatedAt}
                        />
                      </div>
                      <p className="text-xs text-foreground/70 dark:text-muted-foreground mb-1">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                      <OrderItemsCell items={order.items || []} compact />
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-foreground">
                        ${order.totalAmount.toFixed(2)} {order.currency}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {hasTracking && (
                      <a
                        href={order.trackingInfo![0]!.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "flex-1 px-3 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors",
                          !order.checkoutSessionId && "w-full"
                        )}
                      >
                        Track <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleViewTimeline(order)}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors",
                        !hasTracking && !order.checkoutSessionId && "w-full"
                      )}
                    >
                      <History className="h-3 w-3 mr-1" />
                      Timeline
                    </button>
                    {order.checkoutSessionId && (
                      <Link
                        to="/order-confirmation"
                        search={{ sessionId: order.checkoutSessionId }}
                        className={cn(
                          "flex-1 px-3 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors",
                          !hasTracking && "w-full"
                        )}
                      >
                        View Details
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Timeline Modal */}
      {auditLogOrder && (
        <OrderTimelineModal
          order={auditLogOrder}
          isOpen={isTimelineModalOpen}
          onClose={() => {
            setIsTimelineModalOpen(false);
            setAuditLogOrder(null);
          }}
        />
      )}
    </div>
  );
}
