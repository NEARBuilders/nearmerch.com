import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type OrderItemsCellItem = {
  productId: string;
  productName: string;
  quantity: number;
};

interface OrderItemsCellProps {
  items: OrderItemsCellItem[];
  className?: string;
  /** Use denser styles for mobile cards. */
  compact?: boolean;
}

function ProductLink({
  productId,
  productName,
  className,
}: {
  productId: string;
  productName: string;
  className?: string;
}) {
  return (
    <Link
      to="/products/$productId"
      params={{ productId }}
      className={cn(
        "cursor-pointer text-[#00EC97] hover:underline underline-offset-2 truncate",
        className,
      )}
      title={productName}
      onClick={(event) => event.stopPropagation()}
    >
      {productName}
    </Link>
  );
}

export function OrderItemsCell({
  items,
  className,
  compact = false,
}: OrderItemsCellProps) {
  const safeItems = items ?? [];
  const totalQty = safeItems.reduce((sum, item) => sum + item.quantity, 0);
  const countLabel = `${totalQty} item${totalQty !== 1 ? "s" : ""}`;

  if (safeItems.length === 0) {
    return (
      <div className={cn("max-w-[220px]", className)}>
        <div
          className={cn(
            "text-foreground",
            compact ? "text-xs font-medium" : "text-sm font-semibold mb-0.5",
          )}
        >
          0 items
        </div>
      </div>
    );
  }

  if (safeItems.length === 1) {
    const item = safeItems[0]!;
    return (
      <div className={cn("max-w-[220px] min-w-0", className)}>
        <div
          className={cn(
            "text-foreground",
            compact ? "text-xs font-medium mb-0.5" : "text-sm font-semibold mb-0.5",
          )}
        >
          {countLabel}
        </div>
        <ProductLink
          productId={item.productId}
          productName={item.productName}
          className={cn("block text-xs", compact && "font-medium")}
        />
      </div>
    );
  }

  return (
    <div className={cn("max-w-[220px] min-w-0", className)}>
      <div
        className={cn(
          "text-foreground",
          compact ? "text-xs font-medium mb-0.5" : "text-sm font-semibold mb-0.5",
        )}
      >
        {countLabel}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 max-w-full rounded-md text-left transition-colors hover:text-[#00EC97]",
              compact
                ? "text-xs font-medium text-foreground"
                : "text-xs text-foreground/70 dark:text-muted-foreground",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="truncate">
              {safeItems.map((item) => item.productName).join(", ")}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 p-2 rounded-xl border-border/60 bg-background"
          onClick={(event) => event.stopPropagation()}
        >
          <ul className="space-y-1">
            {safeItems.map((item) => (
              <li key={`${item.productId}-${item.productName}`}>
                <Link
                  to="/products/$productId"
                  params={{ productId: item.productId }}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-background/80 hover:text-[#00EC97] transition-colors"
                >
                  <span className="truncate font-medium">{item.productName}</span>
                  <span className="shrink-0 text-xs text-foreground/60">
                    ×{item.quantity}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
