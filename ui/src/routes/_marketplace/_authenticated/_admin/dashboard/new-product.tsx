import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Check,
  ImagePlus,
  Loader2,
  Mail,
  Package,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TagInput } from "@/components/ui/tag-input";
import { cn } from "@/lib/utils";
import { PROVIDER_MAP, type ProviderName } from "@/lib/providers";
import { useFileUpload } from "@/hooks/use-file-upload";
import { LuluBuilder } from "@/components/admin/lulu-product-builder";
import {
  useBrowseCatalog,
  useCatalogProduct,
  useCatalogVariants,
  useAssets,
  useCreateAsset,
  useGetPlacements,
  useBuildProduct,
  useGenerateProductMockups,
  useUpdateProduct,
} from "@/integrations/api/admin";
import type { ProductImage } from "@/integrations/api/products";
import { toast } from "sonner";

export const Route = createFileRoute(
  "/_marketplace/_authenticated/_admin/dashboard/new-product" as const,
)({
  component: NewProductPage,
});

interface BasicImage {
  id: string;
  url: string;
  isUploaded: boolean;
}

interface BasicVariant {
  name: string;
  price: string;
  sku: string;
}

interface FormState {
  providerName: ProviderName | "";
  productName: string;
  productDescription: string;
  basicPrice: string;
  basicImages: BasicImage[];
  basicThumbnailId: string | null;
  basicVariants: BasicVariant[];
  notificationEmails: string[];
  ownerAccountIds: string[];
  catalogProductId: string;
  catalogCollectionId: string;
  catalogSearch: string;
  selectedVariantIds: Set<string>;
  designFiles: Array<{ assetId: string; url: string; slot?: string }>;
  productImage: string;
  priceOverride: string;
}

const INITIAL_FORM_STATE: FormState = {
  providerName: "",
  productName: "",
  productDescription: "",
  basicPrice: "",
  basicImages: [],
  basicThumbnailId: null,
  basicVariants: [{ name: "Default", price: "", sku: "" }],
  notificationEmails: [],
  ownerAccountIds: [],
  catalogProductId: "",
  catalogCollectionId: "",
  catalogSearch: "",
  selectedVariantIds: new Set(),
  designFiles: [],
  productImage: "",
  priceOverride: "",
};

function NewProductPage() {
  const [step, setStep] = useState<"provider" | "builder">("provider");
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);

  return (
    <NewProductInner
      step={step}
      setStep={setStep}
      form={form}
      setForm={setForm}
    />
  );
}

function NewProductInner({
  step,
  setStep,
  form,
  setForm,
}: {
  step: "provider" | "builder";
  setStep: (s: "provider" | "builder") => void;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  const navigate = useNavigate();
  const buildMutation = useBuildProduct();
  const mockupMutation = useGenerateProductMockups();
  const updateMutation = useUpdateProduct();

  const isManual = form.providerName === "manual";

  const handleSelectProvider = (id: ProviderName) => {
    setForm((prev) => ({ ...prev, providerName: id }));
    setStep("builder");
  };

  const handleBackToProvider = () => {
    setStep("provider");
    setForm(INITIAL_FORM_STATE);
  };

  const canCreate = (): boolean => {
    if (!form.productName.trim()) return false;
    if (isManual) {
      if (!form.basicPrice || parseFloat(form.basicPrice) <= 0) return false;
      if (form.basicVariants.length === 0) return false;
    } else {
      if (!form.catalogProductId) return false;
      if (form.selectedVariantIds.size === 0) return false;
      if (form.designFiles.length === 0) return false;
    }
    return true;
  };

  const handleBuild = () => {
    if (isManual) {
      handleBuildManual();
    } else {
      handleBuildCatalog();
    }
  };

  const handleBuildManual = () => {
    const primaryImage = form.basicThumbnailId
      ? form.basicImages.find((img) => img.id === form.basicThumbnailId)?.url
      : form.basicImages[0]?.url;

    const variants = form.basicVariants.map((v, i) => ({
      name: v.name.trim() || `Variant ${i + 1}`,
      variantRef: v.name.trim() === "Default" ? "default" : `manual-${crypto.randomUUID()}`,
      providerConfig: {} as Record<string, unknown>,
      ...(v.price ? { price: parseFloat(v.price) } : {}),
      ...(v.sku.trim() ? { sku: v.sku.trim() } : {}),
    }));

    const hasNotificationDetails = form.notificationEmails.length > 0 || form.ownerAccountIds.length > 0;
    const metadata: Record<string, unknown> | undefined = hasNotificationDetails
      ? {
          providerDetails: {
            manual: {
              ...(form.notificationEmails.length > 0 ? { notificationEmails: form.notificationEmails } : {}),
              ...(form.ownerAccountIds.length > 0 ? { ownerAccountIds: form.ownerAccountIds } : {}),
            },
          },
        }
      : undefined;

    buildMutation.mutate(
      {
        name: form.productName.trim(),
        description: form.productDescription.trim() || undefined,
        providerName: "manual",
        image: primaryImage || undefined,
        variants,
        files: [],
        priceOverride: form.basicPrice ? parseFloat(form.basicPrice) : undefined,
        currency: "USD",
        metadata,
      },
      {
        onSuccess: (product) => {
          if (!product?.id) {
            toast.error("Product creation returned no ID");
            return;
          }

          if (form.basicImages.length > 0) {
            const thumbnailUrl = form.basicThumbnailId
              ? form.basicImages.find((img) => img.id === form.basicThumbnailId)?.url
              : form.basicImages[0]?.url;

            const images: ProductImage[] = form.basicImages.map((img, i) => ({
              id: img.id,
              url: img.url,
              type: img.id === form.basicThumbnailId
                ? ("primary" as const)
                : i === 0
                  ? ("primary" as const)
                  : ("preview" as const),
              order: i,
            }));

            updateMutation.mutate(
              {
                id: product.id,
                images,
                thumbnailImage: thumbnailUrl || undefined,
              },
              {
                onSuccess: () => {
                  toast.success("Product created");
                  navigate({ to: "/dashboard/inventory" });
                },
                onError: () => {
                  toast.success("Product created", {
                    description: "Images may need to be updated manually",
                  });
                  navigate({ to: "/dashboard/inventory" });
                },
              },
            );
          } else {
            toast.success("Product created");
            navigate({ to: "/dashboard/inventory" });
          }
        },
      },
    );
  };

  const handleBuildCatalog = () => {
    const selectedVariants = Array.from(form.selectedVariantIds);

    const variants = selectedVariants.map((variantRef) => ({
      name: variantRef,
      variantRef,
      providerConfig: {
        catalogProductId: form.catalogProductId,
        catalogVariantId: variantRef,
      } as Record<string, unknown>,
    }));

    buildMutation.mutate(
      {
        name: form.productName.trim(),
        description: form.productDescription.trim() || undefined,
        providerName: form.providerName,
        image: form.productImage.trim() || undefined,
        variants,
        files: form.designFiles.map((f) => ({
          assetId: f.assetId,
          url: f.url,
          slot: f.slot,
        })),
        priceOverride: form.priceOverride ? parseFloat(form.priceOverride) : undefined,
        currency: "USD",
      },
      {
        onSuccess: (product) => {
          if (product?.id) {
            mockupMutation.mutate(
              { id: product.id },
              {
                onSuccess: () => {
                  toast.info("Mockups are being generated in the background");
                },
                onError: () => {},
              },
            );
          }
          toast.success("Product created");
          navigate({ to: "/dashboard/inventory" });
        },
      },
    );
  };

  const isPending = buildMutation.isPending || updateMutation.isPending;
  const activeProvider = form.providerName ? PROVIDER_MAP.get(form.providerName as ProviderName) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (step === "builder") handleBackToProvider();
            else navigate({ to: "/dashboard/inventory" });
          }}
          className="gap-2"
        >
          <ArrowLeft className="size-4" />
          {step === "builder" ? "Change Provider" : "Back"}
        </Button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Create Product</h2>
          <p className="text-sm text-foreground/90 dark:text-muted-foreground">
            {step === "provider"
              ? "Choose a fulfillment provider for your product"
              : isManual
                ? "Set up your self-fulfilled product"
                : `Configure your ${activeProvider?.name ?? ""} product`}
          </p>
        </div>
      </div>

      {step === "provider" ? (
        <ProviderSelector form={form} onSelect={handleSelectProvider} />
      ) : form.providerName === "lulu" ? (
        <LuluBuilder onBack={handleBackToProvider} />
      ) : isManual ? (
        <BasicBuilder
          form={form}
          setForm={setForm}
          onSubmit={handleBuild}
          canCreate={canCreate()}
          isPending={isPending}
          onBack={handleBackToProvider}
        />
      ) : (
        <CatalogBuilder
          form={form}
          setForm={setForm}
          onSubmit={handleBuild}
          canCreate={canCreate()}
          isPending={isPending}
          onBack={handleBackToProvider}
        />
      )}
    </div>
  );
}

function ProviderSelector({
  form,
  onSelect,
}: {
  form: FormState;
  onSelect: (id: ProviderName) => void;
}) {
  const providers = Array.from(PROVIDER_MAP.values());

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/70 dark:text-muted-foreground">
        The provider determines how your product is fulfilled and what catalog options are available.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={cn(
              "rounded-xl border p-5 text-left transition-colors group",
              form.providerName === p.id
                ? "border-[#00EC97] bg-[#00EC97]/5"
                : "border-border/60 hover:border-[#00EC97]/40",
            )}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="size-8 rounded-lg flex items-center justify-center text-sm font-bold"
                style={{
                  backgroundColor: `${p.color}20`,
                  color: p.color,
                }}
              >
                {p.name[0]}
              </div>
              <p className="font-semibold">{p.name}</p>
            </div>
            <p className="text-sm text-foreground/70 dark:text-muted-foreground">
              {p.description}
            </p>
            {!p.hasCatalog && (
              <p className="text-xs text-foreground/50 mt-2">
                No catalog — add your own product details
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function BasicBuilder({
  form,
  setForm,
  onSubmit,
  canCreate,
  isPending,
  onBack,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: () => void;
  canCreate: boolean;
  isPending: boolean;
  onBack: () => void;
})
{
  const { uploadFiles, uploading: imageUploading } = useFileUpload("products");
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleImageUpload = async (fileList: FileList | File[]) => {
    const results = await uploadFiles(fileList);
    if (results.length === 0) return;

    const newImages: BasicImage[] = results.map((r) => ({
      id: r.id,
      url: r.url,
      isUploaded: true,
    }));

    setForm((prev) => {
      const updated = [...prev.basicImages, ...newImages];
      return {
        ...prev,
        basicImages: updated,
        basicThumbnailId: prev.basicThumbnailId ?? newImages[0]!.id,
      };
    });
  };

  const handleAddImageUrl = () => {
    const input = document.getElementById("basic-image-url-input") as HTMLInputElement | null;
    const url = input?.value?.trim();
    if (!url) return;
    const newImage: BasicImage = { id: `url-${Date.now()}`, url, isUploaded: false };
    setForm((prev) => ({
      ...prev,
      basicImages: [...prev.basicImages, newImage],
      basicThumbnailId: prev.basicThumbnailId ?? newImage.id,
    }));
    if (input) input.value = "";
  };

  const handleRemoveImage = (index: number) => {
    setForm((prev) => {
      const removed = prev.basicImages[index];
      const next = prev.basicImages.filter((_, i) => i !== index);
      return {
        ...prev,
        basicImages: next,
        basicThumbnailId: removed?.id === prev.basicThumbnailId
          ? (next[0]?.id ?? null)
          : prev.basicThumbnailId,
      };
    });
  };

  const handleMoveImage = (index: number, direction: "up" | "down") => {
    setForm((prev) => {
      const images = [...prev.basicImages];
      if (direction === "up" && index > 0) {
        [images[index - 1], images[index]] = [images[index], images[index - 1]];
      } else if (direction === "down" && index < images.length - 1) {
        [images[index], images[index + 1]] = [images[index + 1], images[index]];
      }
      return { ...prev, basicImages: images };
    });
  };

  const addVariant = () => {
    setForm((prev) => ({
      ...prev,
      basicVariants: [...prev.basicVariants, { name: "", price: "", sku: "" }],
    }));
  };

  const removeVariant = (index: number) => {
    setForm((prev) => {
      if (prev.basicVariants.length <= 1) return prev;
      return { ...prev, basicVariants: prev.basicVariants.filter((_, i) => i !== index) };
    });
  };

  const updateVariant = (index: number, field: keyof BasicVariant, value: string) => {
    setForm((prev) => ({
      ...prev,
      basicVariants: prev.basicVariants.map((v, i) => (i === index ? { ...v, [field]: value } : v)),
    }));
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleImageUpload(e.dataTransfer.files);
    }
  }, []);

  return (
    <>
      <div className="rounded-xl border border-[#10b981]/30 bg-[#10b981]/5 px-4 py-3 flex items-center gap-2 text-sm">
        <div className="size-5 rounded-full bg-[#10b981]/20 text-[#10b981] flex items-center justify-center text-xs font-bold">
          B
        </div>
        <span className="font-medium text-[#10b981]">Basic</span>
        <span className="text-foreground/60">— Self-fulfilled with email notifications</span>
        <button
          type="button"
          onClick={onBack}
          className="ml-auto text-xs text-foreground/50 hover:text-foreground underline"
        >
          Change
        </button>
      </div>

      <div className="space-y-4">
        <BasicDetailsSection
          productName={form.productName}
          productDescription={form.productDescription}
          onNameChange={(v) => setField("productName", v)}
          onDescriptionChange={(v) => setField("productDescription", v)}
        />

        <div className="rounded-xl border border-border/60 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Images</h3>
            {form.basicImages.length > 0 && (
              <span className="text-xs text-foreground/50">
                {form.basicImages.length} image{form.basicImages.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
              dragOver
                ? "border-[#00EC97] bg-[#00EC97]/5"
                : "border-border/60 hover:border-[#00EC97]/40",
            )}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <ImagePlus className="size-6 mx-auto mb-2 text-foreground/40" />
            <p className="text-sm text-foreground/70">Drop images here or click to browse</p>
            <p className="text-xs text-foreground/50 mt-1">PNG, JPG, WebP</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleImageUpload(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </div>

          {imageUploading && (
            <div className="flex items-center gap-2 text-sm text-[#00EC97]">
              <Loader2 className="size-4 animate-spin" />
              Uploading...
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Add by URL</Label>
              <Input
                id="basic-image-url-input"
                placeholder="https://example.com/image.jpg"
                className="h-9 bg-background/60 border border-border/60 rounded-lg text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddImageUrl(); } }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddImageUrl}
              className="h-9"
            >
              <Upload className="size-3.5 mr-1" />
              Add
            </Button>
          </div>

          {form.basicImages.length > 0 && (
            <div className="space-y-2">
              {form.basicImages.map((img, index) => (
                <div key={img.id} className="flex items-center gap-3 rounded-lg border border-border/60 p-2">
                  <img src={img.url} alt="" className="size-12 rounded object-cover bg-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate text-foreground/80">
                      {img.url.split("/").pop() || "Image"}
                    </p>
                    {img.id === form.basicThumbnailId && (
                      <span className="text-[10px] text-[#00EC97] font-medium">Thumbnail</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setField("basicThumbnailId", img.id)}
                      className={cn(
                        "p-1 rounded transition-colors",
                        img.id === form.basicThumbnailId
                          ? "text-[#00EC97]"
                          : "text-foreground/30 hover:text-[#00EC97]",
                      )}
                      title={img.id === form.basicThumbnailId ? "Current thumbnail" : "Set as thumbnail"}
                    >
                      <Star className="size-3.5" />
                    </button>
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleMoveImage(index, "up")}
                        disabled={index === 0}
                        aria-label="Move image up"
                        className="p-0.5 text-foreground/30 hover:text-foreground/70 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveImage(index, "down")}
                        disabled={index === form.basicImages.length - 1}
                        aria-label="Move image down"
                        className="p-0.5 text-foreground/30 hover:text-foreground/70 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      aria-label="Remove image"
                      className="p-1 text-foreground/30 hover:text-red-500 transition-colors"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/60 p-5 space-y-4">
          <h3 className="text-sm font-semibold">Pricing</h3>
          <div className="space-y-2">
            <Label>Price (USD) *</Label>
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium text-foreground/50">$</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="29.99"
                value={form.basicPrice}
                onChange={(e) => setField("basicPrice", e.target.value)}
                className="max-w-[200px] bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:border-[#00EC97]"
              />
            </div>
            <p className="text-xs text-foreground/50">
              Required for self-fulfilled products — there is no catalog price to reference.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Variants</h3>
            <Button type="button" variant="outline" size="sm" onClick={addVariant} className="h-7 text-xs gap-1">
              <Plus className="size-3" />
              Add Variant
            </Button>
          </div>
          <p className="text-xs text-foreground/50">
            By default, your product has one variant. Add more if you offer different sizes, colors, or options.
          </p>
          <div className="space-y-3">
            {form.basicVariants.map((v, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/60">
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-foreground/60">Name</Label>
                      <Input
                        placeholder={i === 0 ? "Default" : "e.g. Large"}
                        value={v.name}
                        onChange={(e) => updateVariant(i, "name", e.target.value)}
                        className="h-8 text-sm bg-background/60 border border-border/60 rounded-md"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-foreground/60">Price Override</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Uses product price"
                        value={v.price}
                        onChange={(e) => updateVariant(i, "price", e.target.value)}
                        className="h-8 text-sm bg-background/60 border border-border/60 rounded-md"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-foreground/60">SKU</Label>
                      <Input
                        placeholder="Optional"
                        value={v.sku}
                        onChange={(e) => updateVariant(i, "sku", e.target.value)}
                        className="h-8 text-sm bg-background/60 border border-border/60 rounded-md"
                      />
                    </div>
                  </div>
                </div>
                {form.basicVariants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeVariant(i)}
                    aria-label="Remove variant"
                    className="p-1 mt-4 text-foreground/30 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <BasicNotificationsSection
          emails={form.notificationEmails}
          ownerAccountIds={form.ownerAccountIds}
          onEmailsChange={(v) => setField("notificationEmails", v)}
          onOwnerIdsChange={(v) => setField("ownerAccountIds", v)}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={onSubmit}
          disabled={!canCreate || isPending}
          className="bg-[#00EC97] text-black hover:bg-[#00d97f]"
        >
          {isPending ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Check className="size-4 mr-2" />
          )}
          Create Product
        </Button>
      </div>
    </>
  );
}

function BasicDetailsSection({
  productName,
  productDescription,
  onNameChange,
  onDescriptionChange,
}: {
  productName: string;
  productDescription: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 p-5 space-y-4">
      <h3 className="text-sm font-semibold">Details</h3>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Product Name *</Label>
          <Input
            placeholder="3D Printed Figurine"
            value={productName}
            onChange={(e) => onNameChange(e.target.value)}
            className="bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:border-[#00EC97]"
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <textarea
            placeholder="Describe your product..."
            value={productDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm focus:border-[#00EC97] focus:outline-none focus:ring-0 resize-none"
          />
        </div>
      </div>
    </div>
  );
}

function BasicNotificationsSection({
  emails,
  ownerAccountIds,
  onEmailsChange,
  onOwnerIdsChange,
}: {
  emails: string[];
  ownerAccountIds: string[];
  onEmailsChange: (emails: string[]) => void;
  onOwnerIdsChange: (ids: string[]) => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-border/60 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-foreground/50" />
        <h3 className="text-sm font-semibold">Notification Emails</h3>
      </div>
      <p className="text-xs text-foreground/50">
        Add emails that receive order notifications for this product. Global emails from the{" "}
        <button
          type="button"
          onClick={() => navigate({ to: "/dashboard/providers" })}
          className="text-[#00EC97] hover:underline font-medium"
        >
          Providers
        </button>{" "}
        page apply automatically.
      </p>

      <div className="space-y-3">
        <TagInput
          label="Email Addresses"
          placeholder="merch@near.foundation"
          tags={emails}
          onTagsChange={onEmailsChange}
        />

        <TagInput
          label="NEAR Account IDs"
          hint="Notifications will be sent to {account}.near.email"
          placeholder="efiz.near"
          tags={ownerAccountIds}
          onTagsChange={onOwnerIdsChange}
        />
      </div>
    </div>
  );
}

function CatalogBuilder({
  form,
  setForm,
  onSubmit,
  canCreate,
  isPending,
  onBack,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: () => void;
  canCreate: boolean;
  isPending: boolean;
  onBack: () => void;
}) {
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const activeProvider = form.providerName ? PROVIDER_MAP.get(form.providerName as ProviderName) : null;

  return (
    <>
      <div className="rounded-xl border border-border/30 bg-background/40 px-4 py-3 flex items-center gap-2 text-sm">
        {activeProvider && (
          <>
            <div
              className="size-5 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                backgroundColor: `${activeProvider.color}20`,
                color: activeProvider.color,
              }}
            >
              {activeProvider.name[0]}
            </div>
            <span className="font-medium" style={{ color: activeProvider.color }}>
              {activeProvider.name}
            </span>
          </>
        )}
        <span className="text-foreground/60">— Select from catalog, add design, and configure</span>
        <button
          type="button"
          onClick={onBack}
          className="ml-auto text-xs text-foreground/50 hover:text-foreground underline"
        >
          Change
        </button>
      </div>

      <div className="space-y-4">
        <CatalogSection
          providerName={form.providerName}
          catalogProductId={form.catalogProductId}
          catalogCollectionId={form.catalogCollectionId}
          catalogSearch={form.catalogSearch}
          onSelectCollection={(id) => setForm((prev) => ({
            ...prev,
            catalogCollectionId: id,
            catalogProductId: "",
            selectedVariantIds: new Set(),
            designFiles: [],
            catalogSearch: "",
          }))}
          onSelectProduct={(id) => setForm((prev) => ({
            ...prev,
            catalogProductId: id,
            selectedVariantIds: prev.catalogProductId === id ? prev.selectedVariantIds : new Set(),
            designFiles: prev.catalogProductId === id ? prev.designFiles : [],
          }))}
          onSearchChange={(q) => setField("catalogSearch", q)}
        />

        {form.catalogProductId && (
          <VariantsSection
            providerName={form.providerName}
            catalogProductId={form.catalogProductId}
            selectedVariantIds={form.selectedVariantIds}
            onToggleVariant={(id) =>
              setForm((prev) => {
                const next = new Set(prev.selectedVariantIds);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return { ...prev, selectedVariantIds: next };
              })
            }
            onSelectAll={(ids) => setField("selectedVariantIds", new Set(ids))}
            onClearAll={() => setField("selectedVariantIds", new Set())}
          />
        )}

        {form.catalogProductId && form.selectedVariantIds.size > 0 && (
          <DesignSection
            providerName={form.providerName}
            catalogProductId={form.catalogProductId}
            files={form.designFiles}
            onFilesChange={(files) => setField("designFiles", files)}
          />
        )}

        <CatalogDetailsSection
          productName={form.productName}
          productDescription={form.productDescription}
          productImage={form.productImage}
          priceOverride={form.priceOverride}
          onNameChange={(v) => setField("productName", v)}
          onDescriptionChange={(v) => setField("productDescription", v)}
          onImageChange={(v) => setField("productImage", v)}
          onPriceChange={(v) => setField("priceOverride", v)}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={onSubmit}
          disabled={!canCreate || isPending}
          className="bg-[#00EC97] text-black hover:bg-[#00d97f]"
        >
          {isPending ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Check className="size-4 mr-2" />
          )}
          Create Product
        </Button>
      </div>
    </>
  );
}

function CatalogSection({
  providerName,
  catalogProductId,
  catalogCollectionId,
  catalogSearch,
  onSelectCollection,
  onSelectProduct,
  onSearchChange,
}: {
  providerName: string;
  catalogProductId: string;
  catalogCollectionId: string;
  catalogSearch: string;
  onSelectCollection: (id: string) => void;
  onSelectProduct: (id: string) => void;
  onSearchChange: (q: string) => void;
}) {
  const { data: catalogData, isLoading } = useBrowseCatalog(providerName, {
    limit: 50,
    collectionId: catalogSearch ? undefined : catalogCollectionId || undefined,
    enabled: !!providerName,
  });
  const products = catalogData?.products ?? [];
  const collections = catalogData?.collections ?? [];
  const selectedCollection = collections.find((collection) => collection.id === catalogCollectionId);
  const filtered = catalogSearch
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
          p.brand?.toLowerCase().includes(catalogSearch.toLowerCase()),
      )
    : products;

  const { data: selectedProductData } = useCatalogProduct(providerName, catalogProductId, {
    enabled: !!catalogProductId,
  });
  const selectedProduct =
    products.find((p) => p.id === catalogProductId) ?? selectedProductData?.product;
  const provider = providerName ? PROVIDER_MAP.get(providerName as ProviderName) : null;
  const showCollections = collections.length > 0 && !catalogCollectionId && !catalogSearch && !selectedProduct;

  return (
    <div className="rounded-xl border border-border/60 p-5 space-y-4">
      <h3 className="text-sm font-semibold">
        {showCollections ? "Catalog Collection" : "Catalog Product"}
      </h3>
      <p className="text-xs text-foreground/50">
        {showCollections
          ? `Choose a ${provider?.name ?? providerName} collection, then pick a blank product and upload your design.`
          : `Select the base product (blank) from the ${provider?.name ?? providerName} catalog.`}
      </p>

      {selectedProduct && (
        <div className="flex items-center gap-3 rounded-lg border border-[#00EC97]/40 bg-[#00EC97]/5 p-3">
          {selectedProduct.image ? (
            <img src={selectedProduct.image} alt={selectedProduct.name} className="size-10 rounded object-cover bg-muted" />
          ) : (
            <div className="size-10 rounded bg-muted flex items-center justify-center">
              <Package className="size-4 text-foreground/50" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{selectedProduct.name}</p>
            {selectedProduct.brand && (
              <p className="text-xs text-foreground/60 truncate">{selectedProduct.brand}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onSelectProduct("")}
            className="text-xs text-foreground/50 hover:text-foreground"
          >
            Change
          </button>
        </div>
      )}

      {!selectedProduct && showCollections && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-foreground/50" />
            <Input
              placeholder="Search all catalog products..."
              value={catalogSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:border-[#00EC97]"
            />
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-[#00EC97]" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => onSelectCollection(collection.id)}
                  className="flex items-center gap-3 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-[#00EC97]/40"
                >
                  {collection.image ? (
                    <img src={collection.image} alt={collection.name} className="size-10 rounded object-cover bg-muted" />
                  ) : (
                    <div className="size-10 rounded bg-muted flex items-center justify-center">
                      <Package className="size-4 text-foreground/50" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{collection.name}</p>
                    <p className="text-xs text-foreground/60 truncate">
                      {collection.productCount} {collection.productCount === 1 ? "product" : "products"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!selectedProduct && !showCollections && (
        <>
          {selectedCollection && (
            <div className="flex items-center gap-2 text-xs text-foreground/60">
              <button
                type="button"
                onClick={() => onSelectCollection("")}
                className="hover:text-foreground underline"
              >
                Collections
              </button>
              <span>/</span>
              <span className="text-foreground">{selectedCollection.name}</span>
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-foreground/50" />
            <Input
              placeholder="Search catalog..."
              value={catalogSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:border-[#00EC97]"
            />
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-[#00EC97]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-foreground/70">No catalog products found</div>
          ) : (
            <div className="grid gap-2 max-h-[300px] overflow-y-auto pr-1">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProduct(p.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                    catalogProductId === p.id
                      ? "border-[#00EC97] bg-[#00EC97]/5"
                      : "border-border/60 hover:border-[#00EC97]/40",
                  )}
                >
                  {p.image ? (
                    <img src={p.image} alt={p.name} className="size-10 rounded object-cover bg-muted" />
                  ) : (
                    <div className="size-10 rounded bg-muted flex items-center justify-center">
                      <Package className="size-4 text-foreground/50" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    {p.brand && (
                      <p className="text-xs text-foreground/60 truncate">{p.brand}</p>
                    )}
                  </div>
                  {p.variants && (
                    <Badge variant="outline" className="font-normal text-xs shrink-0">
                      {p.variants.length} variants
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VariantsSection({
  providerName,
  catalogProductId,
  selectedVariantIds,
  onToggleVariant,
  onSelectAll,
  onClearAll,
}: {
  providerName: string;
  catalogProductId: string;
  selectedVariantIds: Set<string>;
  onToggleVariant: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearAll: () => void;
}) {
  const { data: productData } = useCatalogProduct(providerName, catalogProductId, { enabled: !!catalogProductId });
  const { data: variantsData, isLoading } = useCatalogVariants(providerName, catalogProductId, { enabled: !!catalogProductId });

  const variants = variantsData?.variants ?? [];
  const productName = productData?.product?.name ?? catalogProductId;

  return (
    <div className="rounded-xl border border-border/60 p-5 space-y-4">
      <h3 className="text-sm font-semibold">Variants</h3>
      <p className="text-xs text-foreground/50">
        Choose which variants of &quot;{productName}&quot; to offer.
      </p>

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onSelectAll(variants.map((v) => v.id))} className="text-xs h-7">
          Select All
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClearAll} className="text-xs h-7">
          Clear All
        </Button>
        <Badge variant="outline" className="font-normal text-xs h-7 flex items-center">
          {selectedVariantIds.size} of {variants.length}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-[#00EC97]" />
        </div>
      ) : variants.length === 0 ? (
        <div className="text-center py-8 text-sm text-foreground/70">No variants found</div>
      ) : (
        <div className="grid gap-2 max-h-[300px] overflow-y-auto pr-1">
          {variants.map((v) => {
            const isSelected = selectedVariantIds.has(v.id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onToggleVariant(v.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  isSelected
                    ? "border-[#00EC97] bg-[#00EC97]/5"
                    : "border-border/60 hover:border-[#00EC97]/40",
                )}
              >
                {v.image ? (
                  <img src={v.image} alt={v.name} className="size-10 rounded object-cover bg-muted" />
                ) : (
                  <div className="size-10 rounded bg-muted flex items-center justify-center">
                    <Package className="size-4 text-foreground/50" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{v.name}</p>
                  <div className="flex gap-2 mt-0.5">
                    {v.size && <Badge variant="outline" className="font-normal text-xs">{v.size}</Badge>}
                    {v.color && <Badge variant="outline" className="font-normal text-xs">{v.color}</Badge>}
                  </div>
                </div>
                {v.price?.cost != null && (
                  <span className="text-sm text-foreground/70">
                    {v.price.currency && v.price.currency !== 'USD'
                      ? `${v.price.cost} ${v.price.currency}`
                      : `$${v.price.cost.toFixed(2)}`}
                  </span>
                )}
                <div
                  className={cn(
                    "size-5 rounded border flex items-center justify-center transition-colors shrink-0",
                    isSelected ? "border-[#00EC97] bg-[#00EC97] text-black" : "border-border/60",
                  )}
                >
                  {isSelected && <Check className="size-3" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DesignSection({
  providerName,
  catalogProductId,
  files,
  onFilesChange,
}: {
  providerName: string;
  catalogProductId: string;
  files: Array<{ assetId: string; url: string; slot?: string }>;
  onFilesChange: (files: Array<{ assetId: string; url: string; slot?: string }>) => void;
}) {
  const { data: assetsData } = useAssets({ limit: 100 });
  const createAssetMutation = useCreateAsset();
  const { uploadFiles, uploading: fileUploading } = useFileUpload("assets");
  const { data: placementsData } = useGetPlacements(providerName, catalogProductId, {
    enabled: !!providerName && !!catalogProductId,
  });
  const [assetUrlInput, setAssetUrlInput] = useState("");
  const [assetTypeInput, setAssetTypeInput] = useState("image");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingAssets = assetsData?.assets ?? [];
  const placements = placementsData?.placements ?? [];

  const handleAddAssetByUrl = async () => {
    if (!assetUrlInput.trim()) return;
    try {
      const result = await createAssetMutation.mutateAsync({
        url: assetUrlInput.trim(),
        type: assetTypeInput,
      });
      onFilesChange([...files, { assetId: result.id, url: result.url, slot: undefined }]);
      setAssetUrlInput("");
    } catch {}
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleDesignFileUpload(e.dataTransfer.files);
    }
  }, [files]);

  const handleDesignFileUpload = async (fileList: FileList | File[]) => {
    const results = await uploadFiles(fileList);
    if (results.length === 0) return;
    onFilesChange([...files, ...results.map((r) => ({ assetId: r.id, url: r.url, slot: undefined as string | undefined }))]);
  };

  const handleToggleExistingAsset = (asset: { id: string; url: string; type: string }) => {
    const isAlreadyAdded = files.some((f) => f.assetId === asset.id);
    if (isAlreadyAdded) {
      onFilesChange(files.filter((f) => f.assetId !== asset.id));
    } else {
      onFilesChange([...files, { assetId: asset.id, url: asset.url, slot: undefined }]);
    }
  };

  const handleSlotChange = (idx: number, slot: string) => {
    onFilesChange(files.map((f, i) => (i === idx ? { ...f, slot } : f)));
  };

  const handleRemoveFile = (idx: number) => {
    onFilesChange(files.filter((_, i) => i !== idx));
  };

  const catalogProduct = useCatalogProduct(providerName, catalogProductId, {
    enabled: !!providerName && !!catalogProductId,
  });

  return (
    <div className="rounded-xl border border-border/60 p-5 space-y-4">
      <h3 className="text-sm font-semibold">Design & Assets</h3>
      <p className="text-xs text-foreground/50">
        Upload or select design assets and assign them to placement slots.
      </p>

      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <Label className="text-xs font-medium">Upload Files</Label>
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            dragOver
              ? "border-[#00EC97] bg-[#00EC97]/5"
              : "border-border/60 hover:border-[#00EC97]/40",
          )}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <ImagePlus className="size-6 mx-auto mb-2 text-foreground/40" />
          <p className="text-sm text-foreground/70">Drop files here or click to browse</p>
          <p className="text-xs text-foreground/50 mt-1">PNG, JPG, SVG, PDF</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.svg"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleDesignFileUpload(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </div>
        {fileUploading && (
          <div className="flex items-center gap-2 text-sm text-[#00EC97]">
            <Loader2 className="size-4 animate-spin" />
            Uploading...
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <Label className="text-xs font-medium">Add by URL</Label>
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com/design.png"
            value={assetUrlInput}
            onChange={(e) => setAssetUrlInput(e.target.value)}
            className="flex-1 h-9 bg-background/60 border border-border/60 rounded-lg text-sm"
          />
          <select
            value={assetTypeInput}
            onChange={(e) => setAssetTypeInput(e.target.value)}
            className="h-9 rounded-lg border border-border/60 bg-background/60 px-3 text-sm"
          >
            <option value="image">Image</option>
            <option value="pdf">PDF</option>
          </select>
          <Button
            type="button"
            onClick={handleAddAssetByUrl}
            disabled={!assetUrlInput.trim() || createAssetMutation.isPending}
            className="h-9 bg-[#00EC97] text-black hover:bg-[#00d97f]"
          >
            {createAssetMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Add
          </Button>
        </div>
      </div>

      {existingAssets.length > 0 && (
        <div className="rounded-lg border border-border/60 p-4 space-y-3">
          <Label className="text-xs font-medium">Existing Assets</Label>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-3 max-h-48 overflow-y-auto">
            {existingAssets.map((asset) => {
              const isAdded = files.some((f) => f.assetId === asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => handleToggleExistingAsset(asset)}
                  className={cn(
                    "relative group aspect-square rounded-lg border-2 overflow-hidden transition-all",
                    isAdded
                      ? "border-[#00EC97] ring-2 ring-[#00EC97]/30"
                      : "border-border/60 hover:border-[#00EC97]/40",
                  )}
                >
                  {asset.type === "image" ? (
                    <img src={asset.url} alt={asset.name || "Asset"} className="size-full object-cover" />
                  ) : (
                    <div className="size-full bg-muted flex items-center justify-center">
                      <Package className="size-6 text-foreground/40" />
                    </div>
                  )}
                  {isAdded && (
                    <div className="absolute top-1 right-1 size-5 rounded-full bg-[#00EC97] text-black flex items-center justify-center">
                      <Check className="size-3" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-medium">
            Selected Files ({files.length}) — Assign to Placement Slots
          </Label>
          <div className="space-y-2">
            {files.map((f, idx) => (
              <div key={f.assetId} className="flex items-center gap-3 rounded-lg border border-border/60 p-3">
                <img src={f.url} alt="" className="size-10 rounded object-cover bg-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate text-foreground/80 mb-1">
                    {f.url.split("/").pop()}
                  </p>
                  {placements.length > 0 ? (
                    <select
                      value={f.slot || ""}
                      onChange={(e) => handleSlotChange(idx, e.target.value)}
                      className="h-7 rounded border border-border/60 bg-background/60 px-2 text-xs w-full"
                    >
                      <option value="">Select placement…</option>
                      {placements.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.label || p.name}
                          {p.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      placeholder="Slot (e.g. default, front, back)"
                      value={f.slot || ""}
                      onChange={(e) => handleSlotChange(idx, e.target.value)}
                      className="h-7 text-xs bg-background/60 border border-border/60 rounded"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(idx)}
                  className="text-foreground/50 hover:text-red-500 transition-colors shrink-0"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && catalogProduct?.data?.product?.image && (
        <div className="rounded-lg border border-border/60 p-4 space-y-2">
          <Label className="text-xs font-medium">Placement Preview</Label>
          <div className="relative inline-block">
            <img
              src={catalogProduct.data.product.image}
              alt="Product preview"
              className="rounded-lg max-h-36 object-contain"
            />
          </div>
          <p className="text-xs text-foreground/50">
            Final mockups will be generated after product creation.
          </p>
        </div>
      )}
    </div>
  );
}

function CatalogDetailsSection({
  productName,
  productDescription,
  productImage,
  priceOverride,
  onNameChange,
  onDescriptionChange,
  onImageChange,
  onPriceChange,
}: {
  productName: string;
  productDescription: string;
  productImage: string;
  priceOverride: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onImageChange: (v: string) => void;
  onPriceChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 p-5 space-y-4">
      <h3 className="text-sm font-semibold">Details</h3>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Product Name *</Label>
          <Input
            placeholder="My Product"
            value={productName}
            onChange={(e) => onNameChange(e.target.value)}
            className="bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:border-[#00EC97]"
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <textarea
            placeholder="Product description..."
            value={productDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm focus:border-[#00EC97] focus:outline-none focus:ring-0 resize-none"
          />
        </div>
        <div className="space-y-2">
          <Label>Image URL</Label>
          <Input
            placeholder="https://example.com/product-image.jpg"
            value={productImage}
            onChange={(e) => onImageChange(e.target.value)}
            className="bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:border-[#00EC97]"
          />
        </div>
        <div className="space-y-2">
          <Label>Price Override (optional)</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="Leave blank to use catalog pricing"
            value={priceOverride}
            onChange={(e) => onPriceChange(e.target.value)}
            className="bg-background/60 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:border-[#00EC97]"
          />
          <p className="text-xs text-foreground/50">
            Override the default retail price. Leave blank to use the provider&apos;s catalog price.
          </p>
        </div>
      </div>
    </div>
  );
}