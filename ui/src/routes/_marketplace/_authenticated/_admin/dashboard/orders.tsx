import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { ExternalLink, RefreshCw, Search, ShoppingBag, ChevronDown, ChevronUp, CreditCard, Trash2, History, AlertTriangle, Loader2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/utils/orpc";
import { ORDER_STATUSES, getAdminStatusLabel, getStatusLabel, getStatusColor, type OrderStatus } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import { AuditLogViewer } from "@/components/orders/audit-log-viewer";
import { OrderStatusNoteButton } from "@/components/orders/order-status-badge";
import { useUpdateOrderStatus } from "@/integrations/api/orders";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_marketplace/_authenticated/_admin/dashboard/orders")({
  validateSearch: (search: Record<string, unknown>) => ({
    orderId: typeof search.orderId === "string" ? search.orderId : undefined,
    search: typeof search.search === "string" ? search.search : undefined,
  }),
  loaderDeps: ({ search }) => ({
    orderId: search.orderId,
    search: search.search,
  }),
  loader: ({ deps }) =>
    apiClient.getAllOrders({
      limit: 100,
      offset: 0,
      search: deps.orderId ?? deps.search,
    }),
  errorComponent: OrdersError,
  component: AdminOrdersPage,
});

type Order = Awaited<ReturnType<typeof apiClient.getAllOrders>>["orders"][0];

function OrdersError({ error }: { error: Error }) {
  const router = useRouter();

  const isDatabaseError = error.message?.includes('relation') || 
                         error.message?.includes('table') ||
                         error.message?.includes('column');

  return (
    <div className="text-center py-12">
      <p className="text-destructive mb-2 font-semibold">Failed to load orders</p>
      <p className="text-sm text-foreground/90 dark:text-muted-foreground mb-4">{error.message}</p>
      {isDatabaseError && (
        <p className="text-xs text-foreground/60 dark:text-muted-foreground mb-4">
          Database may not be initialized. Run <code className="bg-background px-1.5 py-0.5 rounded text-[#00EC97]">bun db:migrate</code> in your terminal.
        </p>
      )}
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

function PaymentDetailsView({ paymentDetails }: { paymentDetails: Record<string, unknown> }) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    request: true,
    response: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const request = paymentDetails.request as Record<string, unknown> | undefined;
  const response = paymentDetails.response as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-foreground/90 dark:text-muted-foreground">Provider:</span>
          <span className="ml-2 font-medium text-foreground">{String(paymentDetails.provider || 'N/A')}</span>
        </div>
        <div>
          <span className="text-foreground/90 dark:text-muted-foreground">Created:</span>
          <span className="ml-2 font-medium text-foreground">
            {paymentDetails.createdAt
              ? new Date(String(paymentDetails.createdAt)).toLocaleString()
              : 'N/A'}
          </span>
        </div>
      </div>

      {request && (
        <div className="rounded-2xl bg-background border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('request')}
            className="w-full flex items-center justify-between p-4 hover:bg-background/60 transition-colors"
          >
            <span className="font-semibold">Request Payload</span>
            {expandedSections.request ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expandedSections.request && (
            <div className="p-4 border-t border-border/60 bg-background/40">
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                {JSON.stringify(request, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {response && (
        <div className="rounded-2xl bg-background border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('response')}
            className="w-full flex items-center justify-between p-4 hover:bg-background/60 transition-colors"
          >
            <span className="font-semibold">Response</span>
            {expandedSections.response ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expandedSections.response && (
            <div className="p-4 border-t border-border/60 bg-background/40">
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                {JSON.stringify(response, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderDetailsModal({ order, isOpen, onClose }: { order: Order; isOpen: boolean; onClose: () => void }) {
  const shippingAddress = order.shippingAddress;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto rounded-2xl bg-background border border-border/60">
        <DialogHeader>
          <DialogTitle>Order Details - {order.id.substring(0, 8)}...</DialogTitle>
          <DialogDescription>
            Shipping, items, and fulfillment details for this order
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2 py-4">
          <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
            <div>
              <p className="text-sm font-semibold">Shipping Address</p>
              {shippingAddress ? (
                <div className="mt-2 space-y-0.5 text-sm text-foreground/80">
                  <p>{shippingAddress.firstName} {shippingAddress.lastName}</p>
                  {shippingAddress.companyName && <p>{shippingAddress.companyName}</p>}
                  <p>{shippingAddress.addressLine1}</p>
                  {shippingAddress.addressLine2 && <p>{shippingAddress.addressLine2}</p>}
                  <p>{shippingAddress.city}{shippingAddress.state ? `, ${shippingAddress.state}` : ""} {shippingAddress.postCode}</p>
                  <p>{shippingAddress.country}</p>
                  <p>{shippingAddress.email}</p>
                  {shippingAddress.phone && <p>{shippingAddress.phone}</p>}
                  {shippingAddress.taxId && <p>Tax ID: {shippingAddress.taxId}</p>}
                </div>
              ) : (
                <p className="mt-2 text-sm text-foreground/60">No shipping address</p>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold">Order Summary</p>
              <div className="mt-2 space-y-1 text-sm text-foreground/80">
                <p>Status: {getAdminStatusLabel(order.status)}</p>
                <p>Total: ${order.totalAmount.toFixed(2)} {order.currency}</p>
                {order.checkoutProvider && <p>Checkout: {order.checkoutProvider}</p>}
                {order.shippingMethod && <p>Shipping method: {order.shippingMethod}</p>}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
            <p className="text-sm font-semibold">Items</p>
            <div className="space-y-2">
              {order.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/60 bg-background/60 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{item.productName}</p>
                      {item.variantName && <p className="text-xs text-foreground/60">{item.variantName}</p>}
                      {item.attributes && item.attributes.length > 0 && (
                        <p className="text-xs text-foreground/60 mt-1">
                          {item.attributes.map((attr) => `${attr.name}: ${attr.value}`).join(" · ")}
                        </p>
                      )}
                      {item.fulfillmentProvider && (
                        <p className="text-xs text-foreground/50 mt-1">Provider: {item.fulfillmentProvider}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-medium">x{item.quantity}</p>
                      <p className="text-xs text-foreground/60">${item.unitPrice.toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {order.paymentDetails && Object.keys(order.paymentDetails).length > 0 && (
          <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
            <p className="text-sm font-semibold">Payment Details</p>
            <PaymentDetailsView paymentDetails={order.paymentDetails} />
          </div>
        )}

        {order.trackingInfo && order.trackingInfo.length > 0 && (
          <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
            <p className="text-sm font-semibold">Tracking</p>
            <div className="space-y-2">
              {order.trackingInfo.map((tracking) => (
                <div key={tracking.trackingCode} className="rounded-lg border border-border/60 bg-background/60 p-3 text-sm">
                  <p className="font-medium">{tracking.shipmentMethodName}</p>
                  <p className="text-xs text-foreground/60">{tracking.trackingCode}</p>
                  <a href={tracking.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#00EC97] hover:underline">
                    View tracking
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AuditLogModal({ order, isOpen, onClose }: { order: Order; isOpen: boolean; onClose: () => void }) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl bg-background border border-border/60">
        <DialogHeader>
          <DialogTitle>Order History - {order.id.substring(0, 8)}...</DialogTitle>
          <DialogDescription>
            Complete audit log for this order
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <AuditLogViewer orderId={order.id} variant="admin" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrderStatusControl({
  order,
  isSaving,
  onSelectStatus,
}: {
  order: Order;
  isSaving: boolean;
  onSelectStatus: (order: Order, status: OrderStatus) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={order.status}
        onValueChange={(value) => onSelectStatus(order, value as OrderStatus)}
        disabled={isSaving}
      >
        <SelectTrigger
          className={cn(
            "h-9 min-w-[180px] rounded-full border-transparent px-3 font-semibold shadow-none transition-all hover:-translate-y-0.5 focus-visible:ring-0 focus-visible:ring-offset-0",
            getStatusColor(order.status),
            order.currentStatusNote && "ring-1 ring-[#00EC97]/45 ring-offset-1 ring-offset-background",
            isSaving && "opacity-70"
          )}
          aria-label={`Update order ${order.id} status`}
        >
          {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          <SelectValue>{getAdminStatusLabel(order.status)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="rounded-2xl border-border/60 bg-background/95">
          {ORDER_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {getAdminStatusLabel(status)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <OrderStatusNoteButton
        status={order.status}
        note={order.currentStatusNote}
        noteCreatedAt={order.currentStatusNoteCreatedAt}
        noteActor={order.currentStatusNoteActor}
      />
    </div>
  );
}

function DeleteConfirmationModal({ 
  orders, 
  isOpen, 
  onClose, 
  onConfirm 
}: { 
  orders: Order[]; 
  isOpen: boolean; 
  onClose: () => void; 
  onConfirm: () => void;
}) {
  const draftCount = orders.filter(o => o.status === 'draft_created' || o.status === 'pending').length;
  const nonDraftCount = orders.length - draftCount;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-2xl bg-background border border-border/60">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <DialogTitle>Confirm Delete</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            You are about to delete {orders.length} order{orders.length !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-3">
          {draftCount > 0 && (
            <div className="p-3 rounded-lg bg-background/60 border border-border/60">
              <p className="text-sm">
                <span className="font-medium">{draftCount}</span> draft order{draftCount !== 1 ? 's' : ''} will be permanently deleted.
              </p>
            </div>
          )}
          
          {nonDraftCount > 0 && (
            <div className="p-3 rounded-lg bg-background/60 border border-border/60">
              <p className="text-sm">
                <span className="font-medium">{nonDraftCount}</span> non-draft order{nonDraftCount !== 1 ? 's' : ''} will be soft-deleted and logged.
              </p>
            </div>
          )}
        </div>
        
        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground text-sm font-semibold hover:bg-background transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-destructive text-white text-sm font-semibold hover:bg-destructive/90 transition-colors"
          >
            Delete {orders.length} Order{orders.length !== 1 ? 's' : ''}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminOrdersPage() {
  const router = useRouter();
  const loaderData = Route.useLoaderData();
  const routeSearch = Route.useSearch();
  const updateOrderStatus = useUpdateOrderStatus();
  const [search, setSearch] = useState(routeSearch.orderId ?? routeSearch.search ?? "");
  const [filterManual, setFilterManual] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedOrdersForDelete, setSelectedOrdersForDelete] = useState<Order[]>([]);
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [auditLogOrder, setAuditLogOrder] = useState<Order | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [statusChangeDraft, setStatusChangeDraft] = useState<{ order: Order; status: OrderStatus } | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [savingStatusOrderId, setSavingStatusOrderId] = useState<string | null>(null);
  const autoOpenedFromLinkRef = useRef(false);

  if (!loaderData) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-2">Orders Management</h2>
            <p className="text-sm text-foreground/90 dark:text-muted-foreground">View and manage all customer orders</p>
          </div>
        </div>
        <div className="rounded-2xl bg-background border border-border/60 px-6 py-12">
          <div className="flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00EC97] mx-auto mb-2"></div>
              <p className="text-sm text-foreground/90 dark:text-muted-foreground">Loading orders...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { orders } = loaderData;

  const filteredOrders = useMemo(() => {
    let result = orders;
    if (filterManual) {
      result = result.filter((order) =>
        (order.items ?? []).some((item) => item.fulfillmentProvider === "manual"),
      );
    }
    if (!search) return result;
    const term = search.toLowerCase();
    return result.filter(
      (order) =>
        order.id.toLowerCase().includes(term) ||
        order.userId.toLowerCase().includes(term)
    );
  }, [orders, search, filterManual]);

  useEffect(() => {
    if (!routeSearch.orderId || autoOpenedFromLinkRef.current) {
      return;
    }

    const linkedOrder = filteredOrders.find((order) => order.id === routeSearch.orderId);
    if (linkedOrder) {
      setDetailsOrder(linkedOrder);
      setIsDetailsModalOpen(true);
      autoOpenedFromLinkRef.current = true;
    }
  }, [filteredOrders, routeSearch.orderId]);

  const selectedOrders = useMemo(() => {
    return filteredOrders.filter((order) => rowSelection[order.id]);
  }, [rowSelection, filteredOrders]);

  const handleDeleteClick = () => {
    if (selectedOrders.length === 0) return;
    setSelectedOrdersForDelete(selectedOrders);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    try {
      const orderIds = selectedOrdersForDelete.map(o => o.id);
      const result = await apiClient.deleteOrders({ orderIds });
      
      // Show success toast
      if (result.deleted > 0) {
        toast.success(`Successfully deleted ${result.deleted} order(s)`);
      }
      
      // Show warnings for any errors
      if (result.errors.length > 0) {
        result.errors.forEach(err => {
          toast.error(`Failed to delete order ${err.orderId.substring(0, 8)}...: ${err.error}`);
        });
      }
      
      // Clear selection and refresh
      setRowSelection({});
      setIsDeleteModalOpen(false);
      router.invalidate();
    } catch (error) {
      console.error('Failed to delete orders:', error);
      toast.error('Failed to delete orders. Please try again.');
    }
  };

  const handleViewAuditLog = (order: Order) => {
    setAuditLogOrder(order);
    setIsAuditModalOpen(true);
  };

  const handleViewDetails = (order: Order) => {
    setDetailsOrder(order);
    setIsDetailsModalOpen(true);
  };

  const getErrorMessage = (error: unknown) => {
    if (error && typeof error === "object") {
      const candidate = error as { message?: string; json?: { message?: string } };
      if (candidate.json?.message) return candidate.json.message;
      if (candidate.message) return candidate.message;
    }

    return "Please try again.";
  };

  const handleSelectStatus = (order: Order, status: OrderStatus) => {
    if (status === order.status || savingStatusOrderId === order.id) {
      return;
    }

    setStatusReason("");
    setStatusChangeDraft({ order, status });
  };

  const handleSaveStatus = async () => {
    if (!statusChangeDraft) {
      return;
    }

    const trimmedReason = statusReason.trim();
    const { order, status } = statusChangeDraft;

    setSavingStatusOrderId(order.id);

    try {
      await updateOrderStatus.mutateAsync({
        orderId: order.id,
        status,
        reason: trimmedReason || undefined,
      });
      toast.success(`Order marked ${getAdminStatusLabel(status).toLowerCase()}`);
      setStatusChangeDraft(null);
      setStatusReason("");
      router.invalidate();
    } catch (error) {
      toast.error("Failed to update order status", {
        description: getErrorMessage(error),
      });
      console.error("Failed to update order status:", error);
    } finally {
      setSavingStatusOrderId(null);
    }
  };

  const columns: ColumnDef<Order>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            className="rounded border-border/60"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            className="rounded border-border/60"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "id",
        header: "Order ID",
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.id.substring(0, 8)}...</span>
        ),
      },
      {
        accessorKey: "userId",
        header: "Customer",
        cell: ({ row }) => (
          <span className="text-sm text-[#717182] truncate max-w-[150px] block" title={row.original.userId}>
            {row.original.userId}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Date",
        cell: ({ row }) => (
          <span className="text-sm text-[#717182]">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
      },
      {
        accessorKey: "items",
        header: "Items",
        cell: ({ row }) => {
          const items = row.original.items;
          const totalQty = items.reduce((sum: number, item) => sum + item.quantity, 0);
          const productNames = items.map((item) => item.productName).join(", ");

          return (
            <div className="max-w-[200px]">
              <div className="text-sm font-medium">
                {totalQty} item{totalQty !== 1 ? "s" : ""}
              </div>
              <div className="text-xs text-[#717182] truncate" title={productNames}>
                {productNames}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <OrderStatusControl
            order={row.original}
            isSaving={savingStatusOrderId === row.original.id}
            onSelectStatus={handleSelectStatus}
          />
        ),
      },
      {
        accessorKey: "totalAmount",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-medium">
            ${row.original.totalAmount.toFixed(2)} {row.original.currency}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const order = row.original;
          const hasTracking = order.trackingInfo && order.trackingInfo.length > 0;
          const hasPaymentDetails = order.paymentDetails && Object.keys(order.paymentDetails).length > 0;

          return (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleViewDetails(order)}
                className="px-3 py-1.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
              >
                Details
              </button>
              {hasPaymentDetails && (
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
                    >
                      <CreditCard className="h-3 w-3 mr-1" />
                      Payment
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl bg-background border border-border/60">
                    <DialogHeader>
                      <DialogTitle>Payment Details</DialogTitle>
                    </DialogHeader>
                    <PaymentDetailsView paymentDetails={order.paymentDetails!} />
                  </DialogContent>
                </Dialog>
              )}
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
                onClick={() => handleViewAuditLog(order)}
                className="px-3 py-1.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
              >
                <History className="h-3 w-3 mr-1" />
                History
              </button>
            </div>
          );
        },
      },
    ],
    [savingStatusOrderId]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Orders Management</h2>
          <p className="text-sm text-foreground/90 dark:text-muted-foreground">View and manage all customer orders</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedOrders.length > 0 && (
            <button
              type="button"
              onClick={handleDeleteClick}
              className="px-4 py-2 rounded-lg bg-destructive/10 backdrop-blur-sm border border-destructive/30 text-destructive flex items-center justify-center text-sm font-semibold hover:bg-destructive hover:text-white transition-colors"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete ({selectedOrders.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => router.invalidate()}
            className="px-6 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </button>
        </div>
      </div>

<div className="rounded-2xl bg-background border border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-foreground/50 dark:text-muted-foreground" />
              <Input
                placeholder="Search by order ID or customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97] hover:border-border/60 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => setFilterManual(!filterManual)}
              className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                filterManual
                  ? "bg-[#10b981] border-[#10b981] text-white"
                  : "bg-background/60 border-border/60 text-foreground hover:border-[#10b981] hover:text-[#10b981]"
              }`}
            >
              Manual only
            </button>
          </div>
        </div>

      {filteredOrders.length === 0 ? (
        <div className="rounded-2xl bg-background border border-border/60 p-12 text-center">
          <ShoppingBag className="mx-auto h-12 w-12 text-foreground/50 dark:text-muted-foreground mb-4" />
          <p className="text-foreground/90 dark:text-muted-foreground font-medium">No orders found</p>
          <p className="text-sm text-foreground/70 dark:text-muted-foreground mt-1">
            {search ? "Try adjusting your search criteria" : "Orders will appear here once customers make purchases"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block rounded-2xl bg-background border border-border/60 overflow-hidden">
            <DataTable 
              columns={columns} 
              data={filteredOrders}
              getRowId={(order) => order.id}
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
            />
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-4">
            {filteredOrders.map((order) => {
              const hasTracking = order.trackingInfo && order.trackingInfo.length > 0;
              const hasPaymentDetails = order.paymentDetails && Object.keys(order.paymentDetails).length > 0;
              const items = order.items;
              const totalQty = items.reduce((sum: number, item) => sum + item.quantity, 0);
              const productNames = items.map((item) => item.productName).join(", ");

              return (
                <div key={order.id} className="rounded-2xl bg-background border border-border/60 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {order.id.substring(0, 8)}...
                        </span>
                        <OrderStatusControl
                          order={order}
                          isSaving={savingStatusOrderId === order.id}
                          onSelectStatus={handleSelectStatus}
                        />
                      </div>
                      <p className="text-xs text-foreground/70 dark:text-muted-foreground truncate mb-1" title={order.userId}>
                        {order.userId}
                      </p>
                      <p className="text-xs text-foreground/70 dark:text-muted-foreground">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-semibold text-foreground">
                        ${order.totalAmount.toFixed(2)} {order.currency}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-border/60">
                    <p className="text-sm font-medium text-foreground mb-1">
                      {totalQty} item{totalQty !== 1 ? "s" : ""}
                    </p>
                    <p className="text-xs text-foreground/70 dark:text-muted-foreground line-clamp-2" title={productNames}>
                      {productNames}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handleViewDetails(order)}
                      className="flex-1 px-3 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
                    >
                      Details
                    </button>
                    {hasPaymentDetails && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <button
                            type="button"
                            className="flex-1 px-3 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
                          >
                            <CreditCard className="h-3 w-3 mr-1" />
                            Payment
                          </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl bg-background border border-border/60">
                          <DialogHeader>
                            <DialogTitle>Payment Details</DialogTitle>
                          </DialogHeader>
                          <PaymentDetailsView paymentDetails={order.paymentDetails!} />
                        </DialogContent>
                      </Dialog>
                    )}
                    {hasTracking && (
                      <a
                        href={order.trackingInfo![0]!.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "flex-1 px-3 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors",
                          !hasPaymentDetails && "w-full"
                        )}
                      >
                        Track <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleViewAuditLog(order)}
                      className="flex-1 px-3 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center text-xs font-semibold hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
                    >
                      <History className="h-3 w-3 mr-1" />
                      History
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modals */}
      {selectedOrdersForDelete.length > 0 && (
        <DeleteConfirmationModal
          orders={selectedOrdersForDelete}
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {detailsOrder && (
        <OrderDetailsModal
          order={detailsOrder}
          isOpen={isDetailsModalOpen}
          onClose={() => {
            setIsDetailsModalOpen(false);
            setDetailsOrder(null);
            autoOpenedFromLinkRef.current = false;
          }}
        />
      )}

      {auditLogOrder && (
        <AuditLogModal
          order={auditLogOrder}
          isOpen={isAuditModalOpen}
          onClose={() => {
            setIsAuditModalOpen(false);
            setAuditLogOrder(null);
          }}
        />
      )}

      {statusChangeDraft && (
        <Dialog
          open={!!statusChangeDraft}
          onOpenChange={(open) => {
            if (!open && !updateOrderStatus.isPending) {
              setStatusChangeDraft(null);
              setStatusReason("");
            }
          }}
        >
          <DialogContent className="max-w-lg rounded-2xl border border-border/60 bg-background">
            <DialogHeader>
              <DialogTitle>Update Order Status</DialogTitle>
              <DialogDescription>
                Move order {statusChangeDraft.order.id.substring(0, 8)}... from {getStatusLabel(statusChangeDraft.order.status)} to {getAdminStatusLabel(statusChangeDraft.status)}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={getStatusColor(statusChangeDraft.order.status)}>
                  {getStatusLabel(statusChangeDraft.order.status)}
                </Badge>
                <span className="text-foreground/50">to</span>
                <Badge className={getStatusColor(statusChangeDraft.status)}>
                  {getAdminStatusLabel(statusChangeDraft.status)}
                </Badge>
              </div>

              <div className="space-y-2">
                <label htmlFor="status-note" className="text-sm font-medium text-foreground">
                  Add note
                </label>
                <textarea
                  id="status-note"
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder="Optional note for this status change"
                  rows={4}
                  className="flex min-h-[110px] w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/40 focus:border-[#00EC97]"
                />
                <p className="text-xs text-foreground/60">
                  This note is saved in the order history and can be viewed from the status chip.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <button
                type="button"
                onClick={() => {
                  setStatusChangeDraft(null);
                  setStatusReason("");
                }}
                disabled={updateOrderStatus.isPending}
                className="px-4 py-2 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground text-sm font-semibold hover:bg-background transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveStatus}
                disabled={updateOrderStatus.isPending}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#00EC97] text-black text-sm font-semibold hover:bg-[#00EC97]/90 transition-colors disabled:opacity-50"
              >
                {updateOrderStatus.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {statusReason.trim() ? "Save Status and Note" : "Save Status"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
