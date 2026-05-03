import type { GatewayRequest, ProviderResponse, StreamChunk } from '../types.js';

export interface ProviderClient {
  readonly name: string;
  complete(request: GatewayRequest): Promise<ProviderResponse>;
  stream(request: GatewayRequest): AsyncIterable<StreamChunk>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly provider: string) {
    super(message);
    this.name = 'ProviderError';
  }
}
