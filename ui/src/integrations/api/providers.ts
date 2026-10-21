import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/utils/orpc';
import type { ManualProviderSettings } from '../../../../api/src/schema';

export type ProviderConfig = Awaited<ReturnType<typeof apiClient.getProviderConfig>>['config'];
type ProviderName = Parameters<typeof apiClient.getProviderConfig>[0]['provider'];

type ConfigureWebhookParams = Parameters<typeof apiClient.configureWebhook>[0];
type ProviderWebhookEventType = NonNullable<ConfigureWebhookParams['events']>[number];
export type PrintfulWebhookEventType = Exclude<ProviderWebhookEventType, 'PRINT_JOB_STATUS_CHANGED' | 'ORDER_STATUS_CHANGED'>;
type LuluWebhookEventType = 'PRINT_JOB_STATUS_CHANGED';

const providerKeys = {
  all: ['providers'] as const,
  config: (provider: ProviderName) => [...providerKeys.all, 'config', provider] as const,
};

export function useConfigureWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      provider: ProviderName;
      webhookUrlOverride?: string;
      events?: ProviderWebhookEventType[];
      expiresAt?: string;
      settings?: ManualProviderSettings;
    }) => {
      return await apiClient.configureWebhook(params);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: providerKeys.config(variables.provider) });
    },
  });
}

export function useDisableWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { provider: ProviderName }) => {
      return await apiClient.disableWebhook(params);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: providerKeys.config(variables.provider) });
    },
  });
}

export function useTestProvider() {
  return useMutation({
    mutationFn: async (params: { provider: ProviderName }) => {
      return await apiClient.testProvider(params);
    },
  });
}

export const LULU_WEBHOOK_EVENTS: { value: LuluWebhookEventType; label: string; description: string }[] = [
  {
    value: 'PRINT_JOB_STATUS_CHANGED',
    label: 'Print Job Status Changed',
    description: 'Sent whenever a Lulu print job changes status',
  },
];

export const PRINTFUL_WEBHOOK_EVENTS: { value: PrintfulWebhookEventType; label: string; description: string }[] = [
  { value: 'shipment_sent', label: 'Shipment Sent', description: 'Order shipment has been dispatched' },
  { value: 'shipment_delivered', label: 'Shipment Delivered', description: 'Order shipment was delivered' },
  { value: 'shipment_returned', label: 'Shipment Returned', description: 'Shipment was returned' },
  { value: 'shipment_canceled', label: 'Shipment Canceled', description: 'Shipment was canceled' },
  { value: 'shipment_out_of_stock', label: 'Shipment Out of Stock', description: 'Shipment item is out of stock' },
  { value: 'shipment_put_hold', label: 'Shipment On Hold', description: 'Shipment was put on hold' },
  { value: 'shipment_put_hold_approval', label: 'Shipment Hold Approval', description: 'Shipment awaiting approval' },
  { value: 'shipment_remove_hold', label: 'Shipment Hold Removed', description: 'Shipment hold was removed' },
  { value: 'order_created', label: 'Order Created', description: 'Order was created in Printful' },
  { value: 'order_updated', label: 'Order Updated', description: 'Order was updated' },
  { value: 'order_canceled', label: 'Order Canceled', description: 'Order was canceled' },
  { value: 'order_failed', label: 'Order Failed', description: 'Order processing failed' },
  { value: 'order_put_hold', label: 'Order On Hold', description: 'Order was put on hold' },
  { value: 'order_put_hold_approval', label: 'Order Hold Approval', description: 'Order is awaiting approval' },
  { value: 'order_remove_hold', label: 'Order Hold Removed', description: 'Order hold was removed' },
  { value: 'catalog_stock_updated', label: 'Catalog Stock Updated', description: 'Product stock was updated' },
  { value: 'catalog_price_changed', label: 'Catalog Price Changed', description: 'Product price was changed' },
  { value: 'mockup_task_finished', label: 'Mockup Task Finished', description: 'Mockup generation completed' },
];

export const MANUAL_WEBHOOK_EVENTS: { value: 'ORDER_STATUS_CHANGED'; label: string; description: string }[] = [
  {
    value: 'ORDER_STATUS_CHANGED',
    label: 'Order Status Changed',
    description: 'Sent whenever a manual fulfillment order changes status',
  },
];
