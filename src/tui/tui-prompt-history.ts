export type PromptHistoryDirection = "up" | "down";

type BrowseState =
  | { kind: "none"; draft: string }
  | { kind: "cleared"; draft: string }
  | { kind: "history"; draft: string; index: number };

type SessionState = {
  entries: string[]; // chronological: oldest -> newest
  browse: BrowseState;
  cleared: string | null;
  clearedUsed: boolean;
};

export class TuiPromptHistory {
  private readonly bySession = new Map<string, SessionState>();
  private readonly maxEntries: number;

  constructor(opts?: { maxEntries?: number }) {
    this.maxEntries = Math.max(10, opts?.maxEntries ?? 500);
  }

  private getState(sessionKey: string): SessionState {
    let state = this.bySession.get(sessionKey);
    if (!state) {
      state = {
        entries: [],
        browse: { kind: "none", draft: "" },
        cleared: null,
        clearedUsed: false,
      };
      this.bySession.set(sessionKey, state);
    }
    return state;
  }

  resetBrowse(sessionKey: string, draft?: string) {
    const state = this.getState(sessionKey);
    state.browse = { kind: "none", draft: draft ?? state.browse.draft };
    state.clearedUsed = false;
  }

  noteClearedBuffer(sessionKey: string, text: string) {
    const trimmed = text;
    if (!trimmed) {
      return;
    }
    const state = this.getState(sessionKey);
    state.cleared = trimmed;
    state.clearedUsed = false;
    state.browse = { kind: "none", draft: "" };
  }

  noteSubmitted(sessionKey: string, text: string) {
    const value = text.trim();
    if (!value) {
      return;
    }
    const state = this.getState(sessionKey);
    const last = state.entries[state.entries.length - 1];
    if (last === value) {
      return;
    }
    state.entries.push(value);
    if (state.entries.length > this.maxEntries) {
      state.entries.splice(0, state.entries.length - this.maxEntries);
    }
  }

  seedFromTranscript(sessionKey: string, texts: string[], opts?: { maxSeed?: number }) {
    const maxSeed = Math.max(1, opts?.maxSeed ?? 50);
    if (texts.length === 0) {
      return;
    }
    const state = this.getState(sessionKey);
    const existing = new Set(state.entries);
    const slice = texts.slice(Math.max(0, texts.length - maxSeed));
    for (const raw of slice) {
      const value = raw.trim();
      if (!value) {
        continue;
      }
      if (existing.has(value)) {
        continue;
      }
      state.entries.push(value);
      existing.add(value);
    }
    if (state.entries.length > this.maxEntries) {
      state.entries.splice(0, state.entries.length - this.maxEntries);
    }
  }

  navigate(sessionKey: string, direction: PromptHistoryDirection, currentText: string): string {
    const state = this.getState(sessionKey);
    const entries = state.entries;

    const draft = state.browse.draft;
    const ensureDraft = () => {
      if (state.browse.kind === "none") {
        state.browse = { kind: "none", draft: currentText };
      }
    };

    if (direction === "up") {
      if (entries.length === 0 && !state.cleared) {
        return currentText;
      }

      if (state.browse.kind === "none") {
        ensureDraft();
        if (state.cleared && !state.clearedUsed) {
          state.clearedUsed = true;
          state.browse = { kind: "cleared", draft: state.browse.draft };
          return state.cleared;
        }
        const index = entries.length - 1;
        state.browse = { kind: "history", draft: state.browse.draft, index };
        return entries[index] ?? currentText;
      }

      if (state.browse.kind === "cleared") {
        if (entries.length === 0) {
          return state.cleared ?? currentText;
        }
        const index = entries.length - 1;
        state.browse = { kind: "history", draft: state.browse.draft, index };
        return entries[index] ?? currentText;
      }

      // history
      const nextIndex = Math.max(0, state.browse.index - 1);
      state.browse = { ...state.browse, index: nextIndex };
      return entries[nextIndex] ?? currentText;
    }

    // down
    if (state.browse.kind === "none") {
      return currentText;
    }

    if (state.browse.kind === "cleared") {
      state.browse = { kind: "none", draft };
      return draft;
    }

    const nextIndex = state.browse.index + 1;
    if (nextIndex >= entries.length) {
      state.browse = { kind: "none", draft };
      return draft;
    }

    state.browse = { ...state.browse, index: nextIndex };
    return entries[nextIndex] ?? currentText;
  }

  getMatches(sessionKey: string, prefix: string): string[] {
    const state = this.getState(sessionKey);
    const p = prefix;
    if (!p) {
      return [];
    }
    const matches: string[] = [];
    for (let i = state.entries.length - 1; i >= 0; i -= 1) {
      const value = state.entries[i];
      if (value && value.startsWith(p)) {
        matches.push(value);
      }
    }
    return matches;
  }

  getAutosuggestRemainder(sessionKey: string, current: string): string | null {
    const matches = this.getMatches(sessionKey, current);
    const best = matches.find((m) => m !== current);
    if (!best) {
      return null;
    }
    return best.slice(current.length);
  }
}
