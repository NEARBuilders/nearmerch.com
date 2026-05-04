import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Fragment, useState, useEffect, useMemo } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import {
  Package,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Eye,
  EyeOff,
  RefreshCw,
  Star,
  X,
  Plus,
  ChevronDown,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Lock,
} from "lucide-react";
import { ProductTitleCell } from "@/components/admin/product-title-cell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  useProducts,
  useCategories,
  useProductTypes,
  useUpdateProductCategories,
  useUpdateProductListing,
  useUpdateProductTags,
  useUpdateProductFeatured,
  useUpdateProductType,
  useCreateProductType,
  useUpdateProductTypeItem,
  useUpdateProductMetadata,
  type Product,
  type FeeConfig,
  type ProductMetadata,
} from "@/integrations/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_marketplace/_authenticated/_admin/dashboard/inventory",
)({
  component: InventoryManagement,
});

function TagsEditor({
  tags,
  onUpdate,
  isPending,
}: {
  tags: string[];
  onUpdate: (tags: string[]) => void;
  isPending: boolean;
}) {
  const [newTag, setNewTag] = useState("");

  const handleAddTag = () => {
    const trimmed = newTag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onUpdate([...tags, trimmed]);
      setNewTag("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdate(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Add tag..."
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-9 text-sm bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]"
        />
        <Button
          type="button"
          size="sm"
          onClick={handleAddTag}
          disabled={!newTag.trim() || isPending}
          className="h-9 px-3 bg-[#00EC97] text-black hover:bg-[#00d97f]"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <div className="flex min-h-10 flex-wrap gap-1.5 rounded-lg border border-border/60 bg-background/40 p-3">
        {tags.length === 0 ? (
          <span className="text-xs text-foreground/60 dark:text-muted-foreground">
            No tags yet. Type above and press Enter to add.
          </span>
        ) : (
          tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="flex items-center gap-1 pr-1 font-normal text-xs"
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                disabled={isPending}
                className="ml-1 transition-colors hover:text-red-500 disabled:opacity-50"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

function reorderList<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const nextItems = [...items];
  const movedItems = nextItems.splice(fromIndex, 1);

  if (movedItems.length === 0) {
    return items;
  }

  nextItems.splice(toIndex, 0, movedItems[0]!);
  return nextItems;
}

function ProductTypeEditor({
  currentType,
  availableTypes,
  onUpdate,
  isPending,
}: {
  currentType: string | null;
  availableTypes: Array<{ slug: string; label: string }>;
  onUpdate: (slug: string | null) => void;
  isPending: boolean;
}) {
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [orderedTypes, setOrderedTypes] = useState(availableTypes);
  const [isReordering, setIsReordering] = useState(false);

  const createMutation = useCreateProductType();
  const updateProductTypeItemMutation = useUpdateProductTypeItem();

  useEffect(() => {
    if (!isReordering) {
      setOrderedTypes(availableTypes);
    }
  }, [availableTypes, isReordering]);

  const generateSlug = (label: string): string => {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const handleCreateType = () => {
    const trimmed = newTypeLabel.trim();
    if (!trimmed) return;

    const slug = generateSlug(trimmed);
    setIsCreating(true);

    createMutation.mutate(
      { slug, label: trimmed, displayOrder: orderedTypes.length },
      {
        onSuccess: () => {
          onUpdate(slug);
          setNewTypeLabel("");
          setIsCreating(false);
        },
        onError: () => {
          setIsCreating(false);
        },
      },
    );
  };

  const persistOrder = async (
    previousTypes: Array<{ slug: string; label: string }>,
    nextTypes: Array<{ slug: string; label: string }>,
  ) => {
    setIsReordering(true);

    try {
      for (const [index, productType] of nextTypes.entries()) {
        await updateProductTypeItemMutation.mutateAsync({
          slug: productType.slug,
          displayOrder: index,
        });
      }
    } catch {
      setOrderedTypes(previousTypes);
    } finally {
      setIsReordering(false);
    }
  };

  const moveType = (fromIndex: number, toIndex: number) => {
    if (isReordering) {
      return;
    }

    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= orderedTypes.length ||
      toIndex >= orderedTypes.length
    ) {
      return;
    }

    const previousTypes = orderedTypes;
    const nextTypes = reorderList(previousTypes, fromIndex, toIndex);

    setOrderedTypes(nextTypes);
    void persistOrder(previousTypes, nextTypes);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateType();
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-48 overflow-auto pr-1">
        <p className="text-xs text-foreground/50">
          Drag product types to control how they appear in marketplace filters.
        </p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={!currentType}
            onCheckedChange={(next) => {
              if (next) onUpdate(null);
            }}
            disabled={isPending || isCreating || createMutation.isPending || isReordering}
          />
          <span className="text-foreground/60 dark:text-muted-foreground">
            None
          </span>
        </label>
        <DragDropProvider
          onDragEnd={(event) => {
            if (event.canceled) {
              return;
            }

            const { source } = event.operation;

            if (!isSortable(source)) {
              return;
            }

            if (source.initialIndex === source.index) {
              return;
            }

            moveType(source.initialIndex, source.index);
          }}
        >
          <div className="space-y-2">
            {orderedTypes.map((pt, index) => (
              <SortableProductTypeOption
                key={pt.slug}
                productType={pt}
                index={index}
                checked={currentType === pt.slug}
                disabled={
                  isPending ||
                  isCreating ||
                  createMutation.isPending ||
                  isReordering
                }
                onSelect={() => onUpdate(pt.slug)}
                onMoveUp={() => moveType(index, index - 1)}
                onMoveDown={() => moveType(index, index + 1)}
                canMoveUp={index > 0}
                canMoveDown={index < orderedTypes.length - 1}
              />
            ))}
          </div>
          <DragOverlay
            dropAnimation={{ duration: 180, easing: "ease-out" }}
            className="w-full"
          >
            {(source) => {
              const activeType = orderedTypes.find(
                (productType) => productType.slug === String(source.id),
              );

              if (!activeType) {
                return null;
              }

              return <ProductTypeOverlay label={activeType.label} />;
            }}
          </DragOverlay>
        </DragDropProvider>
      </div>
      <div className="border-t border-border/60 pt-3">
        <div className="flex gap-2">
          <Input
            placeholder="New type..."
            value={newTypeLabel}
            onChange={(e) => setNewTypeLabel(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-9 text-sm bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]"
            disabled={
              isCreating ||
              createMutation.isPending ||
              isPending ||
              isReordering
            }
          />
          <Button
            type="button"
            size="sm"
            onClick={handleCreateType}
            disabled={
              !newTypeLabel.trim() ||
              isCreating ||
              createMutation.isPending ||
              isPending ||
              isReordering
            }
            className="h-9 px-3 bg-[#00EC97] text-black hover:bg-[#00d97f]"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SortableProductTypeOption({
  productType,
  index,
  checked,
  disabled,
  onSelect,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  productType: { slug: string; label: string };
  index: number;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: productType.slug,
    index,
    disabled,
  });

  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2 py-2 transition-colors",
        isDragging && "opacity-50",
        isDropTarget && !isDragging && "border-[#00EC97]/60 bg-[#00EC97]/5",
      )}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={`Drag to reorder ${productType.label}`}
        disabled={disabled}
        className="rounded-md p-1 text-foreground/40 transition-colors hover:bg-background/60 hover:text-foreground/70 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripVertical className="size-4" />
      </button>
      <label
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 text-sm",
          !disabled && "cursor-pointer",
        )}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={(next) => {
            if (next) {
              onSelect();
            }
          }}
          disabled={disabled}
        />
        <span className="truncate">{productType.label}</span>
      </label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={disabled || !canMoveUp}
          aria-label={`Move ${productType.label} up`}
          className="rounded-md p-1 text-foreground/50 transition-colors hover:bg-background/60 hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={disabled || !canMoveDown}
          aria-label={`Move ${productType.label} down`}
          className="rounded-md p-1 text-foreground/50 transition-colors hover:bg-background/60 hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowDown className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function ProductTypeOverlay({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#00EC97]/40 bg-background px-3 py-2 shadow-lg">
      <GripVertical className="size-4 text-[#00EC97]" />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </div>
  );
}

function MetadataEditor({
  metadata,
  onUpdate,
  isPending,
}: {
  metadata?: ProductMetadata;
  onUpdate: (metadata: ProductMetadata) => void;
  isPending: boolean;
}) {
  const [localMetadata, setLocalMetadata] = useState<ProductMetadata>(
    metadata || { fees: [] },
  );
  const [newFee, setNewFee] = useState<Partial<FeeConfig> & { percentage?: string }>({
    type: "royalty",
    label: "",
    recipient: "",
    bps: 0,
    percentage: "",
  });

  useEffect(() => {
    setLocalMetadata(metadata || { fees: [] });
  }, [metadata]);

  const handleAddFee = () => {
    if (!newFee.label || !newFee.recipient || !newFee.percentage) return;
    const percentage = parseFloat(newFee.percentage);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) return;
    const bps = Math.round(percentage * 100);
    const fee: FeeConfig = {
      type: newFee.type as FeeConfig["type"],
      label: newFee.label,
      recipient: newFee.recipient,
      bps,
    };
    const updated = { ...localMetadata, fees: [...localMetadata.fees, fee] };
    setLocalMetadata(updated);
    setNewFee({ type: "royalty", label: "", recipient: "", bps: 0, percentage: "" });
  };

  const handleRemoveFee = (index: number) => {
    const updated = {
      ...localMetadata,
      fees: localMetadata.fees.filter((_: FeeConfig, i: number) => i !== index),
    };
    setLocalMetadata(updated);
  };

  const handleSave = () => {
    onUpdate(localMetadata);
  };

  const totalBps = localMetadata.fees.reduce(
    (sum: number, f: FeeConfig) => sum + f.bps,
    0,
  );
  const totalPercentage = totalBps / 100;
  const referralConfig = localMetadata.affiliate?.referral;
  const referralFeeBps = referralConfig?.feeBps ?? 2000;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Creator Account ID</Label>
          <Input
            placeholder="creator.near"
            value={localMetadata.creatorAccountId || ""}
            onChange={(e) =>
              setLocalMetadata({
                ...localMetadata,
                creatorAccountId: e.target.value || undefined,
              })
            }
            className="h-9 text-sm bg-background/60 border border-border/60 rounded-lg"
          />
        </div>

        <div className="space-y-2">
          <Label>Purchase Gate</Label>
          <Select
            value={localMetadata.purchaseGate?.pluginId ?? "none"}
            onValueChange={(value) =>
              setLocalMetadata((current) => ({
                ...current,
                purchaseGate:
                  value === "none"
                    ? undefined
                    : { pluginId: value as "legion-holder" },
              }))
            }
          >
            <SelectTrigger className="h-9 text-sm bg-background/60 border border-border/60 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="legion-holder">Legion Holder</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-foreground/50">
            Gated products stay visible but require the selected plugin to purchase.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Fee Splits</Label>
            <p className="text-xs text-foreground/50">
              Total: {totalPercentage}% ({totalBps} bps)
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {localMetadata.fees.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-xs text-foreground/60 dark:text-muted-foreground">
              No fee splits configured yet.
            </div>
          ) : (
            localMetadata.fees.map((fee: FeeConfig, index: number) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs"
              >
                <span className="flex-1 truncate">{fee.label}</span>
                <span className="text-foreground/60">{fee.recipient}</span>
                <span className="text-foreground/60">{fee.bps / 100}%</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFee(index)}
                  disabled={isPending}
                  className="transition-colors hover:text-red-500 disabled:opacity-50"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
          <Select
            value={newFee.type}
            onValueChange={(v) =>
              setNewFee({ ...newFee, type: v as FeeConfig["type"] })
            }
          >
            <SelectTrigger className="h-9 text-xs bg-background/60 border border-border/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="royalty">Royalty</SelectItem>
              <SelectItem value="affiliate">Affiliate</SelectItem>
              <SelectItem value="platform">Platform</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Label"
            value={newFee.label || ""}
            onChange={(e) => setNewFee({ ...newFee, label: e.target.value })}
            className="h-9 text-sm bg-background/60 border border-border/60 rounded-lg"
          />
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_96px_auto]">
          <Input
            placeholder="recipient.near"
            value={newFee.recipient || ""}
            onChange={(e) => setNewFee({ ...newFee, recipient: e.target.value })}
            className="h-9 text-sm bg-background/60 border border-border/60 rounded-lg"
          />
          <Input
            type="number"
            placeholder="%"
            min="0"
            max="100"
            step="0.01"
            value={newFee.percentage || ""}
            onChange={(e) => setNewFee({ ...newFee, percentage: e.target.value })}
            className="h-9 text-sm bg-background/60 border border-border/60 rounded-lg"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAddFee}
            disabled={
              !newFee.label || !newFee.recipient || !newFee.percentage || isPending
            }
            className="h-9 px-3 bg-[#00EC97] text-black hover:bg-[#00d97f]"
          >
            <Plus className="mr-1 size-4" />
            Add Fee
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
        <div className="space-y-1">
          <Label>Referral Fees</Label>
          <p className="text-xs text-foreground/50">
            When enabled, PingPay appends an affiliate fee for the shared `ref`
            account without changing the listed product price.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={referralConfig?.enabled === true}
            onCheckedChange={(checked) => {
              setLocalMetadata((current) => ({
                ...current,
                affiliate: checked
                  ? {
                      ...current.affiliate,
                      referral: {
                        enabled: true,
                        feeBps: current.affiliate?.referral?.feeBps ?? 2000,
                      },
                    }
                  : undefined,
              }));
            }}
            disabled={isPending}
          />
          <span className="text-foreground/80 dark:text-muted-foreground">
            Enable referral sharing for this product
          </span>
        </label>

        {referralConfig?.enabled && (
          <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label>Referral %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={String(referralFeeBps / 100)}
                onChange={(e) => {
                  const nextPercentage = Number.parseFloat(e.target.value);

                  setLocalMetadata((current) => ({
                    ...current,
                    affiliate: {
                      ...current.affiliate,
                      referral: {
                        enabled: true,
                        feeBps: Number.isFinite(nextPercentage)
                          ? Math.min(Math.max(Math.round(nextPercentage * 100), 0), 10000)
                          : 0,
                      },
                    },
                  }));
                }}
                className="h-9 text-sm bg-background/60 border border-border/60 rounded-lg"
              />
            </div>
            <div className="space-y-2">
              <Label>Behavior</Label>
              <div className="flex h-9 items-center rounded-lg border border-border/60 bg-background/60 px-3 text-xs text-foreground/60">
                Shared links use the visitor's `ref` param as the affiliate recipient.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-border/60 pt-3">
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isPending}
          className="h-9 bg-[#00EC97] text-black hover:bg-[#00d97f]"
        >
          Save Metadata
        </Button>
      </div>
    </div>
  );
}

function MetadataSummary({ metadata }: { metadata?: ProductMetadata }) {
  const resolvedMetadata = metadata ?? { fees: [] };
  const totalBps = resolvedMetadata.fees.reduce(
    (sum: number, fee: FeeConfig) => sum + fee.bps,
    0,
  );
  const totalPercentage = totalBps / 100;
  const hasDownloads = (resolvedMetadata.downloads?.length ?? 0) > 0;

  if (
    resolvedMetadata.fees.length === 0 &&
    !resolvedMetadata.creatorAccountId &&
    !resolvedMetadata.purchaseGate?.pluginId &&
    !resolvedMetadata.affiliate?.referral?.enabled &&
    !hasDownloads
  ) {
    return (
      <span className="text-xs text-foreground/60 dark:text-muted-foreground">
        No metadata
      </span>
    );
  }

  return (
    <div className="flex max-w-48 flex-wrap items-center gap-1.5">
      {resolvedMetadata.creatorAccountId && (
        <Badge variant="outline" className="max-w-40 truncate font-normal text-xs">
          {resolvedMetadata.creatorAccountId}
        </Badge>
      )}
      {resolvedMetadata.fees.length > 0 && (
        <span className="text-xs text-foreground/60">{totalPercentage}%</span>
      )}
      {resolvedMetadata.purchaseGate?.pluginId && (
        <Badge variant="outline" className="font-normal text-xs">
          {resolvedMetadata.purchaseGate.pluginId}
        </Badge>
      )}
      {resolvedMetadata.affiliate?.referral?.enabled && (
        <Badge variant="outline" className="font-normal text-xs">
          Ref {(resolvedMetadata.affiliate.referral.feeBps ?? 0) / 100}%
        </Badge>
      )}
      {hasDownloads && (
        <Badge variant="outline" className="font-normal text-xs">
          Download
        </Badge>
      )}
    </div>
  );
}

function ExpandedProductPanel({
  product,
  categories,
  productTypes,
  onUpdateCollections,
  onUpdateType,
  onUpdateTags,
  onUpdateMetadata,
  isUpdatingCollections,
  isUpdatingType,
  isUpdatingTags,
  isUpdatingMetadata,
}: {
  product: Product;
  categories: Array<{ slug: string; name: string }>;
  productTypes: Array<{ slug: string; label: string }>;
  onUpdateCollections: (categoryIds: string[]) => void;
  onUpdateType: (slug: string | null) => void;
  onUpdateTags: (tags: string[]) => void;
  onUpdateMetadata: (metadata: ProductMetadata) => void;
  isUpdatingCollections: boolean;
  isUpdatingType: boolean;
  isUpdatingTags: boolean;
  isUpdatingMetadata: boolean;
}) {
  const selectedCollections = product.collections ?? [];
  const selectedSlugs = selectedCollections.map((collection) => collection.slug);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-medium">Collections</h4>
              <p className="text-xs text-foreground/60 dark:text-muted-foreground">
                Assign this product to one or more collections.
              </p>
            </div>
          </div>
          <div className="space-y-2 max-h-56 overflow-auto pr-1">
            {categories.length === 0 ? (
              <div className="text-xs text-foreground/60 dark:text-muted-foreground">
                No collections yet. Create some in Dashboard -&gt; Collections.
              </div>
            ) : (
              categories.map((category) => {
                const checked = selectedSlugs.includes(category.slug);

                return (
                  <label
                    key={category.slug}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => {
                        const nextChecked = Boolean(next);
                        const nextSlugs = nextChecked
                          ? Array.from(new Set([...selectedSlugs, category.slug]))
                          : selectedSlugs.filter((slug) => slug !== category.slug);

                        onUpdateCollections(nextSlugs);
                      }}
                      disabled={isUpdatingCollections}
                    />
                    <span className="truncate">{category.name}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
          <div className="mb-3">
            <h4 className="text-sm font-medium">Product Type</h4>
            <p className="text-xs text-foreground/60 dark:text-muted-foreground">
              Pick an existing type or create a new one.
            </p>
          </div>
          <ProductTypeEditor
            currentType={product.productType?.slug ?? null}
            availableTypes={productTypes}
            onUpdate={onUpdateType}
            isPending={isUpdatingType}
          />
        </div>

        <div className="rounded-xl border border-border/60 bg-background/40 p-4 md:col-span-2">
          <div className="mb-3">
            <h4 className="text-sm font-medium">Tags</h4>
            <p className="text-xs text-foreground/60 dark:text-muted-foreground">
              Tags help organize and surface products across the admin tools.
            </p>
          </div>
          <TagsEditor
            tags={product.tags ?? []}
            onUpdate={onUpdateTags}
            isPending={isUpdatingTags}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-background/40 p-4">
        <div className="mb-3">
          <h4 className="text-sm font-medium">Metadata</h4>
          <p className="text-xs text-foreground/60 dark:text-muted-foreground">
            Manage creator attribution, purchase gates, and fee splits without the popover.
          </p>
        </div>
        <MetadataEditor
          metadata={product.metadata as ProductMetadata | undefined}
          onUpdate={onUpdateMetadata}
          isPending={isUpdatingMetadata}
        />
      </div>
    </div>
  );
}

function getMinFulfillmentCost(product: Product): number | null {
  const costs = (product.variants ?? [])
    .map((v) => v.fulfillmentCost)
    .filter((c): c is number => typeof c === "number" && c > 0);
  return costs.length > 0 ? Math.min(...costs) : null;
}

// Helper functions for time and date formatting
function InventoryManagement() {
  const {
    data: productsData,
    isLoading,
    refetch,
    isRefetching,
  } = useProducts({
    limit: 500,
    includeUnlisted: true,
  });
  const products = productsData?.products || [];

  const updateListingMutation = useUpdateProductListing();
  const updateCategoriesMutation = useUpdateProductCategories();
  const updateTagsMutation = useUpdateProductTags();
  const updateFeaturedMutation = useUpdateProductFeatured();
  const updateProductTypeMutation = useUpdateProductType();
  const updateMetadataMutation = useUpdateProductMetadata();
  const { data: categoriesData } = useCategories();
  const categories = categoriesData?.categories ?? [];
  const { data: productTypesData } = useProductTypes();
  const productTypes = productTypesData?.productTypes ?? [];

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  const tableData = useMemo(() => {
    if (sorting.length > 0) {
      return products;
    }

    return [...products].sort((a, b) => {
      const aTime = a.lastSyncedAt ?? a.createdAt;
      const bTime = b.lastSyncedAt ?? b.createdAt;
      const aParsed = aTime ? new Date(aTime).getTime() : 0;
      const bParsed = bTime ? new Date(bTime).getTime() : 0;
      const recencyDiff = bParsed - aParsed;
      if (recencyDiff !== 0) return recencyDiff;
      return a.title.localeCompare(b.title);
    });
  }, [products, sorting.length]);

  const handleToggleListing = (productId: string, currentlyListed: boolean) => {
    updateListingMutation.mutate({ id: productId, listed: !currentlyListed });
  };

  const columns: ColumnDef<Product>[] = [
    {
      id: "expander",
      header: "",
      cell: ({ row }) => {
        const isExpanded = expandedProductId === row.original.id;

        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() =>
              setExpandedProductId((current) =>
                current === row.original.id ? null : row.original.id,
              )
            }
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        );
      },
      enableSorting: false,
      size: 48,
    },
    {
      accessorKey: "thumbnailImage",
      header: "",
      cell: ({ row }) => (
        <Link
          to="/products/$productId"
          params={{ productId: row.original.slug }}
          className="block"
        >
          <div className="size-12 bg-muted border border-border/60 overflow-hidden rounded-lg group-hover:border-[#00EC97] group-hover:opacity-80 transition-all cursor-pointer">
            {row.original.thumbnailImage ? (
              <img
                src={row.original.thumbnailImage}
                alt={row.original.title}
                className="size-full object-cover"
              />
            ) : (
              <div className="size-full flex items-center justify-center">
                <Package className="size-4 text-foreground/50 dark:text-muted-foreground" />
              </div>
            )}
          </div>
        </Link>
      ),
      enableSorting: false,
      size: 48,
    },
    {
      accessorKey: "title",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-auto p-0 font-medium hover:bg-transparent"
        >
          Product
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => {
          return (
            <div className="space-y-1.5">
              <ProductTitleCell product={row.original} />
            </div>
          );
        },
        size: 200,
      },
    {
      id: "listed",
      accessorKey: "listed",
      header: "Status",
      cell: ({ row }) => {
        const isListed = row.original.listed !== false;
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleToggleListing(row.original.id, isListed)}
              disabled={updateListingMutation.isPending}
              className={cn(
                "h-8 px-2",
                isListed
                  ? "text-[#00EC97] hover:text-[#00EC97] hover:bg-[#00EC97]/10"
                  : "text-foreground/50 dark:text-muted-foreground hover:text-foreground/70 dark:hover:text-muted-foreground hover:bg-background/40",
              )}
              title={
                isListed
                  ? "Listed - Click to delist"
                  : "Delisted - Click to list"
              }
            >
              {isListed ? (
                <Eye className="size-4" />
              ) : (
                <EyeOff className="size-4" />
              )}
            </Button>
            <span className="text-xs text-foreground/70 dark:text-muted-foreground">
              {isListed ? "Listed" : "Delisted"}
            </span>
          </div>
        );
      },
      size: 100,
    },
    {
      accessorKey: "featured",
      header: "Featured",
      cell: ({ row }) => {
        const isFeatured = row.original.featured === true;
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              updateFeaturedMutation.mutate({
                id: row.original.id,
                featured: !isFeatured,
              })
            }
            disabled={updateFeaturedMutation.isPending}
            className={cn(
              "h-8 px-2",
              isFeatured
                ? "text-[#00EC97] hover:text-[#00EC97] hover:bg-[#00EC97]/10"
                : "text-foreground/50 dark:text-muted-foreground hover:text-foreground/70 dark:hover:text-muted-foreground hover:bg-background/40",
            )}
            title={
              isFeatured
                ? "Featured - Click to unfeature"
                : "Not featured - Click to feature"
            }
          >
            <Star className={cn("size-4", isFeatured && "fill-[#00EC97]")} />
          </Button>
        );
      },
      size: 80,
    },
    {
      accessorKey: "price",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-auto p-0 font-medium hover:bg-transparent"
        >
          Price
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-foreground/90 dark:text-muted-foreground inline-flex items-center gap-1">
          ${row.original.price.toFixed(2)} {row.original.currency}
          {row.original.priceLocked && (
            <span title="Price locked"><Lock className="size-3 text-[#00EC97]" /></span>
          )}
        </span>
      ),
      size: 110,
    },
    {
      id: "cost",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-auto p-0 font-medium hover:bg-transparent"
        >
          Cost
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      accessorFn: (row) => getMinFulfillmentCost(row) ?? -1,
      cell: ({ row }) => {
        const cost = getMinFulfillmentCost(row.original);
        if (cost === null) {
          return <span className="text-sm text-foreground/40">—</span>;
        }
        return (
          <span className="text-sm text-foreground/70 dark:text-muted-foreground">
            ${cost.toFixed(2)}
          </span>
        );
      },
      size: 80,
    },
    {
      id: "margin",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-auto p-0 font-medium hover:bg-transparent"
        >
          Margin
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      accessorFn: (row) => {
        const cost = getMinFulfillmentCost(row);
        return cost !== null ? row.price - cost : -Infinity;
      },
      cell: ({ row }) => {
        const cost = getMinFulfillmentCost(row.original);
        if (cost === null) {
          return <span className="text-sm text-foreground/40">—</span>;
        }
        const margin = row.original.price - cost;
        return (
          <span className={cn(
            "text-sm font-medium",
            margin > 0 && "text-[#00EC97]",
            margin <= 0 && "text-red-500",
          )}>
            ${margin.toFixed(2)}
          </span>
        );
      },
      size: 90,
    },
    {
      accessorKey: "collections",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-auto p-0 font-medium hover:bg-transparent"
        >
          Collections
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const selected = row.original.collections ?? [];

        return (
          <div className="flex max-w-48 flex-wrap items-center gap-1.5">
            {selected.length === 0 ? (
              <span className="text-xs text-foreground/60 dark:text-muted-foreground">
                No collections
              </span>
            ) : (
              selected.slice(0, 2).map((collection) => (
                <Badge
                  key={collection.slug}
                  variant="outline"
                  className="font-normal text-xs"
                >
                  {collection.name}
                </Badge>
              ))
            )}
            {selected.length > 2 && (
              <Badge variant="outline" className="font-normal text-xs">
                +{selected.length - 2}
              </Badge>
            )}
          </div>
        );
      },
      size: 220,
    },
    {
      accessorKey: "productType",
      header: "Type",
      cell: ({ row }) => {
        const currentType = row.original.productType;

        if (!currentType) {
          return (
            <span className="text-xs text-foreground/60 dark:text-muted-foreground">
              No type
            </span>
          );
        }

        return (
          <Badge variant="outline" className="font-normal text-xs">
            {currentType.label}
          </Badge>
        );
      },
      size: 140,
    },
    {
      accessorKey: "tags",
      header: "Tags",
      cell: ({ row }) => {
        const tags = row.original.tags ?? [];

        return (
          <div className="flex max-w-48 flex-wrap items-center gap-1.5">
            {tags.length === 0 ? (
              <span className="text-xs text-foreground/60 dark:text-muted-foreground">
                No tags
              </span>
            ) : (
              tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="outline" className="font-normal text-xs">
                  {tag}
                </Badge>
              ))
            )}
            {tags.length > 2 && (
              <Badge variant="outline" className="font-normal text-xs">
                +{tags.length - 2}
              </Badge>
            )}
          </div>
        );
      },
      size: 180,
    },
    {
      accessorKey: "metadata",
      header: "Metadata",
      cell: ({ row }) => (
        <MetadataSummary
          metadata={row.original.metadata as ProductMetadata | undefined}
        />
      ),
      size: 140,
    },
    {
      accessorKey: "variants",
      header: "Variants",
      cell: ({ row }) => (
        <span className="text-sm text-foreground/70 dark:text-muted-foreground">
          {row.original.variants?.length || 0}
        </span>
      ),
      size: 80,
      meta: {
        hideOnMobile: true,
      },
    },
    {
      accessorKey: "fulfillmentProvider",
      header: "Provider",
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className={cn(
            "font-normal capitalize",
            row.original.fulfillmentProvider === "printful" && "bg-[#3d7fff]/10 text-[#3d7fff] border-[#3d7fff]",
            row.original.fulfillmentProvider === "gelato" && "bg-[#635bff]/10 text-[#635bff] border-[#635bff]",
            row.original.fulfillmentProvider === "lulu" && "bg-orange-500/10 text-orange-500 border-orange-500"
          )}
        >
          {row.original.fulfillmentProvider}
        </Badge>
      ),
      size: 100,
      meta: {
        hideOnMobile: true,
      },
    },
  ];

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  });

  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const currentPageStart =
    filteredRowCount === 0
      ? 0
      : table.getState().pagination.pageIndex *
          table.getState().pagination.pageSize +
        1;
  const currentPageEnd = Math.min(
    (table.getState().pagination.pageIndex + 1) *
      table.getState().pagination.pageSize,
    filteredRowCount,
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-bold tracking-tight mb-2">
              Inventory Management
            </h2>
            <p className="text-sm text-foreground/90 dark:text-muted-foreground">
              Manage your product inventory and listings
            </p>
          </div>
        </div>
        <div className="rounded-2xl bg-background border border-border/60 px-6 py-12">
          <div className="flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00EC97] mx-auto mb-2"></div>
              <p className="text-sm text-foreground/90 dark:text-muted-foreground">
                Loading inventory...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-x-hidden max-w-full">
      {/* Header Block */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-3xl font-bold tracking-tight mb-2">
            Inventory Management
          </h2>
          <p className="text-sm text-foreground/90 dark:text-muted-foreground">
            Manage your product inventory and listings
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap shrink-0">
          <Link
            to="/dashboard/new-product"
            className="px-6 py-3 rounded-lg bg-[#00EC97] text-black flex items-center justify-center font-semibold text-sm hover:bg-[#00d97f] transition-colors"
          >
            <Plus className="size-4 mr-2" />
            Create Product
          </Link>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="px-6 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={cn("size-4 mr-2", isRefetching && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Search Block */}
      <div className="rounded-2xl bg-background border border-border/60 px-6 py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-foreground/50 dark:text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={globalFilter ?? ""}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-10 bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97] hover:border-border/60 text-sm"
          />
        </div>
        {sorting.length === 0 && (
          <p className="mt-3 text-xs text-foreground/60 dark:text-muted-foreground">
            Default order shows the most recently updated products first.
          </p>
        )}
      </div>

      {/* Desktop Table / Mobile Cards */}
      <div className="rounded-2xl bg-background border border-border/60 overflow-hidden max-w-full">
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-0">
            <thead className="bg-background/40 backdrop-blur-sm">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-xs font-medium text-foreground/70 dark:text-muted-foreground uppercase tracking-wider"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border/60">
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-foreground/70 dark:text-muted-foreground"
                  >
                    No products found
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => {
                  const isExpanded = expandedProductId === row.original.id;

                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={cn(
                          "group transition-colors",
                          "hover:bg-background/40",
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3 align-top">
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        ))}
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={row.getVisibleCells().length}
                            className="bg-background/30 p-4"
                          >
                            <ExpandedProductPanel
                              product={row.original}
                              categories={categories}
                              productTypes={productTypes}
                              onUpdateCollections={(categoryIds) =>
                                updateCategoriesMutation.mutate({
                                  id: row.original.id,
                                  categoryIds,
                                })
                              }
                              onUpdateType={(slug) =>
                                updateProductTypeMutation.mutate({
                                  id: row.original.id,
                                  productTypeSlug: slug,
                                })
                              }
                              onUpdateTags={(tags) =>
                                updateTagsMutation.mutate({
                                  id: row.original.id,
                                  tags,
                                })
                              }
                              onUpdateMetadata={(metadata) =>
                                updateMetadataMutation.mutate({
                                  id: row.original.id,
                                  metadata,
                                })
                              }
                              isUpdatingCollections={updateCategoriesMutation.isPending}
                              isUpdatingType={updateProductTypeMutation.isPending}
                              isUpdatingTags={updateTagsMutation.isPending}
                              isUpdatingMetadata={updateMetadataMutation.isPending}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-border/60 overflow-x-hidden max-w-full">
          {table.getRowModel().rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-foreground/70 dark:text-muted-foreground text-sm">
              No products found
            </div>
          ) : (
            table.getRowModel().rows.map((row) => {
              const product = row.original;
              const isListed = product.listed !== false;
              const isExpanded = expandedProductId === product.id;

              return (
                <div
                  key={row.id}
                  className={cn(
                    "p-4 space-y-3 transition-colors max-w-full overflow-x-hidden",
                    "hover:bg-background/40",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Link
                      to="/products/$productId"
                      params={{ productId: product.slug }}
                      className="shrink-0"
                    >
                      <div className="size-16 bg-muted border border-border/60 overflow-hidden rounded-lg group-hover:border-[#00EC97] transition-colors">
                        {product.thumbnailImage ? (
                          <img
                            src={product.thumbnailImage}
                            alt={product.title}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="size-full flex items-center justify-center">
                            <Package className="size-5 text-foreground/50 dark:text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to="/products/$productId"
                          params={{ productId: product.slug }}
                          className="block min-w-0 flex-1"
                        >
                          <p className="font-medium text-sm text-foreground/90 dark:text-muted-foreground truncate hover:text-[#00EC97] dark:hover:text-[#00EC97] transition-colors">
                            {product.title}
                          </p>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 shrink-0 p-0"
                          onClick={() =>
                            setExpandedProductId((current) =>
                              current === product.id ? null : product.id,
                            )
                          }
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {product.collections &&
                          product.collections.length > 0 && (
                            <Badge
                              variant="outline"
                              className="font-normal text-xs"
                            >
                              {product.collections[0]?.name}
                            </Badge>
                          )}
                        {product.metadata && <MetadataSummary metadata={product.metadata} />}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border/60">
                    <div className="space-y-1">
                      <p className="text-xs text-foreground/70 dark:text-muted-foreground">
                        ${product.price.toFixed(2)} {product.currency}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleToggleListing(product.id, isListed)
                        }
                        disabled={updateListingMutation.isPending}
                        className={cn(
                          "h-8 px-2",
                          isListed
                            ? "text-[#00EC97] hover:text-[#00EC97] hover:bg-[#00EC97]/10"
                            : "text-foreground/50 dark:text-muted-foreground hover:text-foreground/70 dark:hover:text-muted-foreground hover:bg-background/40",
                        )}
                        title={
                          isListed
                            ? "Listed - Click to delist"
                            : "Delisted - Click to list"
                        }
                      >
                        {isListed ? (
                          <Eye className="size-4" />
                        ) : (
                          <EyeOff className="size-4" />
                        )}
                      </Button>
                      <span className="text-xs text-foreground/70 dark:text-muted-foreground">
                        {isListed ? "Listed" : "Delisted"}
                      </span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border/60 pt-4">
                      <ExpandedProductPanel
                        product={product}
                        categories={categories}
                        productTypes={productTypes}
                        onUpdateCollections={(categoryIds) =>
                          updateCategoriesMutation.mutate({
                            id: product.id,
                            categoryIds,
                          })
                        }
                        onUpdateType={(slug) =>
                          updateProductTypeMutation.mutate({
                            id: product.id,
                            productTypeSlug: slug,
                          })
                        }
                        onUpdateTags={(tags) =>
                          updateTagsMutation.mutate({
                            id: product.id,
                            tags,
                          })
                        }
                        onUpdateMetadata={(metadata) =>
                          updateMetadataMutation.mutate({
                            id: product.id,
                            metadata,
                          })
                        }
                        isUpdatingCollections={updateCategoriesMutation.isPending}
                        isUpdatingType={updateProductTypeMutation.isPending}
                        isUpdatingTags={updateTagsMutation.isPending}
                        isUpdatingMetadata={updateMetadataMutation.isPending}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Pagination Block */}
      <div className="rounded-2xl bg-background border border-border/60 px-6 py-4 overflow-x-hidden max-w-full">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 min-w-0">
          <p className="text-sm text-foreground/90 dark:text-muted-foreground text-center md:text-left min-w-0 flex-1">
            Showing {currentPageStart} to {currentPageEnd} of {filteredRowCount} products
          </p>
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground/90 dark:text-muted-foreground">
                Rows per page
              </span>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger className="h-9 w-[84px] border-border/60 bg-background/60">
                  <SelectValue placeholder={table.getState().pagination.pageSize} />
                </SelectTrigger>
                <SelectContent className="border-border/60">
                  {[10, 20, 50, 100].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-colors disabled:opacity-50"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm text-foreground font-medium">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()}
            </span>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-colors disabled:opacity-50"
            >
              <ChevronRight className="size-4" />
            </button>
            </div>
          </div>
        </div>
      </div>

      <Outlet />
    </div>
  );
}
