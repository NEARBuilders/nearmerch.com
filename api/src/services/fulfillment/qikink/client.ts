import { FulfillmentError } from '../errors';
import { QIKINK_ORDER_CREATE_PATH } from './orders';
import {
  resolveQikinkBaseUrl,
  type QikinkClientConfig,
  type QikinkCreateOrderPayload,
  type QikinkFetch,
  type QikinkTokenResponse,
} from './types';

const TOKEN_REFRESH_BUFFER_MS = 60_000;

export class QikinkClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: QikinkFetch;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenRequest: Promise<string> | null = null;

  constructor(config: QikinkClientConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = resolveQikinkBaseUrl(config.environment, config.baseUrl);
    this.fetchImpl = config.fetch ?? fetch;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }

    if (this.tokenRequest) {
      return this.tokenRequest;
    }

    this.tokenRequest = this.fetchAccessToken().finally(() => {
      this.tokenRequest = null;
    });

    return this.tokenRequest;
  }

  async ping(): Promise<void> {
    await this.getAccessToken();
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('ClientId', this.clientId);
    headers.set('Accesstoken', token);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (response.status === 429) {
      throw FulfillmentError.fromHttpStatus(
        429,
        'qikink',
        await readErrorMessage(response, 'Qikink rate limit exceeded'),
      );
    }

    return response;
  }

  async createOrder(payload: QikinkCreateOrderPayload): Promise<unknown> {
    const response = await this.request(QIKINK_ORDER_CREATE_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw FulfillmentError.fromHttpStatus(
        response.status,
        'qikink',
        await readErrorMessage(response, `Qikink create order failed: ${response.status}`),
      );
    }

    try {
      return await response.json();
    } catch {
      return { order_number: payload.order_number };
    }
  }

  private async fetchAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      ClientId: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await this.fetchImpl(`${this.baseUrl}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      throw FulfillmentError.fromHttpStatus(
        response.status,
        'qikink',
        await readErrorMessage(response, `Qikink auth failed: ${response.status}`),
      );
    }

    const data = (await response.json()) as QikinkTokenResponse;
    if (!data.Accesstoken) {
      throw new FulfillmentError({
        message: 'Qikink auth failed: Accesstoken missing from token response',
        code: 'AUTHENTICATION_FAILED',
        provider: 'qikink',
      });
    }

    this.accessToken = data.Accesstoken;
    const expiresInSeconds = typeof data.expires_in === 'number' && data.expires_in > 0
      ? data.expires_in
      : 3600;
    this.tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
    return data.Accesstoken;
  }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    return text || fallback;
  } catch {
    return fallback;
  }
}
