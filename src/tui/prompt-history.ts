export type PromptHistorySeedOptions = {
  /**
   * Maximum number of prompts to keep per session.
   * Oldest entries are dropped first.
   */
  maxEntries?: number;
};

type SessionHistoryState = {
  prompts: string[];
  clearedBuffer: string | null;
};

const DEFAULT_MAX_ENTRIES = 200;

function normalizePrompt(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export class PromptHistoryStore {
  readonly #sessions = new Map<string, SessionHistoryState>();
  readonly #maxEntries: number;

  constructor(options?: { maxEntries?: number }) {
    const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#maxEntries = Number.isFinite(maxEntries)
      ? Math.max(20, Math.floor(maxEntries))
      : DEFAULT_MAX_ENTRIES;
  }

  #getSession(key: string): SessionHistoryState {
    const existing = this.#sessions.get(key);
    if (existing) {
      return existing;
    }
    const created: SessionHistoryState = { prompts: [], clearedBuffer: null };
    this.#sessions.set(key, created);
    return created;
  }

  noteClearedBuffer(sessionKey: string, value: string): void {
    const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.trim()) {
      return;
    }
    this.#getSession(sessionKey).clearedBuffer = normalized;
  }

  getClearedBuffer(sessionKey: string): string | null {
    return this.#getSession(sessionKey).clearedBuffer;
  }

  clearClearedBuffer(sessionKey: string): void {
    this.#getSession(sessionKey).clearedBuffer = null;
  }

  addPrompt(sessionKey: string, value: string): void {
    const normalized = normalizePrompt(value);
    if (!normalized) {
      return;
    }
    const session = this.#getSession(sessionKey);
    const last = session.prompts.at(-1);
    if (last === normalized) {
      return;
    }
    session.prompts.push(normalized);
    if (session.prompts.length > this.#maxEntries) {
      session.prompts.splice(0, session.prompts.length - this.#maxEntries);
    }
  }

  seedPrompts(
    sessionKey: string,
    promptsOldestFirst: string[],
    options?: PromptHistorySeedOptions,
  ): void {
    const maxEntries = options?.maxEntries ?? this.#maxEntries;
    const session = this.#getSession(sessionKey);
    const seen = new Set(session.prompts);
    for (const raw of promptsOldestFirst) {
      const normalized = normalizePrompt(raw);
      if (!normalized) {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      session.prompts.push(normalized);
      seen.add(normalized);
    }
    if (session.prompts.length > maxEntries) {
      session.prompts.splice(0, session.prompts.length - maxEntries);
    }
  }

  /**
   * Return stored prompts in chronological order (oldest -> newest).
   */
  list(sessionKey: string): readonly string[] {
    return this.#getSession(sessionKey).prompts;
  }

  /**
   * Return unique matches ordered by recency (newest -> oldest).
   */
  findMatchesByPrefix(sessionKey: string, prefix: string): string[] {
    if (!prefix) {
      return [];
    }
    const prompts = this.#getSession(sessionKey).prompts;
    const matches: string[] = [];
    const seen = new Set<string>();
    for (let i = prompts.length - 1; i >= 0; i -= 1) {
      const entry = prompts[i];
      if (!entry || entry === prefix) {
        continue;
      }
      if (!entry.startsWith(prefix)) {
        continue;
      }
      if (seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      matches.push(entry);
    }
    return matches;
  }

  /**
   * Return the most recent matching prompt (newest match).
   */
  findAutosuggest(sessionKey: string, prefix: string): string | null {
    const [first] = this.findMatchesByPrefix(sessionKey, prefix);
    return first ?? null;
  }
}
