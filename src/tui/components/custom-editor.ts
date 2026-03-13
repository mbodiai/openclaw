import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Editor, Key, matchesKey } from "@mariozechner/pi-tui";
import type { TuiPromptHistory } from "../tui-prompt-history.js";

type CompletionCycle =
  | {
      mode: "history";
      sessionKey: string;
      prefix: string;
      candidates: string[];
      index: number;
    }
  | {
      mode: "bang";
      sessionKey: string;
      prefix: string;
      before: string;
      candidates: string[];
      index: number;
    };

export type CustomEditorOptions = {
  promptHistory?: TuiPromptHistory;
  getSessionKey?: () => string;
};

export class CustomEditor extends Editor {
  onEscape?: () => void;
  onCtrlC?: () => void;
  onCtrlD?: () => void;
  onCtrlG?: () => void;
  onCtrlL?: () => void;
  onCtrlO?: () => void;
  onCtrlP?: () => void;
  onCtrlT?: () => void;
  onCtrlY?: () => void;
  onShiftTab?: () => void;
  onAltEnter?: () => void;
  onAltUp?: () => void;

  private readonly promptHistory?: TuiPromptHistory;
  private readonly getSessionKey: () => string;
  private completionCycle: CompletionCycle | null = null;

  constructor(
    tui: ConstructorParameters<typeof Editor>[0],
    theme: ConstructorParameters<typeof Editor>[1],
    options?: ConstructorParameters<typeof Editor>[2] & CustomEditorOptions,
  ) {
    super(tui, theme, options);
    this.promptHistory = options?.promptHistory;
    this.getSessionKey = options?.getSessionKey ?? (() => "unknown");
  }

  private clearCycle() {
    this.completionCycle = null;
  }

  private isSingleLineAtEnd(): boolean {
    const text = this.getText();
    if (text.includes("\n")) {
      return false;
    }
    const cursor = this.getCursor();
    return cursor.line === 0 && cursor.col === text.length;
  }

  private isFileRefContext(textBeforeCursor: string): boolean {
    return /(?:^|\s)@[^\s]*$/.test(textBeforeCursor);
  }

  private handleHistoryNavigate(direction: "up" | "down"): boolean {
    if (!this.promptHistory) {
      return false;
    }
    if (this.isShowingAutocomplete()) {
      return false;
    }

    const text = this.getText();
    if (text.includes("\n")) {
      return false;
    }

    const cursor = this.getCursor();
    const atEnd = cursor.line === 0 && cursor.col === text.length;
    const empty = text.length === 0;
    if (!atEnd && !empty) {
      return false;
    }

    const sessionKey = this.getSessionKey();
    const next = this.promptHistory.navigate(sessionKey, direction, text);
    if (next === text) {
      return true;
    }
    this.setText(next);
    this.clearCycle();
    return true;
  }

  private listExecutablesFromPath(prefix: string): string[] {
    const envPath = process.env.PATH ?? "";
    if (!envPath) {
      return [];
    }
    const results = new Set<string>();
    for (const dir of envPath.split(path.delimiter)) {
      if (!dir) {
        continue;
      }
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.startsWith(prefix)) {
          continue;
        }
        const full = path.join(dir, name);
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) {
            continue;
          }
          // best-effort executable check; on Windows this is fine too.
          fs.accessSync(full, fs.constants.X_OK);
          results.add(name);
        } catch {
          // ignore
        }
      }
    }
    return [...results].toSorted();
  }

  private expandHome(p: string): string {
    if (p === "~") {
      return os.homedir();
    }
    if (p.startsWith("~/")) {
      return path.join(os.homedir(), p.slice(2));
    }
    return p;
  }

  private listPathCandidates(token: string): { candidates: string[]; replace: string } {
    const expanded = this.expandHome(token);
    const hasDir = expanded.includes("/") || expanded.includes(path.sep);
    const dir = hasDir ? path.dirname(expanded) : ".";
    const base = hasDir ? path.basename(expanded) : expanded;

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return { candidates: [], replace: token };
    }

    const candidates: string[] = [];
    for (const name of entries) {
      if (!name.startsWith(base)) {
        continue;
      }
      const full = path.join(dir, name);
      let isDir = false;
      try {
        isDir = fs.statSync(full).isDirectory();
      } catch {
        // ignore
      }
      const rel = hasDir ? path.join(path.dirname(expanded), name) : name;
      let rendered = rel;
      if (isDir) {
        rendered += "/";
      }
      // restore ~ prefix if the user used it
      if (token.startsWith("~/")) {
        const withoutHome = rendered.startsWith(os.homedir())
          ? `~/${path.relative(os.homedir(), rendered)}`
          : rendered;
        rendered = withoutHome;
      } else if (token === "~") {
        rendered = "~/";
      }
      candidates.push(rendered);
    }

    return { candidates: candidates.toSorted(), replace: token };
  }

  private handleBangTabCompletion(): boolean {
    if (!this.isSingleLineAtEnd()) {
      return false;
    }
    const text = this.getText();
    if (!text.startsWith("!")) {
      return false;
    }
    if (text === "!") {
      return false;
    }

    const sessionKey = this.getSessionKey();
    const cmdline = text.slice(1);

    const match = cmdline.match(/^(.*?)([^\s]*)$/);
    const before = match?.[1] ?? "";
    const token = match?.[2] ?? "";

    const isFirstToken = before.trim().length === 0 && !cmdline.trim().includes(" ");

    const cycleKey = `${before}::${token}`;
    if (
      this.completionCycle?.mode === "bang" &&
      this.completionCycle.sessionKey === sessionKey &&
      this.completionCycle.prefix === cycleKey
    ) {
      const nextIndex = (this.completionCycle.index + 1) % this.completionCycle.candidates.length;
      this.completionCycle.index = nextIndex;
      const cand = this.completionCycle.candidates[nextIndex];
      this.setText(`!${before}${cand}`);
      return true;
    }

    const candidates = isFirstToken
      ? this.listExecutablesFromPath(token)
      : this.listPathCandidates(token).candidates;

    if (candidates.length === 0) {
      this.clearCycle();
      return false;
    }

    if (candidates.length === 1) {
      this.setText(`!${before}${candidates[0]}`);
      this.clearCycle();
      return true;
    }

    this.completionCycle = {
      mode: "bang",
      sessionKey,
      prefix: cycleKey,
      before,
      candidates,
      index: 0,
    };
    this.setText(`!${before}${candidates[0]}`);
    return true;
  }

  private handleHistoryTabCompletion(): boolean {
    if (!this.promptHistory) {
      return false;
    }
    if (!this.isSingleLineAtEnd()) {
      return false;
    }

    const sessionKey = this.getSessionKey();
    const text = this.getText();
    const value = text;
    if (!value || value.startsWith("/") || value.startsWith("!")) {
      return false;
    }

    const cycle = this.completionCycle;
    if (cycle?.mode === "history" && cycle.sessionKey === sessionKey && cycle.prefix === value) {
      const nextIndex = (cycle.index + 1) % cycle.candidates.length;
      cycle.index = nextIndex;
      this.setText(cycle.candidates[nextIndex]);
      return true;
    }

    const matches = this.promptHistory.getMatches(sessionKey, value);
    if (matches.length === 0) {
      this.clearCycle();
      return false;
    }
    if (matches.length === 1) {
      this.setText(matches[0]);
      this.clearCycle();
      return true;
    }

    this.completionCycle = {
      mode: "history",
      sessionKey,
      prefix: value,
      candidates: matches,
      index: 0,
    };
    this.setText(matches[0]);
    return true;
  }

  handleInput(data: string): void {
    const beforeText = this.getText();

    if (matchesKey(data, Key.alt("up")) && this.onAltUp) {
      this.onAltUp();
      return;
    }

    if (matchesKey(data, Key.alt("enter")) && this.onAltEnter) {
      this.onAltEnter();
      return;
    }
    if (matchesKey(data, Key.ctrl("l")) && this.onCtrlL) {
      this.onCtrlL();
      return;
    }
    if (matchesKey(data, Key.ctrl("o")) && this.onCtrlO) {
      this.onCtrlO();
      return;
    }
    if (matchesKey(data, Key.ctrl("p")) && this.onCtrlP) {
      this.onCtrlP();
      return;
    }
    if (matchesKey(data, Key.ctrl("g")) && this.onCtrlG) {
      this.onCtrlG();
      return;
    }
    if (matchesKey(data, Key.ctrl("t")) && this.onCtrlT) {
      this.onCtrlT();
      return;
    }
    if (matchesKey(data, Key.ctrl("y")) && this.onCtrlY) {
      this.onCtrlY();
      return;
    }
    if (matchesKey(data, Key.shift("tab")) && this.onShiftTab) {
      this.onShiftTab();
      return;
    }

    if (matchesKey(data, Key.up)) {
      if (this.handleHistoryNavigate("up")) {
        return;
      }
    }
    if (matchesKey(data, Key.down)) {
      if (this.handleHistoryNavigate("down")) {
        return;
      }
    }

    if (matchesKey(data, Key.tab) && !this.isShowingAutocomplete()) {
      const cursor = this.getCursor();
      const line = this.getText().split("\n")[cursor.line] ?? "";
      const beforeCursor = line.slice(0, cursor.col);
      const isSlash = beforeCursor.trimStart().startsWith("/");
      const isFileRef = this.isFileRefContext(beforeCursor);
      if (!isSlash && !isFileRef) {
        if (this.handleBangTabCompletion()) {
          return;
        }
        if (this.handleHistoryTabCompletion()) {
          return;
        }
      }
    }

    if (matchesKey(data, Key.escape) && this.onEscape && !this.isShowingAutocomplete()) {
      this.onEscape();
      return;
    }
    if (matchesKey(data, Key.ctrl("c")) && this.onCtrlC) {
      this.onCtrlC();
      return;
    }
    if (matchesKey(data, Key.ctrl("d"))) {
      if (this.getText().length === 0 && this.onCtrlD) {
        this.onCtrlD();
      }
      return;
    }

    super.handleInput(data);

    const afterText = this.getText();
    if (afterText !== beforeText) {
      this.clearCycle();
      const sessionKey = this.getSessionKey();
      this.promptHistory?.resetBrowse(sessionKey, afterText);
    }
  }
}
