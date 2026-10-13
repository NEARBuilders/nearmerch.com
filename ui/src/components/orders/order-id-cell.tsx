import { useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface OrderIdCellProps {
  orderId: string;
  className?: string;
  /** Visual truncation length; full ID is always copied. */
  truncateLength?: number;
  textClassName?: string;
}

export function OrderIdCell({
  orderId,
  className,
  truncateLength = 8,
  textClassName,
}: OrderIdCellProps) {
  const [copied, setCopied] = useState(false);
  const truncated =
    orderId.length > truncateLength
      ? `${orderId.substring(0, truncateLength)}...`
      : orderId;

  const handleCopy = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(orderId);
      setCopied(true);
      toast.success("Order ID copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy Order ID");
    }
  };

  return (
    <div className={cn("flex items-center gap-1 min-w-0", className)}>
      <span
        className={cn(
          "font-mono text-sm font-medium text-foreground truncate",
          textClassName,
        )}
        title={orderId}
      >
        {truncated}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        className={cn(
          "h-7 w-7 shrink-0 cursor-pointer text-foreground/50 dark:text-muted-foreground hover:text-[#00EC97] dark:hover:text-[#00EC97] transition-colors",
          copied && "text-[#00EC97]",
        )}
        title={copied ? "Copied!" : "Copy full Order ID"}
        aria-label={copied ? "Order ID copied" : "Copy full Order ID"}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}
