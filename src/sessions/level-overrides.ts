import { normalizeVerboseLevel, type VerboseLevel } from "../auto-reply/thinking.js";
import type { SessionEntry } from "../config/sessions.js";

export function parseVerboseOverride(
  raw: unknown,
): { ok: true; value: VerboseLevel | null | undefined } | { ok: false; error: string } {
  if (raw === null) {
    return { ok: true, value: null };
  }
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: 'invalid verboseLevel (use "on"|"off"|"full")' };
  }
  const normalized = normalizeVerboseLevel(raw);
  if (!normalized) {
    return { ok: false, error: 'invalid verboseLevel (use "on"|"off"|"full")' };
  }
  return { ok: true, value: normalized };
}

export function applyVerboseOverride(entry: SessionEntry, level: VerboseLevel | null | undefined) {
  if (level === undefined) {
    return;
  }
  if (level === null) {
    delete entry.verboseLevel;
    markExplicitLevel(entry, "verbose", false);
    return;
  }
  entry.verboseLevel = level;
  markExplicitLevel(entry, "verbose", true);
}

export function markExplicitLevel(entry: SessionEntry, key: string, explicit: boolean) {
  const set = new Set(entry.explicitLevels ?? []);
  if (explicit) {
    set.add(key);
  } else {
    set.delete(key);
  }
  entry.explicitLevels = set.size > 0 ? [...set] : undefined;
}

export function isExplicitLevel(entry: SessionEntry | undefined, key: string): boolean {
  return entry?.explicitLevels?.includes(key) ?? false;
}
