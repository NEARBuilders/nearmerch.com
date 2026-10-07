import { createPluginRuntime } from 'every-plugin';
import { ContractRouterClient } from 'every-plugin/orpc';
import { FulfillmentContract } from './services/fulfillment';
import type { SyncProgressEvent } from './services/fulfillment/schema';
import type { ProductWithImages, Product } from './schema';
import PrintfulPlugin from './services/fulfillment/printful';
import LuluPlugin from './services/fulfillment/lulu';
import ManualPlugin from './services/fulfillment/manual';
import QikinkPlugin, { resolveQikinkEnvironment } from './services/fulfillment/qikink';
import { PaymentContract } from './services/payment';
import PingPayPlugin from './services/payment/pingpay';
import StripePlugin from './services/payment/stripe';
import {
	ExclusiveCheckContract,
	LegionHolderPlugin,
	WhitelistPlugin,
} from './services/exclusive';
import R2Plugin from './services/storage/r2';
import S3Plugin from './services/storage/s3';
import { StorageContract } from './services/storage/contract';

export interface FulfillmentConfig {
	printful?: {
		apiKey: string;
		storeId: string;
		webhookSecret?: string;
	};
	lulu?: {
		clientKey: string;
		clientSecret: string;
		environment?: 'sandbox' | 'production';
	};
	manual?: {
		notificationEmails?: string[];
		fromEmail?: string;
	};
	qikink?: {
		clientId: string;
		clientSecret: string;
		environment?: string;
	};
}

export interface PaymentConfig {
	stripe?: {
		secretKey: string;
		webhookSecret: string;
	};
	ping?: {
		apiKey?: string;
		webhookSecret?: string;
		recipientAddress?: string;
		baseUrl?: string;
	};
}

export interface ExclusiveCheckConfig {
	nodeUrl: string;
}

export interface StorageConfig {
	provider: 'r2' | 's3';
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	endpoint?: string;
	publicUrl?: string;
	region?: string;
}

export interface FulfillmentSyncCapability {
  syncProducts(
    upsertProduct: (product: ProductWithImages, syncedAt?: Date) => Promise<Product>,
    signal?: AbortSignal
  ): AsyncGenerator<SyncProgressEvent>;
}

export interface FulfillmentProvider {
	name: string;
	client: ContractRouterClient<typeof FulfillmentContract>;
	router: any;
	service?: FulfillmentSyncCapability;
}

export interface PaymentProvider {
	name: string;
	client: ContractRouterClient<typeof PaymentContract>;
	router: any;
}

export interface ExclusiveCheckProvider {
	name: string;
	client: ContractRouterClient<typeof ExclusiveCheckContract>;
	router: any;
}

export interface StorageProvider {
	name: string;
	client: ContractRouterClient<typeof StorageContract>;
	router: any;
}

export async function createMarketplaceRuntime(
	fulfillmentConfig: FulfillmentConfig,
	paymentConfig?: PaymentConfig,
	exclusiveCheckConfig?: ExclusiveCheckConfig,
	storageConfig?: StorageConfig,
	options?: { hostUrl?: string },
): Promise<MarketplaceRuntime> {
	const runtime = createPluginRuntime({
		registry: {
			printful: { module: PrintfulPlugin },
			lulu: { module: LuluPlugin },
			manual: { module: ManualPlugin },
			qikink: { module: QikinkPlugin },
			stripe: { module: StripePlugin },
			pingpay: { module: PingPayPlugin },
			'legion-holder': { module: LegionHolderPlugin },
			whitelist: { module: WhitelistPlugin },
			r2: { module: R2Plugin },
			s3: { module: S3Plugin },
		},
		secrets: {},
	});

	const providers: FulfillmentProvider[] = [];
	const paymentProviders: PaymentProvider[] = [];
	const exclusiveCheckProviders: ExclusiveCheckProvider[] = [];
	const storageProviders: StorageProvider[] = [];

	if (fulfillmentConfig.printful?.apiKey && fulfillmentConfig.printful?.storeId) {
		try {
			const printful = await runtime.usePlugin('printful', {
				variables: {
					baseUrl: 'https://api.printful.com',
				},
				secrets: {
					PRINTFUL_API_KEY: fulfillmentConfig.printful.apiKey,
					PRINTFUL_STORE_ID: fulfillmentConfig.printful.storeId,
					PRINTFUL_WEBHOOK_SECRET: fulfillmentConfig.printful.webhookSecret,
				},
			});
			providers.push({
				name: 'printful',
				client: printful.createClient(),
				router: printful.router,
				service: printful.initialized.context.service,
			});
			console.log('[MarketplaceRuntime] Printful provider initialized');
		} catch (error) {
			console.error('[MarketplaceRuntime] Failed to initialize Printful:', error);
		}
	}

	if (fulfillmentConfig.lulu?.clientKey && fulfillmentConfig.lulu?.clientSecret) {
		try {
			const lulu = await runtime.usePlugin('lulu', {
				variables: {
					baseUrl: fulfillmentConfig.lulu.environment === 'production' ? 'https://api.lulu.com' : 'https://api.sandbox.lulu.com',
					environment: fulfillmentConfig.lulu.environment || 'sandbox',
				},
				secrets: {
					LULU_CLIENT_KEY: fulfillmentConfig.lulu.clientKey,
					LULU_CLIENT_SECRET: fulfillmentConfig.lulu.clientSecret,
				},
			});
			providers.push({
				name: 'lulu',
				client: lulu.createClient(),
				router: lulu.router,
			});
			console.log('[MarketplaceRuntime] Lulu provider initialized');
		} catch (error) {
			console.error('[MarketplaceRuntime] Failed to initialize Lulu:', error);
		}
	}

	if (fulfillmentConfig.manual) {
		try {
			const manual = await runtime.usePlugin('manual', {
				variables: {},
				secrets: {
					MANUAL_FULFILLMENT_FROM_EMAIL: fulfillmentConfig.manual.fromEmail ?? '',
				},
			});
			providers.push({
				name: 'manual',
				client: manual.createClient(),
				router: manual.router,
			});
			console.log('[MarketplaceRuntime] Manual provider initialized');
		} catch (error) {
			console.error('[MarketplaceRuntime] Failed to initialize Manual provider:', error);
		}
	} else {
		try {
			const manual = await runtime.usePlugin('manual', {
				variables: {},
				secrets: {},
			});
			providers.push({
				name: 'manual',
				client: manual.createClient(),
				router: manual.router,
			});
			console.log('[MarketplaceRuntime] Manual provider initialized (no config)');
		} catch (error) {
			console.error('[MarketplaceRuntime] Failed to initialize Manual provider:', error);
		}
	}

	if (fulfillmentConfig.qikink?.clientId && fulfillmentConfig.qikink?.clientSecret) {
		try {
			const qikink = await runtime.usePlugin('qikink', {
				variables: {
					environment: resolveQikinkEnvironment(fulfillmentConfig.qikink.environment),
				},
				secrets: {
					QIKINK_CLIENT_ID: fulfillmentConfig.qikink.clientId,
					QIKINK_CLIENT_SECRET: fulfillmentConfig.qikink.clientSecret,
				},
			});
			providers.push({
				name: 'qikink',
				client: qikink.createClient(),
				router: qikink.router,
			});
			console.log('[MarketplaceRuntime] Qikink provider initialized');
		} catch (error) {
			console.error('[MarketplaceRuntime] Failed to initialize Qikink:', error);
		}
	}

	if (storageConfig) {
		try {
			const pluginName = storageConfig.provider === 's3' ? 's3' : 'r2';
			const storage = await runtime.usePlugin(pluginName, {
				variables: {
					bucket: storageConfig.bucket,
					...(storageConfig.region ? { region: storageConfig.region } : {}),
					...(storageConfig.endpoint ? { endpoint: storageConfig.endpoint } : {}),
					...(storageConfig.publicUrl ? { publicUrl: storageConfig.publicUrl } : {}),
				},
				secrets: {
					ACCESS_KEY_ID: storageConfig.accessKeyId,
					SECRET_ACCESS_KEY: storageConfig.secretAccessKey,
				},
			});
			storageProviders.push({
				name: storageConfig.provider,
				client: storage.createClient(),
				router: storage.router,
			});
			console.log(`[MarketplaceRuntime] ${storageConfig.provider.toUpperCase()} storage provider initialized`);
		} catch (error) {
			console.error(`[MarketplaceRuntime] Failed to initialize ${storageConfig.provider.toUpperCase()} storage:`, error);
		}
	}

	if (paymentConfig?.ping) {
		try {
			const pingpay = await runtime.usePlugin('pingpay', {
				variables: {
					...(paymentConfig.ping.recipientAddress ? { recipientAddress: paymentConfig.ping.recipientAddress } : {}),
					...(paymentConfig.ping.baseUrl ? { baseUrl: paymentConfig.ping.baseUrl } : {}),
				},
				secrets: {
					PING_API_KEY: paymentConfig.ping.apiKey ?? '',
					PING_WEBHOOK_SECRET: paymentConfig.ping.webhookSecret ?? '',
				},
			});
			paymentProviders.push({
				name: 'pingpay',
				client: pingpay.createClient(),
				router: pingpay.router,
			});
			console.log('[MarketplaceRuntime] PingPay provider initialized');
		} catch (error) {
			console.error('[MarketplaceRuntime] Failed to initialize PingPay:', error);
		}
	}

	if (paymentConfig?.stripe?.secretKey && paymentConfig?.stripe?.webhookSecret) {
		try {
			const stripe = await runtime.usePlugin('stripe', {
				variables: {},
				secrets: {
					STRIPE_SECRET_KEY: paymentConfig.stripe.secretKey,
					STRIPE_WEBHOOK_SECRET: paymentConfig.stripe.webhookSecret,
				},
			});
			paymentProviders.push({
				name: 'stripe',
				client: stripe.createClient(),
				router: stripe.router,
			});
			console.log('[MarketplaceRuntime] Stripe provider initialized');
		} catch (error) {
			console.error('[MarketplaceRuntime] Failed to initialize Stripe:', error);
		}
	}

	try {
		const legionHolder = await runtime.usePlugin('legion-holder', {
			variables: {
				nodeUrl: exclusiveCheckConfig?.nodeUrl || 'https://rpc.mainnet.near.org',
			},
			secrets: {},
		});
		exclusiveCheckProviders.push({
			name: 'legion-holder',
			client: legionHolder.createClient(),
			router: legionHolder.router,
		});
		console.log('[MarketplaceRuntime] Legion holder exclusive check provider initialized');
	} catch (error) {
		console.error('[MarketplaceRuntime] Failed to initialize Legion holder provider:', error);
	}

	try {
		const whitelist = await runtime.usePlugin('whitelist', {
			variables: {},
			secrets: {},
		});
		exclusiveCheckProviders.push({
			name: 'whitelist',
			client: whitelist.createClient(),
			router: whitelist.router,
		});
		console.log('[MarketplaceRuntime] Whitelist exclusive check provider initialized');
	} catch (error) {
		console.error('[MarketplaceRuntime] Failed to initialize Whitelist:', error);
	}

	console.log(`[MarketplaceRuntime] Enabled fulfillment providers: ${providers.map((p) => p.name).join(', ') || 'none'}`);
	console.log(`[MarketplaceRuntime] Enabled payment providers: ${paymentProviders.map((p) => p.name).join(', ') || 'none'}`);
	console.log(`[MarketplaceRuntime] Enabled exclusive check providers: ${exclusiveCheckProviders.map((p) => p.name).join(', ') || 'none'}`);

	return {
		providers,
		paymentProviders,
		exclusiveCheckProviders,
		storageProviders,
		fulfillmentConfig,
		hostUrl: options?.hostUrl,
		getProvider: (name: string) => providers.find((p) => p.name === name) ?? null,
		getPaymentProvider: (name: string) => paymentProviders.find((p) => p.name === name) ?? null,
		getExclusiveCheckProvider: (name: string) => exclusiveCheckProviders.find((p) => p.name === name) ?? null,
		getStorageProvider: () => storageProviders[0] ?? null,
		shutdown: () => runtime.shutdown(),
	} as const;
}

export interface MarketplaceRuntime {
	readonly providers: FulfillmentProvider[];
	readonly paymentProviders: PaymentProvider[];
	readonly exclusiveCheckProviders: ExclusiveCheckProvider[];
	readonly storageProviders: StorageProvider[];
	readonly fulfillmentConfig: FulfillmentConfig;
	readonly hostUrl?: string;
	readonly getProvider: (name: string) => FulfillmentProvider | null;
	readonly getPaymentProvider: (name: string) => PaymentProvider | null;
	readonly getExclusiveCheckProvider: (name: string) => ExclusiveCheckProvider | null;
	readonly getStorageProvider: () => StorageProvider | null;
	readonly shutdown: () => Promise<void>;
}
