import { describe, expect, it } from 'vitest';
import { computePrintfulUpdate, parsePrintfulWebhook } from '../../src/services/fulfillment/printful/webhook';

describe('parsePrintfulWebhook', () => {
  it('reads external_id from data.order', () => {
    const parsed = parsePrintfulWebhook(JSON.stringify({
      type: 'shipment_sent',
      data: {
        order: { id: 94188299, external_id: 'ext-order-ref-123' },
        shipment: { tracking_number: '1Z999', tracking_url: 'https://track.example/1Z999', service: 'UPS' },
      },
    }));

    expect(parsed.eventType).toBe('shipment_sent');
    expect(parsed.externalId).toBe('ext-order-ref-123');
    expect(parsed.printfulOrderId).toBe('94188299');
  });

  it('reads identifiers from shipment.order_external_id and shipment.order_id', () => {
    const parsed = parsePrintfulWebhook(JSON.stringify({
      type: 'shipment_sent',
      data: {
        shipment: {
          order_id: 94188299,
          order_external_id: 'ext-order-ref-123',
          tracking_number: '1Z999',
          tracking_url: 'https://track.example/1Z999',
          service: 'UPS',
        },
      },
    }));

    expect(parsed.externalId).toBe('ext-order-ref-123');
    expect(parsed.printfulOrderId).toBe('94188299');
  });

  it('reads identifiers from nested shipment.order', () => {
    const parsed = parsePrintfulWebhook(JSON.stringify({
      type: 'package_shipped',
      data: {
        shipment: {
          tracking_number: '1Z999',
          order: { id: 'PF94188299', external_id: 'ext-order-ref-123' },
        },
      },
    }));

    expect(parsed.eventType).toBe('package_shipped');
    expect(parsed.externalId).toBe('ext-order-ref-123');
    expect(parsed.printfulOrderId).toBe('PF94188299');
  });
});

describe('computePrintfulUpdate', () => {
  it('maps package_shipped to shipped with tracking', () => {
    const update = computePrintfulUpdate({
      eventType: 'package_shipped',
      currentStatus: 'processing',
      data: {
        shipment: {
          tracking_number: '1Z999',
          tracking_url: 'https://track.example/1Z999',
          carrier: 'UPS',
        },
      },
    });

    expect(update.newStatus).toBe('shipped');
    expect(update.newTracking?.[0]?.trackingCode).toBe('1Z999');
    expect(update.newTracking?.[0]?.shipmentMethodName).toBe('UPS');
  });

  it('does not downgrade a delivered order on a late shipment_sent event', () => {
    const update = computePrintfulUpdate({
      eventType: 'shipment_sent',
      currentStatus: 'delivered',
      data: {
        shipment: {
          tracking_number: '1Z999',
          tracking_url: 'https://track.example/1Z999',
          service: 'UPS',
        },
      },
    });

    expect(update.newStatus).toBeUndefined();
    expect(update.newTracking?.[0]?.trackingCode).toBe('1Z999');
  });
});
