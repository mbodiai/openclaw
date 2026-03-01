import { Container, Spacer, Text } from "@mariozechner/pi-tui";
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
  return text
    .replace(/\*\*/g, "")
    .replace(/^\s*\*\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
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
  private thinking: Text;
  private body: HyperlinkMarkdown;

  constructor(text: string) {
    super();
    this.thinking = new Text("", 1, 0);
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
    (this as any)._rawText = text;
    this.refresh();
  }

  refresh() {
    const text = (this as any)._rawText || "";
    const { thinking, content } = splitThinkingPrefix(text);
    if (thinking && thinkingVisible) {
      const normalized = normalizeThinkingForUi(thinking);
      const expanded = thinkingExpandedView || verboseFullMode;
      const shown = expanded ? normalized : compactThinkingForUi(normalized);
      this.thinking.setText(theme.dim(theme.italic(`thinking ... ${shown || normalized}`)));
    } else {
      this.thinking.setText("");
    }
    this.body.setText(content || (thinking ? "" : text));
  }
}
