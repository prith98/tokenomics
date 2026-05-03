import { EventEmitter } from 'node:events';
import type { CostEvent } from '../types.js';

export interface PolicyReloadedEvent {
  rules: number;
  path: string;
  at: string;
}

export interface GatewayBusEvents {
  costEvent: (event: CostEvent) => void;
  policyReloaded: (event: PolicyReloadedEvent) => void;
}

class TypedEmitter extends EventEmitter {
  emit<E extends keyof GatewayBusEvents>(
    event: E,
    ...args: Parameters<GatewayBusEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }
  on<E extends keyof GatewayBusEvents>(event: E, listener: GatewayBusEvents[E]): this {
    return super.on(event, listener as (...a: unknown[]) => void);
  }
  off<E extends keyof GatewayBusEvents>(event: E, listener: GatewayBusEvents[E]): this {
    return super.off(event, listener as (...a: unknown[]) => void);
  }
}

export const bus: TypedEmitter = new TypedEmitter();
bus.setMaxListeners(0);
