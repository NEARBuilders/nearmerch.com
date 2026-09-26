import { Data } from 'every-plugin/effect';

export type CheckoutErrorCode =
  | 'QUOTE_FAILED'
  | 'DRAFT_ORDER_FAILED'
  | 'PAYMENT_CHECKOUT_FAILED'
  | 'PRODUCT_NOT_FOUND'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'NO_SHIPPING_RATE_SELECTED'
  | 'INVALID_SHIPPING_RATE'
  | 'NO_RATES_AVAILABLE'
  | 'INVALID_ADDRESS'
  | 'VARIANT_UNAVAILABLE'
  | 'UNKNOWN';

export class CheckoutError extends Data.TaggedError('CheckoutError')<{
  readonly code: CheckoutErrorCode;
  readonly provider?: string;
  readonly orderId?: string;
  readonly productId?: string;
  readonly userId?: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    const context: string[] = [];
    
    if (this.provider) context.push(`provider=${this.provider}`);
    if (this.orderId) context.push(`orderId=${this.orderId}`);
    if (this.productId) context.push(`productId=${this.productId}`);
    if (this.userId) context.push(`userId=${this.userId}`);
    
    const contextStr = context.length > 0 ? ` [${context.join(', ')}]` : '';
    
    const causeMsg = this.cause instanceof Error 
      ? this.cause.message 
      : this.cause 
        ? String(this.cause) 
        : '';
    
    return `Checkout ${this.code}${contextStr}${causeMsg ? `: ${causeMsg}` : ''}`;
  }
}
