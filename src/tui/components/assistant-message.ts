import { Container, Spacer, Text, Markdown } from "@mariozechner/pi-tui";
import { stripReasoningTagsFromText } from "../../shared/text/reasoning-tags.js";
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

export class AssistantMessageComponent extends Container {
  private thinking: Markdown;
  private body: HyperlinkMarkdown;

  constructor(text: string) {
    super();
    this.thinking = new Markdown("", 1, 0, markdownTheme, {
      color: (line) => theme.dim(line)
    });
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
      const normalized = normalizeThinkingForUi(thinking);
      const expanded = thinkingExpandedView || verboseFullMode;
      const actualThinking = expanded ? thinking.trim() : compactThinkingForUi(thinking.replace(/\s+/g, " "));
      const lines = actualThinking.split("\n");
      // If using Markdown component, just prepend the blockquote style or pass it directly.
      // But we need the specific border style. The pi-tui Markdown component will just render the text. 
      // Let's strip ANSI from the raw text first.
      const cleanThinking = actualThinking.replace(/\x1B\[\d+;?\d*m/g, "");
      
      // Instead of manual lines, we can just use the Markdown component and give it standard markdown quotes or headers. 
      // But to match the EXACT screenshot design, we'll manually apply chalk formatting to bold text since `pi-tui` Text component doesn't parse Markdown unless we use the Markdown component. 
      // We changed `this.thinking` to `Markdown`. The `Markdown` component WILL parse `**bold**` natively!
      // But we need to inject the borders on every line. 
      // A hack is to format it first, but Markdown parsing might mess up the borders.
      // The safest way to preserve Markdown parsing AND the borders is to use a Box or render Markdown and wrap it, but pi-tui Box doesn't have partial borders.
      
      const formatted = cleanThinking.split("\n").map((line: string) => `│  ${line}`).join("\n");
      this.thinking.setText(`╭─ Thinking\n${formatted}\n╰─\n`);
    } else {
      this.thinking.setText("");
    }
    const bodyText = content || (thinking ? "" : text);
    const cleanedBodyText = stripReasoningTagsFromText(bodyText, {
      mode: "preserve",
      trim: "both",
    }).replace(/<\/?final>/g, "");
    this.body.setText(`**Agent**

` + cleanedBodyText);
  }
}