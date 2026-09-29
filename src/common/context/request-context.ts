import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request storage that follows the request through every `await`,
 * without passing `req` down through services.
 *
 * AsyncLocalStorage is Node's equivalent of a thread-local: the logging
 * middleware opens a store for each request, and deep inside ChatService we
 * can call recordAiUsage() and it lands on the right request's log entry.
 */
export interface RequestStore {
  providerId?: string;
  tokens?: number;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function recordAiUsage(providerId: string, tokens: number) {
  const store = requestContext.getStore();
  if (!store) return;
  store.providerId = providerId;
  store.tokens = (store.tokens ?? 0) + tokens;
}
