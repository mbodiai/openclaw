import { Component, Container, Markdown, Spacer } from "@mariozechner/pi-tui";
import { stripReasoningTagsFromText } from "../../shared/text/reasoning-tags.js";
import { stripAnsi } from "../../terminal/ansi.js";
import { markdownTheme, theme } from "../theme/theme.js";
import { HyperlinkMarkdown } from "./hyperlink-markdown.js";

function splitThinkingPrefix(text: string) {
  const markerMatch = text.match(/^\[thinking\]\n([\s\S]*?)\n\[thinking_end\](?:\n\n([\s\S]*))?$/);
  if (markerMatch) {
    return {
      thinking: (markerMatch[1] ?? "").trim(),
      content: (markerMatch[2] ?? "").trim(),
    };
  }
  // Backward-compat for older history entries without [thinking_end].
  const legacyMatch = text.match(/^\[thinking\]\n([\s\S]*?)(?:\n\n([\s\S]*))?$/);
  if (!legacyMatch) {
    return { thinking: "", content: text };
  }
  return {
    thinking: (legacyMatch[1] ?? "").trim(),
    content: (legacyMatch[2] ?? "").trim(),
  };
}

function normalizeThinkingForUi(text: string) {
  return text.trim();
}

function compactThinkingForUi(text: string, maxLen = 300) {
  const normalized = normalizeThinkingForUi(text);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLen) {
    return normalized;
  }
  // Show the last portion that fits within maxLen, preferring sentence boundaries.
  const parts = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  let result = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts.slice(i).join(" ");
    if (candidate.length <= maxLen) {
      result = candidate;
    } else {
      break;
    }
  }
  if (result) {
    return result;
  }
  return `…${normalized.slice(-(maxLen - 1))}`;
}

let thinkingExpandedView = true;
export function setThinkingExpandedView(value: boolean) {
  thinkingExpandedView = value;
}

let thinkingVisible = true;
export function setThinkingVisibleView(value: boolean) {
  thinkingVisible = value;
}

let verboseFullMode = false;
export function setVerboseFullMode(value: boolean) {
  verboseFullMode = value;
}

class ThinkingWrapper implements Component {
  private markdown: Markdown;
  private lastText: string = "";
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor() {
    this.markdown = new Markdown("", 0, 0, markdownTheme, {
      color: (line) => theme.dim(line),
    });
  }

  setText(text: string) {
    if (this.lastText !== text) {
      this.lastText = text;
      this.markdown.setText(text);
      this.invalidate();
    }
  }

  invalidate() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.markdown.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    if (!this.lastText) {
      this.cachedWidth = width;
      this.cachedLines = [];
      return [];
    }

    // Render markdown content, subtracting width for the left border '│  '
    const innerWidth = Math.max(1, width - 3);
    const innerLines = this.markdown.render(innerWidth);

    const result: string[] = [];

    // Top border
    result.push(theme.dim("╭─ ") + theme.bold(theme.dim("Thinking")));

    // Middle lines with left border
    for (const line of innerLines) {
      result.push(theme.dim("│  ") + line);
    }

    // Bottom border
    result.push(theme.dim("╰─"));
    result.push(""); // Spacing after block

    this.cachedWidth = width;
    this.cachedLines = result;
    return result;
  }
}

export class AssistantMessageComponent extends Container {
  private thinking: ThinkingWrapper;
  private body: HyperlinkMarkdown;

  constructor(text: string) {
    super();
    this.thinking = new ThinkingWrapper();
    this.body = new HyperlinkMarkdown("", 1, 0, markdownTheme, {
      // Keep assistant body text in terminal default foreground so contrast
      // follows the user's terminal theme (dark or light).
      color: (line) => theme.assistantText(line),
    });
    this.addChild(new Spacer(1));
    this.addChild(this.thinking);
    this.addChild(this.body);
    this.setText(text);
  }

  setText(text: string) {
    // Save raw text to allow toggling thinking visibility without re-fetching
    (this as { _rawText?: string })._rawText = text;
    this.refresh();
  }

  refresh() {
    const text = (this as { _rawText?: string })._rawText || "";
    const { thinking, content } = splitThinkingPrefix(text);

    if (thinking && thinkingVisible) {
      const expanded = thinkingExpandedView || verboseFullMode;
      const actualThinking = expanded
        ? normalizeThinkingForUi(thinking)
        : compactThinkingForUi(thinking.replace(/\s+/g, " "));

      const cleanThinking = stripAnsi(actualThinking);
      this.thinking.setText(cleanThinking);
    } else {
      this.thinking.setText("");
    }

    const bodyText = content || (thinking ? "" : text);
    const cleanedBodyText = stripReasoningTagsFromText(bodyText, {
      mode: "preserve",
      trim: "both",
    }).replace(/<\/?final>/g, "");

    this.body.setText(`**Agent**\n\n` + cleanedBodyText);
  }
}
