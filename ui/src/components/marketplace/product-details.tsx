import type { ProviderDetails } from "@/integrations/api";
import { cn } from "@/lib/utils";
import {
  formatProviderDetails,
  isProviderWithDetails,
} from "../../../../api/src/services/fulfillment/fields";

interface ProductDetailsProps {
  provider: string;
  providerDetails: ProviderDetails | undefined;
  className?: string;
}

export function ProductDetails({
  provider,
  providerDetails,
  className,
}: ProductDetailsProps) {
  if (!isProviderWithDetails(provider)) return null;

  const rows = formatProviderDetails(provider, providerDetails);
  if (rows.length === 0) return null;

  return (
    <div className={cn("rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8", className)}>
      <h3 className="text-sm font-semibold tracking-[-0.48px] text-foreground/90 dark:text-muted-foreground uppercase mb-4">
        Product Details
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1">
            <p className="text-xs text-foreground/60 dark:text-muted-foreground/60 uppercase tracking-wider">
              {row.label}
            </p>
            <p className="text-sm font-medium text-foreground/90 dark:text-foreground/80">
              {row.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
