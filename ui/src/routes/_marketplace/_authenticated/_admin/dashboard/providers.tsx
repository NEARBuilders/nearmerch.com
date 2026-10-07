import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Settings2,
  Webhook,
  AlertTriangle,
  Copy,
  Check,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiClient } from "@/utils/orpc";
import {
  useConfigureWebhook,
  useDisableWebhook,
  useTestProvider,
  PRINTFUL_WEBHOOK_EVENTS,
  LULU_WEBHOOK_EVENTS,
  type PrintfulWebhookEventType,
} from "@/integrations/api/providers";
import {
  useProviderTestState,
  useRunProviderTestStep,
  useSaveProviderTestScenario,
} from "@/integrations/api/provider-tests";
import { providerTestKeys } from "@/integrations/api/provider-tests";
import type { ProviderName } from "@/lib/providers";

function ProvidersError({ error }: { error: Error }) {
  const router = useRouter();

  const isDatabaseError = error.message?.includes('relation') ||
                         error.message?.includes('table') ||
                         error.message?.includes('column');

  return (
    <div className="text-center py-12">
      <p className="text-destructive mb-2 font-semibold">Failed to load configuration</p>
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

function ProviderTestPanel({
  provider,
  title,
  description,
  defaultScenario,
}: {
  provider: ProviderName;
  title: string;
  description: string;
  defaultScenario: Record<string, unknown>;
}) {
  const stateQuery = useProviderTestState(provider);
  const saveScenario = useSaveProviderTestScenario();
  const runStep = useRunProviderTestStep();
  const [scenarioText, setScenarioText] = useState(() =>
    JSON.stringify(defaultScenario, null, 2)
  );

  useEffect(() => {
    const scenario = stateQuery.data?.state?.scenario;
    if (scenario) {
      setScenarioText(JSON.stringify(scenario, null, 2));
    }
  }, [stateQuery.data?.state?.scenario, provider]);

  const run = async (step: "connection" | "quote" | "checkout" | "payment_webhook" | "provider_webhook") => {
    try {
      const result = await runStep.mutateAsync({ provider, step });
      toast.success(`${title} ${step} ran`, { description: result.success ? "Step completed" : result.error ?? "Step failed" });
    } catch (error) {
      toast.error(`Failed to run ${step}`, {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const save = async () => {
    try {
      const parsed = JSON.parse(scenarioText) as Record<string, unknown>;
      await saveScenario.mutateAsync({ provider, scenario: parsed });
      toast.success(`${title} scenario saved`);
    } catch (error) {
      toast.error(`Failed to save ${title} scenario`, {
        description: error instanceof Error ? error.message : "Scenario must be valid JSON",
      });
    }
  };

  const state = stateQuery.data?.state;
  const latestResults = state?.latestStepResults ?? {};
  const latestPayloads = state?.latestWebhookPayloads ?? {};
  const hasQuote = Boolean(latestResults.quote && !(latestResults.quote as { error?: string }).error);
  const hasCheckout = Boolean(latestResults.checkout && !(latestResults.checkout as { error?: string }).error);
  const hasPaymentWebhook = Boolean(latestResults.payment_webhook && !(latestResults.payment_webhook as { error?: string }).error);
  const canRunCheckout = hasQuote;
  const canRunPaymentWebhook = hasCheckout;
  const canRunProviderWebhook = hasPaymentWebhook;

  if (stateQuery.isLoading) {
    return (
      <div className="rounded-2xl bg-background border border-border/60 p-6">
        <div className="flex items-center gap-3 text-sm text-foreground/80">
          <Loader2 className="size-4 animate-spin" />
          Loading {title} test state...
        </div>
      </div>
    );
  }

  if (stateQuery.isError) {
    return (
      <div className="rounded-2xl bg-background border border-border/60 p-6 space-y-3">
        <div>
          <p className="font-semibold text-destructive">Failed to load {title} test state</p>
          <p className="text-sm text-foreground/80">{stateQuery.error instanceof Error ? stateQuery.error.message : "Unknown error"}</p>
        </div>
        <button
          type="button"
          onClick={() => stateQuery.refetch()}
          className="px-3 py-2 rounded-lg border border-border/60 text-sm hover:bg-background/60"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-background border border-border/60 p-6 space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-bold">{title}</h3>
          <p className="text-sm text-foreground/90 dark:text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stateQuery.refetch()}
            className="px-3 py-2 rounded-lg border border-border/60 text-sm hover:bg-background/60"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saveScenario.isPending}
            className="px-3 py-2 rounded-lg bg-[#00EC97] text-black text-sm font-semibold disabled:opacity-50"
          >
            {saveScenario.isPending ? <Loader2 className="size-4 animate-spin inline mr-2" /> : null}
            Save Test Product
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`scenario-${provider}`}>Scenario JSON</Label>
          <textarea
            id={`scenario-${provider}`}
            value={scenarioText}
            onChange={(e) => setScenarioText(e.target.value)}
            rows={18}
            className="w-full rounded-xl border border-border/60 bg-background/60 p-3 font-mono text-xs text-foreground outline-none focus:border-[#00EC97]"
          />
        </div>
        <div className="space-y-3 text-sm">
          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="text-xs uppercase text-foreground/60 mb-1">Test Product</div>
            <div className="font-mono text-xs break-all">{state?.testProductId ?? "Not created yet"}</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
            <div className="text-xs uppercase text-foreground/60">Step Status</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`px-2 py-1 rounded-full border ${state ? "border-[#00EC97]/40 text-[#00EC97]" : "border-border/60 text-foreground/70"}`}>state</span>
              <span className={`px-2 py-1 rounded-full border ${hasQuote ? "border-[#00EC97]/40 text-[#00EC97]" : "border-border/60 text-foreground/70"}`}>quote</span>
              <span className={`px-2 py-1 rounded-full border ${hasCheckout ? "border-[#00EC97]/40 text-[#00EC97]" : "border-border/60 text-foreground/70"}`}>checkout</span>
              <span className={`px-2 py-1 rounded-full border ${hasPaymentWebhook ? "border-[#00EC97]/40 text-[#00EC97]" : "border-border/60 text-foreground/70"}`}>payment</span>
            </div>
            <div className="text-xs text-foreground/60">
              Selected rates: <span className="font-mono text-foreground/90">{state?.selectedRates ? JSON.stringify(state.selectedRates) : "none"}</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="text-xs uppercase text-foreground/60 mb-1">Latest Order</div>
            <div className="font-mono text-xs break-all">
              {state?.latestOrderId ? (
                <Link
                  to="/dashboard/orders"
                  search={{ orderId: state.latestOrderId, search: undefined }}
                  className="text-[#00EC97] hover:underline"
                >
                  {state.latestOrderId}
                </Link>
              ) : (
                "None"
              )}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="text-xs uppercase text-foreground/60 mb-1">Latest Results</div>
            <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(latestResults, null, 2)}</pre>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="text-xs uppercase text-foreground/60 mb-1">Latest Webhooks</div>
            <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(latestPayloads, null, 2)}</pre>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run("connection")} disabled={runStep.isPending} className="px-3 py-2 rounded-lg border border-border/60 text-sm hover:bg-background/60 disabled:opacity-50">Connection</button>
        <button type="button" onClick={() => run("quote")} disabled={runStep.isPending} className="px-3 py-2 rounded-lg border border-border/60 text-sm hover:bg-background/60 disabled:opacity-50">Quote</button>
        <button type="button" onClick={() => run("checkout")} disabled={runStep.isPending || !canRunCheckout} title={!canRunCheckout ? "Run quote first so selected rates are available" : undefined} className="px-3 py-2 rounded-lg border border-border/60 text-sm hover:bg-background/60 disabled:opacity-50">Checkout</button>
        <button type="button" onClick={() => run("payment_webhook")} disabled={runStep.isPending || !canRunPaymentWebhook} title={!canRunPaymentWebhook ? "Run checkout first" : undefined} className="px-3 py-2 rounded-lg border border-border/60 text-sm hover:bg-background/60 disabled:opacity-50">Paid Webhook</button>
        <button type="button" onClick={() => run("provider_webhook")} disabled={runStep.isPending || !canRunProviderWebhook} title={!canRunProviderWebhook ? "Run payment webhook first" : undefined} className="px-3 py-2 rounded-lg border border-border/60 text-sm hover:bg-background/60 disabled:opacity-50">Provider Webhook</button>
      </div>
    </div>
  );
}

export const Route = createFileRoute(
  "/_marketplace/_authenticated/_admin/dashboard/providers"
)({
  loader: async ({ context }) => {
    const queryClient = context.queryClient;
    const [printful, lulu, manual, qikink] = await Promise.all([
      apiClient.getProviderConfig({ provider: "printful" }),
      apiClient.getProviderConfig({ provider: "lulu" }),
      apiClient.getProviderConfig({ provider: "manual" }),
      apiClient.getProviderConfig({ provider: "qikink" }),
      queryClient.prefetchQuery({
        queryKey: providerTestKeys.state("printful"),
        queryFn: () => apiClient.getProviderTestState({ provider: "printful" }),
      }),
      queryClient.prefetchQuery({
        queryKey: providerTestKeys.state("lulu"),
        queryFn: () => apiClient.getProviderTestState({ provider: "lulu" }),
      }),
      queryClient.prefetchQuery({
        queryKey: providerTestKeys.state("manual"),
        queryFn: () => apiClient.getProviderTestState({ provider: "manual" }),
      }),
      queryClient.prefetchQuery({
        queryKey: providerTestKeys.state("qikink"),
        queryFn: () => apiClient.getProviderTestState({ provider: "qikink" }),
      }),
    ]);

    return {
      printfulConfig: printful.config,
      luluConfig: lulu.config,
      manualConfig: manual.config,
      qikinkConfig: qikink.config,
    };
  },
  errorComponent: ProvidersError,
  component: ProvidersPage,
});

function ProvidersPage() {
  const router = useRouter();
  const loaderData = Route.useLoaderData();

  if (!loaderData) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Provider Configuration</h2>
          <p className="text-sm text-foreground/90 dark:text-muted-foreground">
            Configure fulfillment providers and webhooks
          </p>
        </div>
        <div className="rounded-2xl bg-background border border-border/60 px-6 py-12">
          <div className="flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00EC97] mx-auto mb-2"></div>
              <p className="text-sm text-foreground/90 dark:text-muted-foreground">Loading provider configuration...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { printfulConfig, luluConfig, manualConfig } = loaderData;
  const configureWebhook = useConfigureWebhook();
  const disableWebhook = useDisableWebhook();
  const testProvider = useTestProvider();

  const [webhookUrl, setWebhookUrl] = useState(() => 
    typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/printful` : ""
  );
  const [luluWebhookUrl, setLuluWebhookUrl] = useState(() =>
    typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/lulu` : ""
  );
  const [selectedEvents, setSelectedEvents] = useState<PrintfulWebhookEventType[]>([
    "shipment_sent",
    "shipment_delivered",
    "shipment_returned",
    "shipment_canceled",
    "order_created",
    "order_updated",
    "order_canceled",
    "order_failed",
  ]);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [luluConfigDialogOpen, setLuluConfigDialogOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [manualNotificationEmails, setManualNotificationEmails] = useState("");
  const [manualOwnerAccountIds, setManualOwnerAccountIds] = useState("");
  const [manualReplyTo, setManualReplyTo] = useState("");

  useEffect(() => {
    if (manualConfig?.settings) {
      const s = manualConfig.settings as Record<string, unknown>;
      setManualNotificationEmails(Array.isArray(s.notificationEmails) ? (s.notificationEmails as string[]).join(", ") : "");
      setManualOwnerAccountIds(Array.isArray(s.ownerAccountIds) ? (s.ownerAccountIds as string[]).join(", ") : "");
      setManualReplyTo((s.replyToEmail as string) ?? "");
    }
  }, [manualConfig]);

  const handleCopyKey = async (key: string, keyType: string) => {
    await navigator.clipboard.writeText(key);
    setCopiedKey(keyType);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getErrorMessage = (err: unknown): string => {
    if (err && typeof err === 'object') {
      const error = err as { message?: string; json?: { message?: string } };
      if (error.json?.message) return error.json.message;
      if (error.message) return error.message;
    }
    return 'An unexpected error occurred';
  };

  const handleConfigure = async () => {
    try {
      await configureWebhook.mutateAsync({
        provider: "printful",
        webhookUrlOverride: webhookUrl || undefined,
        events: selectedEvents,
      });
      toast.success("Webhook configured successfully");
      setConfigDialogOpen(false);
      router.invalidate();
    } catch (err) {
      const message = getErrorMessage(err);
      toast.error("Failed to configure webhook", { description: message });
      console.error("Failed to configure webhook:", err);
    }
  };

  const handleConfigureLulu = async () => {
    try {
      await configureWebhook.mutateAsync({
        provider: "lulu",
        webhookUrlOverride: luluWebhookUrl || undefined,
        events: LULU_WEBHOOK_EVENTS.map((event) => event.value),
      });
      toast.success("Lulu webhook configured successfully");
      setLuluConfigDialogOpen(false);
      router.invalidate();
    } catch (err) {
      const message = getErrorMessage(err);
      toast.error("Failed to configure Lulu webhook", { description: message });
      console.error("Failed to configure Lulu webhook:", err);
    }
  };

  const handleDisable = async () => {
    try {
      await disableWebhook.mutateAsync({ provider: "printful" });
      toast.success("Webhook disabled successfully");
      router.invalidate();
    } catch (err) {
      const message = getErrorMessage(err);
      toast.error("Failed to disable webhook", { description: message });
      console.error("Failed to disable webhook:", err);
    }
  };

  const handleDisableLulu = async () => {
    try {
      await disableWebhook.mutateAsync({ provider: "lulu" });
      toast.success("Lulu webhook disabled successfully");
      router.invalidate();
    } catch (err) {
      const message = getErrorMessage(err);
      toast.error("Failed to disable Lulu webhook", { description: message });
      console.error("Failed to disable Lulu webhook:", err);
    }
  };

  const handleTest = async () => {
    try {
      const result = await testProvider.mutateAsync({ provider: "printful" });
      if (result.success) {
        toast.success("Connection test successful");
      } else {
        toast.error("Connection test failed", { description: result.message || "Unknown error" });
      }
    } catch (err) {
      const message = getErrorMessage(err);
      toast.error("Connection test failed", { description: message });
      console.error("Failed to test provider:", err);
    }
  };

  const handleTestLulu = async () => {
    try {
      const result = await testProvider.mutateAsync({ provider: "lulu" });
      if (result.success) {
        toast.success("Lulu connection test successful");
      } else {
        toast.error("Lulu connection test failed", { description: result.message || "Unknown error" });
      }
    } catch (err) {
      const message = getErrorMessage(err);
      toast.error("Lulu connection test failed", { description: message });
      console.error("Failed to test Lulu provider:", err);
    }
  };

  const toggleEvent = (event: PrintfulWebhookEventType) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleTestManual = async () => {
    try {
      const result = await testProvider.mutateAsync({ provider: "manual" });
      if (result.success) {
        toast.success("Manual provider is available");
      } else {
        toast.error("Manual provider test failed", { description: result.message || "Unknown error" });
      }
    } catch (err) {
      const message = getErrorMessage(err);
      toast.error("Manual provider test failed", { description: message });
      console.error("Failed to test manual provider:", err);
    }
  };

  const handleSaveManual = async () => {
    try {
      await configureWebhook.mutateAsync({
        provider: "manual",
        settings: {
          notificationEmails: manualNotificationEmails
            .split(",")
            .map((e: string) => e.trim())
            .filter(Boolean),
          ownerAccountIds: manualOwnerAccountIds
            .split(",")
            .map((id: string) => id.trim())
            .filter(Boolean),
          replyToEmail: manualReplyTo || undefined,
        },
      });
      toast.success("Manual provider settings saved");
      router.invalidate();
    } catch (err) {
      const message = getErrorMessage(err);
      toast.error("Failed to save manual provider settings", { description: message });
      console.error("Failed to save manual provider settings:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Provider Configuration</h2>
          <p className="text-sm text-foreground/90 dark:text-muted-foreground">
            Manage fulfillment provider settings and webhooks
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="px-6 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
        >
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </button>
      </div>

      <div className="rounded-2xl bg-background border border-border/60 p-6">
        <div className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-[#00EC97]/10 flex items-center justify-center">
                <span className="text-lg font-bold text-[#00EC97]">P</span>
              </div>
              <div>
                <h3 className="text-xl font-bold">Printful</h3>
                <p className="text-sm text-foreground/90 dark:text-muted-foreground">Print-on-demand fulfillment</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
               {printfulConfig?.enabled ? (
                <div className="px-3 py-1 rounded-2xl bg-[#00EC97]/10 border border-[#00EC97]/60 text-[#00EC97] flex items-center gap-1.5 text-sm font-semibold">
                  <CheckCircle className="size-3" />
                  Active
                </div>
              ) : (
                <div className="px-3 py-1 rounded-2xl bg-background/60 border border-border/60 text-foreground/90 dark:text-muted-foreground flex items-center gap-1.5 text-sm font-semibold">
                  <XCircle className="size-3" />
                  Not Configured
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testProvider.isPending}
              className="px-6 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors disabled:opacity-50"
            >
              {testProvider.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Settings2 className="size-4 mr-2" />
              )}
              Test Connection
            </button>

            <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="px-6 py-3 rounded-lg bg-[#00EC97] text-black flex items-center justify-center font-semibold text-sm hover:bg-[#00d97f] transition-colors"
                >
                  <Webhook className="size-4 mr-2" />
                  Configure Webhooks
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl bg-background border border-border/60">
                <DialogHeader>
                  <DialogTitle>Configure Printful Webhooks</DialogTitle>
                  <DialogDescription>
                    Set up webhook endpoints to receive real-time order updates
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="webhookUrl">Webhook URL (Optional Override)</Label>
                    <Input
                      id="webhookUrl"
                      placeholder="https://your-domain.com/api/webhooks/printful"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                    <p className="text-xs text-foreground/90 dark:text-muted-foreground">
                      Leave empty to use the default webhook endpoint
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label>Events to Subscribe</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {PRINTFUL_WEBHOOK_EVENTS.map((event) => (
                        <div
                          key={event.value}
                          className="flex items-start space-x-2 p-3 rounded-2xl bg-background/40 border border-border/60 hover:bg-background/60 transition-colors"
                        >
                          <Checkbox
                            id={event.value}
                            checked={selectedEvents.includes(event.value)}
                            onCheckedChange={() => toggleEvent(event.value)}
                          />
                          <div className="grid gap-0.5 leading-none">
                            <label
                              htmlFor={event.value}
                              className="text-sm font-medium cursor-pointer text-foreground"
                            >
                              {event.label}
                            </label>
                            <p className="text-xs text-foreground/90 dark:text-muted-foreground">
                              {event.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <button
                    type="button"
                    onClick={() => setConfigDialogOpen(false)}
                    className="px-6 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfigure}
                    disabled={configureWebhook.isPending || selectedEvents.length === 0}
                    className="px-6 py-3 rounded-lg bg-[#00EC97] text-black flex items-center justify-center font-semibold text-sm hover:bg-[#00d97f] transition-colors disabled:opacity-50"
                  >
                    {configureWebhook.isPending ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : null}
                    Save Configuration
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

             {printfulConfig?.webhookUrl && (
              <button
                type="button"
                onClick={handleDisable}
                disabled={disableWebhook.isPending}
                className="px-6 py-3 rounded-lg bg-destructive text-destructive-foreground flex items-center justify-center font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {disableWebhook.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="size-4 mr-2" />
                )}
                Disable Webhooks
              </button>
            )}
          </div>

           {printfulConfig?.webhookUrl && (
            <div className="rounded-2xl bg-background/40 border border-border/60 p-4 space-y-4">
              <h4 className="font-semibold text-base flex items-center gap-2">
                <Webhook className="size-4" />
                Webhook Configuration
              </h4>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between p-3 rounded-2xl bg-background/60 border border-border/60">
                  <span className="text-foreground/90 dark:text-muted-foreground">Webhook URL:</span>
                  <code className="text-xs bg-background px-2 py-1 rounded border border-border/60">
                     {printfulConfig.webhookUrl}
                  </code>
                </div>

                 {printfulConfig.enabledEvents && printfulConfig.enabledEvents.length > 0 && (
                  <div className="p-3 rounded-2xl bg-background/60 border border-border/60">
                    <span className="text-foreground/90 dark:text-muted-foreground block mb-2">Enabled Events:</span>
                    <div className="flex flex-wrap gap-1">
                       {printfulConfig.enabledEvents.map((event) => (
                        <div key={event} className="px-2 py-1 rounded border border-border/60 text-xs">
                          {event}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                 {printfulConfig.publicKey && (
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-background/60 border border-border/60">
                    <span className="text-foreground/90 dark:text-muted-foreground">Public Key:</span>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-background px-2 py-1 rounded border border-border/60 truncate max-w-[200px]">
                         {printfulConfig.publicKey}
                      </code>
                      <button
                        type="button"
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-background/60 transition-colors"
                         onClick={() => handleCopyKey(printfulConfig.publicKey!, "public")}
                      >
                        {copiedKey === "public" ? (
                          <Check className="size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                 {printfulConfig.lastConfiguredAt && (
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-background/60 border border-border/60">
                    <span className="text-foreground/90 dark:text-muted-foreground">Last Configured:</span>
                    <span className="text-xs text-foreground">
                       {new Date(printfulConfig.lastConfiguredAt).toLocaleString()}
                    </span>
                  </div>
                )}

                 {printfulConfig.expiresAt && (
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-background border border-amber-500/60">
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="size-3" />
                      Expires:
                    </span>
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                       {new Date(printfulConfig.expiresAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lulu Provider Section */}
      <div className="rounded-2xl bg-background border border-border/60 p-6">
        <div className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-orange-500/10 flex items-center justify-center">
                <span className="text-lg font-bold text-orange-500">L</span>
              </div>
              <div>
                <h3 className="text-xl font-bold">Lulu</h3>
                <p className="text-sm text-foreground/90 dark:text-muted-foreground">Print-on-demand book fulfillment</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {luluConfig?.enabled ? (
                <div className="px-3 py-1 rounded-2xl bg-orange-500/10 border border-orange-500/60 text-orange-500 flex items-center gap-1.5 text-sm font-semibold">
                  <CheckCircle className="size-3" />
                  Active
                </div>
              ) : (
                <div className="px-3 py-1 rounded-2xl bg-background/60 border border-border/60 text-foreground/90 dark:text-muted-foreground flex items-center gap-1.5 text-sm font-semibold">
                  <XCircle className="size-3" />
                  Not Configured
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTestLulu}
              disabled={testProvider.isPending}
              className="px-6 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm hover:bg-orange-500 hover:border-orange-500 hover:text-white transition-colors disabled:opacity-50"
            >
              {testProvider.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Settings2 className="size-4 mr-2" />
              )}
              Test Connection
            </button>

            <Dialog open={luluConfigDialogOpen} onOpenChange={setLuluConfigDialogOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="px-6 py-3 rounded-lg bg-orange-500 text-white flex items-center justify-center font-semibold text-sm hover:bg-orange-600 transition-colors"
                >
                  <Webhook className="size-4 mr-2" />
                  Configure Webhook
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-xl rounded-2xl bg-background border border-border/60">
                <DialogHeader>
                  <DialogTitle>Configure Lulu Webhook</DialogTitle>
                  <DialogDescription>
                    Subscribe to `PRINT_JOB_STATUS_CHANGED` via the Lulu API.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="luluWebhookUrl">Webhook URL</Label>
                    <Input
                      id="luluWebhookUrl"
                      placeholder="https://your-domain.com/api/webhooks/lulu"
                      value={luluWebhookUrl}
                      onChange={(e) => setLuluWebhookUrl(e.target.value)}
                    />
                  </div>

                  <div className="rounded-2xl bg-background/40 border border-border/60 p-3 text-sm text-foreground/90 dark:text-muted-foreground">
                    Event: <code className="text-xs">PRINT_JOB_STATUS_CHANGED</code>
                  </div>
                </div>

                <DialogFooter>
                  <button
                    type="button"
                    onClick={() => setLuluConfigDialogOpen(false)}
                    className="px-6 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm hover:bg-orange-500 hover:border-orange-500 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfigureLulu}
                    disabled={configureWebhook.isPending || !luluWebhookUrl}
                    className="px-6 py-3 rounded-lg bg-orange-500 text-white flex items-center justify-center font-semibold text-sm hover:bg-orange-600 transition-colors disabled:opacity-50"
                  >
                    {configureWebhook.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                    Save Configuration
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {luluConfig?.webhookUrl && (
              <button
                type="button"
                onClick={handleDisableLulu}
                disabled={disableWebhook.isPending}
                className="px-6 py-3 rounded-lg bg-destructive text-destructive-foreground flex items-center justify-center font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {disableWebhook.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <XCircle className="size-4 mr-2" />}
                Disable Webhook
              </button>
            )}
          </div>

          <div className="rounded-2xl bg-background/40 border border-border/60 p-4">
            <h4 className="font-semibold text-base flex items-center gap-2 mb-3">
              <Settings2 className="size-4" />
              Configuration
            </h4>
            <p className="text-sm text-foreground/90 dark:text-muted-foreground mb-3">
              Lulu requires OAuth2 authentication with a Client Key and Client Secret. 
              Set these in your environment variables:
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-background/60 border border-border/60">
                <code className="text-xs font-mono">LULU_CLIENT_KEY</code>
                <span className="text-xs text-foreground/60">From Lulu Developer Dashboard</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-2xl bg-background/60 border border-border/60">
                <code className="text-xs font-mono">LULU_CLIENT_SECRET</code>
                <span className="text-xs text-foreground/60">From Lulu Developer Dashboard</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-background/40 border border-border/60 p-4">
            <h4 className="font-semibold text-base flex items-center gap-2 mb-3">
              <Webhook className="size-4" />
              Webhook Setup
            </h4>
            <p className="text-sm text-foreground/90 dark:text-muted-foreground mb-3">
              Configure webhooks via the Lulu API. Signatures are verified with your Lulu client secret:
            </p>
            <div className="flex items-center justify-between p-3 rounded-2xl bg-background/60 border border-border/60">
              <span className="text-foreground/90 dark:text-muted-foreground text-sm">Webhook URL:</span>
              <code className="text-xs bg-background px-2 py-1 rounded border border-border/60">
                {typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/lulu` : 'https://your-domain.com/api/webhooks/lulu'}
              </code>
            </div>
            {luluConfig?.webhookUrl && (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between p-3 rounded-2xl bg-background/60 border border-border/60">
                  <span className="text-foreground/90 dark:text-muted-foreground">Configured URL:</span>
                  <code className="text-xs bg-background px-2 py-1 rounded border border-border/60">{luluConfig.webhookUrl}</code>
                </div>
                {luluConfig.publicKey && (
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-background/60 border border-border/60">
                    <span className="text-foreground/90 dark:text-muted-foreground">Webhook ID:</span>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-background px-2 py-1 rounded border border-border/60 truncate max-w-[200px]">{luluConfig.publicKey}</code>
                      <button
                        type="button"
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-background/60 transition-colors"
                        onClick={() => handleCopyKey(luluConfig.publicKey!, "lulu")}
                      >
                        {copiedKey === "lulu" ? <Check className="size-3" /> : <Copy className="size-3" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-foreground/60 mt-2">
              Supported event: PRINT_JOB_STATUS_CHANGED
            </p>
          </div>

          <div className="rounded-2xl bg-background/40 border border-border/60 p-4">
            <h4 className="font-semibold text-base flex items-center gap-2 mb-3">
              <Settings2 className="size-4" />
              Product Configuration
            </h4>
            <p className="text-sm text-foreground/90 dark:text-muted-foreground mb-3">
              For Lulu products, you need to store additional provider data in your product configuration:
            </p>
            <div className="space-y-2 text-sm">
              <div className="p-3 rounded-2xl bg-background/60 border border-border/60">
                <code className="text-xs font-mono block mb-1">podPackageId</code>
                <span className="text-xs text-foreground/60">The Lulu print specification (e.g., &quot;0600X0900_BW_STA_40ULS_M12&quot;)</span>
              </div>
              <div className="p-3 rounded-2xl bg-background/60 border border-border/60">
                <code className="text-xs font-mono block mb-1">pageCount</code>
                <span className="text-xs text-foreground/60">Number of pages in the book</span>
              </div>
              <div className="p-3 rounded-2xl bg-background/60 border border-border/60">
                <code className="text-xs font-mono block mb-1">coverPdfUrl</code>
                <span className="text-xs text-foreground/60">URL to the cover PDF file</span>
              </div>
              <div className="p-3 rounded-2xl bg-background/60 border border-border/60">
                <code className="text-xs font-mono block mb-1">interiorPdfUrl</code>
                <span className="text-xs text-foreground/60">URL to the interior PDF file</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-background border border-emerald-500/30 overflow-hidden">
        <div className="p-6 border-b border-emerald-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Settings2 className="size-5 text-emerald-500" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Basic</h3>
                <p className="text-sm text-foreground/70">Email fulfillment — manual order management with owner notifications</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${manualConfig?.enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-foreground/50"}`}>
                {manualConfig?.enabled ? <><CheckCircle className="size-3" /> Configured</> : <><XCircle className="size-3" /> Not Configured</>}
              </span>
              <button
                type="button"
                onClick={handleTestManual}
                disabled={testProvider.isPending}
                className="px-3 py-1.5 rounded-md bg-background/60 border border-border/60 text-sm font-medium hover:bg-emerald-500/10 hover:border-emerald-500/40 transition-colors disabled:opacity-50"
              >
                {testProvider.isPending ? <Loader2 className="size-4 animate-spin" /> : "Test Connection"}
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="manual-emails">Notification Emails</Label>
              <Input
                id="manual-emails"
                placeholder="merch@near.foundation, admin@example.com"
                value={manualNotificationEmails}
                onChange={(e) => setManualNotificationEmails(e.target.value)}
                className="bg-background/60 border border-border/60"
              />
              <p className="text-xs text-foreground/50">Comma-separated email addresses that receive order notifications</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-owners">Owner Account IDs</Label>
              <Input
                id="manual-owners"
                placeholder="efiz.near, alice.near"
                value={manualOwnerAccountIds}
                onChange={(e) => setManualOwnerAccountIds(e.target.value)}
                className="bg-background/60 border border-border/60"
              />
              <p className="text-xs text-foreground/50">NEAR accounts (&#42;.near only) will receive notifications at &#123;account&#125;@near.email</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-reply-to">Reply-To Email</Label>
            <Input
              id="manual-reply-to"
              placeholder="noreply@near.foundation"
              value={manualReplyTo}
              onChange={(e) => setManualReplyTo(e.target.value)}
              className="bg-background/60 border border-border/60"
            />
          </div>

          <button
            type="button"
            onClick={handleSaveManual}
            disabled={configureWebhook.isPending}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50"
          >
            {configureWebhook.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            Save Settings
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-2xl font-bold tracking-tight mb-2">Provider Test Harness</h3>
          <p className="text-sm text-foreground/90 dark:text-muted-foreground">
            Run provider tests step by step with a deterministic hidden test product and inspect each response.
          </p>
        </div>

        <ProviderTestPanel
          provider="manual"
          title="Manual"
          description="Manual fulfillment test flow with notification emails and the admin order dashboard."
          defaultScenario={{
            quantity: 1,
            shippingAddress: {
              firstName: "Test",
              lastName: "Customer",
              addressLine1: "123 Test St",
              city: "Portland",
              state: "OR",
              postCode: "97201",
              country: "US",
              email: "test@example.com",
            },
            product: {
              name: "Manual provider test product",
              price: 25,
              currency: "USD",
              fulfillmentProvider: "manual",
              metadata: {
                providerDetails: {
                  manual: {
                    notificationEmails: ["orders@nearmerch.com"],
                    ownerAccountIds: ["test.near"],
                    replyToEmail: "orders@nearmerch.com",
                  },
                },
              },
            },
          }}
        />

        <ProviderTestPanel
          provider="printful"
          title="Printful"
          description="Quote, checkout, paid webhook, and Printful webhook simulation."
          defaultScenario={{
            quantity: 1,
            shippingAddress: {
              firstName: "Test",
              lastName: "Customer",
              addressLine1: "123 Test St",
              city: "Portland",
              state: "OR",
              postCode: "97201",
              country: "US",
              email: "test@example.com",
            },
            product: {
              name: "Printful provider test product",
              price: 25,
              currency: "USD",
              fulfillmentProvider: "printful",
              variants: [
                {
                  id: "printful-test-variant",
                  name: "Default",
                  price: 25,
                  currency: "USD",
                  attributes: [],
                  fulfillmentConfig: {
                    providerName: "printful",
                    providerConfig: {},
                    files: [],
                  },
                  inStock: true,
                },
              ],
            },
          }}
        />

        <ProviderTestPanel
          provider="qikink"
          title="Qikink"
          description="India fulfillment provider. Provider tests use your Qikink My Products SKU (Unisex Oversized Raglan / UOsRgHs-BkCm-XS)."
          defaultScenario={{
            quantity: 1,
            shippingAddress: {
              firstName: "Test",
              lastName: "Customer",
              addressLine1: "123 Main Street",
              city: "Mumbai",
              state: "Maharashtra",
              postCode: "400001",
              country: "IN",
              email: "test@example.com",
              phone: "9876543210",
            },
            product: {
              name: "Unisex Oversized Raglan",
              price: 25,
              currency: "USD",
              fulfillmentProvider: "qikink",
            },
          }}
        />

        <ProviderTestPanel
          provider="lulu"
          title="Lulu"
          description="Quote, checkout, paid webhook, and Lulu print-job webhook simulation."
          defaultScenario={{
            quantity: 1,
            shippingAddress: {
              firstName: "Test",
              lastName: "Customer",
              addressLine1: "123 Test St",
              city: "Portland",
              state: "OR",
              postCode: "97201",
              country: "US",
              email: "test@example.com",
            },
            product: {
              name: "Lulu provider test product",
              price: 25,
              currency: "USD",
              fulfillmentProvider: "lulu",
              variants: [
                {
                  id: "lulu-test-variant",
                  name: "Default",
                  price: 25,
                  currency: "USD",
                  attributes: [],
                  fulfillmentConfig: {
                    providerName: "lulu",
                    providerConfig: {
                      podPackageId: "TEST",
                      pageCount: 32,
                      coverPdfUrl: "https://example.com/cover.pdf",
                      interiorPdfUrl: "https://example.com/interior.pdf",
                      shippingLevel: "MAIL",
                    },
                    files: [],
                  },
                  inStock: true,
                },
              ],
            },
          }}
        />
      </div>
    </div>
  );
}
