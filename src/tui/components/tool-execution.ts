import fs from "node:fs";
import chalk from "chalk";
import { Box, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { formatToolDetail, resolveToolDisplay } from "../../agents/tool-display.js";
import { markdownTheme, theme } from "../theme/theme.js";
import { sanitizeRenderableText } from "../tui-formatters.js";

type ToolResultContent = {
  type?: string;
  text?: string;
  mimeType?: string;
  bytes?: number;
  omitted?: boolean;
};

type ToolResult = {
  content?: ToolResultContent[];
  details?: Record<string, unknown>;
};

const PREVIEW_LINES = 12;

function resolveToolFamily(name: string) {
  const n = name.toLowerCase();
  if (n.includes("web")) {
    return "web";
  }
  if (
    n === "read" ||
    n === "write" ||
    n === "edit" ||
    n.includes("memory") ||
    n.includes("session")
  ) {
    return "files";
  }
  if (n.includes("exec") || n === "process") {
    return "exec";
  }
  if (n.includes("browser") || n === "canvas") {
    return "browser";
  }
  return "other";
}

function colorFamily(text: string, family: string) {
  if (family === "web") {
    return chalk.hex("#7DD3A5")(text);
  }
  if (family === "files") {
    return chalk.hex("#8CC8FF")(text);
  }
  if (family === "exec") {
    return chalk.hex("#F2A65A")(text);
  }
  if (family === "browser") {
    return chalk.hex("#C4B5FD")(text);
  }
  return theme.toolTitle(text);
}

function formatToolElapsed(startedAt: number | null, endedAt: number | null) {
  if (!startedAt) {
    return "0.0s";
  }
  const end = endedAt ?? Date.now();
  const ms = Math.max(0, end - startedAt);
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatArgs(toolName: string, args: unknown): string {
  const display = resolveToolDisplay({ name: toolName, args });
  const detail = formatToolDetail(display);
  if (detail) {
    return sanitizeRenderableText(detail);
  }
  if (!args || typeof args !== "object") {
    return "";
  }
  try {
    const json = JSON.stringify(args);
    if (json === "{}" || json === "[]") {
      return "";
    }
    return sanitizeRenderableText(json);
  } catch {
    return "";
  }
}

function extractText(result?: ToolResult): string {
  if (!result?.content) {
    return "";
  }
  const lines: string[] = [];
  for (const entry of result.content) {
    if (entry.type === "text" && entry.text) {
      lines.push(sanitizeRenderableText(entry.text));
    } else if (entry.type === "image") {
      const mime = entry.mimeType ?? "image";
      const size = entry.bytes ? ` ${Math.round(entry.bytes / 1024)}kb` : "";
      const omitted = entry.omitted ? " (omitted)" : "";
      lines.push(`[${mime}${size}${omitted}]`);
    }
  }
  return lines.join("\n").trim();
}

function formatReadWithLineNumbers(text: string, args: unknown): string | null {
  if (!text) {
    return null;
  }
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const startLine = Number(a.offset ?? a.from ?? a.line ?? 1) || 1;
  const lines = text.split("\n");
  const gutterWidth = String(startLine + lines.length - 1).length;
  const pad = (n: number) => String(n).padStart(gutterWidth);
  return lines.map((line, i) => `${chalk.dim(`${pad(startLine + i)}│`)}${line}`).join("\n");
}

function formatEditDiff(args: unknown): string | null {
  if (!args || typeof args !== "object") {
    return null;
  }
  const a = args as Record<string, unknown>;
  const oldText = (a.oldText ?? a.old_string ?? a.oldContent ?? "") as string;
  const newText = (a.newText ?? a.new_string ?? a.newContent ?? "") as string;
  if (!oldText && !newText) {
    return null;
  }
  const filePath = (a.file_path ?? a.path ?? a.filePath ?? "") as string;

  // Try to find real line number by searching for the NEW text in the file
  // (old text is gone post-edit, but new text should be at the same location).
  let startLine = 0;
  if (filePath && newText) {
    try {
      const resolvedPath = filePath.replace(/^~/, process.env.HOME ?? "~");
      const content = fs.readFileSync(resolvedPath, "utf-8");
      const firstNewLine = newText.split("\n")[0]?.trim();
      if (firstNewLine) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === firstNewLine) {
            startLine = i + 1;
            break;
          }
        }
      }
    } catch {
      // File not readable — skip line numbers
    }
  }

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLine = startLine + Math.max(oldLines.length, newLines.length) - 1;
  const gutterWidth = startLine > 0 ? String(maxLine).length : 0;
  const pad = (n: number) => String(n).padStart(gutterWidth);
  const gutter = (n: number) => startLine > 0 ? chalk.dim(`${pad(n)}│`) : "";

  const parts: string[] = [];
  if (filePath) {
    parts.push(chalk.bold.white(`--- ${filePath}`));
    parts.push(chalk.bold.white(`+++ ${filePath}`));
  }
  for (let i = 0; i < oldLines.length; i++) {
    parts.push(`${gutter(startLine + i)}${chalk.bgRgb(80, 20, 20).redBright(`- ${oldLines[i]}`)}`);
  }
  for (let i = 0; i < newLines.length; i++) {
    parts.push(`${gutter(startLine + i)}${chalk.bgRgb(20, 60, 20).greenBright(`+ ${newLines[i]}`)}`);
  }
  return parts.join("\n");
}

export class ToolExecutionComponent extends Container {
  private box: Box;
  private header: Text;
  private argsLine: Text;
  private output: Markdown;
  private toolName: string;
  private args: unknown;
  private result?: ToolResult;
  private expanded = true;
  private isError = false;
  private isPartial = true;
  private updateCount = 0;
  private startedAt: number | null;
  private endedAt: number | null = null;

  constructor(toolName: string, args: unknown) {
    super();
    this.toolName = toolName;
    this.args = args;
    this.startedAt = Date.now();
    this.box = new Box(1, 1, (line) => theme.toolPendingBg(line));
    this.header = new Text("", 0, 0);
    this.argsLine = new Text("", 0, 0);
    this.output = new Markdown("", 0, 0, markdownTheme, {
      color: (line) => theme.toolOutput(line),
    });
    this.addChild(new Spacer(1));
    this.addChild(this.box);
    this.box.addChild(this.header);
    this.box.addChild(this.argsLine);
    this.box.addChild(this.output);
    this.refresh();
  }

  setArgs(args: unknown) {
    this.args = args;
    this.refresh();
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.refresh();
  }

  setResult(result: ToolResult | undefined, opts?: { isError?: boolean }) {
    this.result = result;
    this.isPartial = false;
    this.isError = Boolean(opts?.isError);
    this.endedAt = Date.now();
    this.refresh();
  }

  setPartialResult(result: ToolResult | undefined) {
    this.result = result;
    this.isPartial = true;
    this.updateCount += 1;
    this.refresh();
  }

  private refresh() {
    const bg = this.isPartial
      ? theme.toolPendingBg
      : this.isError
        ? theme.toolErrorBg
        : theme.toolSuccessBg;
    this.box.setBgFn((line) => bg(line));

    const display = resolveToolDisplay({
      name: this.toolName,
      args: this.args,
    });
    const raw = extractText(this.result);
    const isCached = /\bcache(?:d| hit)?\b/i.test(raw);
    const badge = this.isPartial ? "running" : this.isError ? "error" : isCached ? "cached" : "ok";
    const family = resolveToolFamily(this.toolName);
    const elapsed = formatToolElapsed(this.startedAt, this.endedAt);
    const title = `${display.emoji} ${display.label} [${badge}] [${family}] [${elapsed}]`;
    this.header.setText(colorFamily(theme.bold(title), family));

    const argLine = formatArgs(this.toolName, this.args);
    if (argLine) {
      const timeline = `timeline: start → args${this.updateCount > 0 ? ` → updates x${this.updateCount}` : ""}${this.isPartial ? "" : " → result"}`;
      this.argsLine.setText(theme.dim(`${timeline} | ${argLine}`));
    } else if (this.isPartial || this.updateCount > 0) {
      const timeline = `timeline: start → args${this.updateCount > 0 ? ` → updates x${this.updateCount}` : ""}${this.isPartial ? "" : " → result"}`;
      this.argsLine.setText(theme.dim(timeline));
    } else {
      this.argsLine.setText("");
    }

    // For edit tools, show a diff of old → new text.
    const isEditTool = this.toolName === "edit" || this.toolName === "str_replace_editor";
    const isReadTool = this.toolName === "read";
    const diff = isEditTool ? formatEditDiff(this.args) : null;
    const numbered = isReadTool && raw ? formatReadWithLineNumbers(raw, this.args) : null;
    const text = diff ?? numbered ?? raw ?? (this.isPartial ? "…" : "");
    if (!this.expanded && text) {
      const lines = text.split("\n");
      const limit = diff ? PREVIEW_LINES * 2 : PREVIEW_LINES;
      const preview =
        lines.length > limit ? `${lines.slice(0, limit).join("\n")}\n…` : text;
      this.output.setText(preview);
    } else {
      this.output.setText(text);
    }
  }
}
