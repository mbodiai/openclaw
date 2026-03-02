import { createSessionManagerRuntimeRegistry } from "./session-manager-runtime-registry.js";

export type CompactionCancelReasonRuntimeValue = {
  reason: string;
  timestamp: number;
};

const registry = createSessionManagerRuntimeRegistry<CompactionCancelReasonRuntimeValue>();

export const setCompactionCancelReason = (sessionManager: unknown, reason: string): void => {
  const trimmed = reason.trim();
  if (!trimmed) {
    return;
  }
  registry.set(sessionManager, { reason: trimmed, timestamp: Date.now() });
};

export const consumeCompactionCancelReason = (sessionManager: unknown): string | null => {
  const value = registry.get(sessionManager);
  if (!value) {
    return null;
  }
  registry.set(sessionManager, null);
  return value.reason;
};
