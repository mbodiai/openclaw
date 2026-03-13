import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import { applyModelOverrideToSessionEntry } from "./model-overrides.js";

describe("applyModelOverrideToSessionEntry", () => {
  it("clears stale runtime model fields when switching overrides", () => {
    const before = Date.now() - 5_000;
    const entry: SessionEntry = {
      sessionId: "sess-1",
      updatedAt: before,
      modelProvider: "anthropic",
      model: "claude-sonnet-4-6",
      providerOverride: "anthropic",
      modelOverride: "claude-sonnet-4-6",
      fallbackNoticeSelectedModel: "anthropic/claude-sonnet-4-6",
      fallbackNoticeActiveModel: "anthropic/claude-sonnet-4-6",
      fallbackNoticeReason: "provider temporary failure",
      inputTokens: 111,
      outputTokens: 22,
      totalTokens: 133,
      totalTokensFresh: true,
      cacheRead: 7,
      cacheWrite: 8,
      contextTokens: 1_048_576,
      systemPromptReport: {
        source: "run",
        generatedAt: before,
        systemPrompt: {
          chars: 1,
          projectContextChars: 0,
          nonProjectContextChars: 1,
        },
        injectedWorkspaceFiles: [],
        skills: {
          promptChars: 0,
          entries: [],
        },
        tools: {
          listChars: 0,
          schemaChars: 0,
          entries: [],
        },
      },
    };

    const result = applyModelOverrideToSessionEntry({
      entry,
      selection: {
        provider: "openai",
        model: "gpt-5.2",
      },
      contextTokens: 200_000,
    });

    expect(result.updated).toBe(true);
    expect(entry.providerOverride).toBe("openai");
    expect(entry.modelOverride).toBe("gpt-5.2");
    expect(entry.modelProvider).toBeUndefined();
    expect(entry.model).toBeUndefined();
    expect(entry.inputTokens).toBeUndefined();
    expect(entry.outputTokens).toBeUndefined();
    expect(entry.totalTokens).toBeUndefined();
    expect(entry.totalTokensFresh).toBeUndefined();
    expect(entry.cacheRead).toBeUndefined();
    expect(entry.cacheWrite).toBeUndefined();
    expect(entry.contextTokens).toBe(200_000);
    expect(entry.systemPromptReport).toBeUndefined();
    expect(entry.fallbackNoticeSelectedModel).toBeUndefined();
    expect(entry.fallbackNoticeActiveModel).toBeUndefined();
    expect(entry.fallbackNoticeReason).toBeUndefined();
    expect((entry.updatedAt ?? 0) > before).toBe(true);
  });

  it("clears stale runtime model fields even when override selection is unchanged", () => {
    const before = Date.now() - 5_000;
    const entry: SessionEntry = {
      sessionId: "sess-2",
      updatedAt: before,
      modelProvider: "anthropic",
      model: "claude-sonnet-4-6",
      providerOverride: "openai",
      modelOverride: "gpt-5.2",
      totalTokens: 100,
      totalTokensFresh: false,
      contextTokens: 1_048_576,
    };

    const result = applyModelOverrideToSessionEntry({
      entry,
      selection: {
        provider: "openai",
        model: "gpt-5.2",
      },
      contextTokens: 200_000,
    });

    expect(result.updated).toBe(true);
    expect(entry.providerOverride).toBe("openai");
    expect(entry.modelOverride).toBe("gpt-5.2");
    expect(entry.modelProvider).toBeUndefined();
    expect(entry.model).toBeUndefined();
    expect(entry.totalTokens).toBeUndefined();
    expect(entry.totalTokensFresh).toBeUndefined();
    expect(entry.contextTokens).toBe(200_000);
    expect((entry.updatedAt ?? 0) > before).toBe(true);
  });

  it("retains aligned runtime model fields when selection and runtime already match", () => {
    const before = Date.now() - 5_000;
    const entry: SessionEntry = {
      sessionId: "sess-3",
      updatedAt: before,
      modelProvider: "openai",
      model: "gpt-5.2",
      providerOverride: "openai",
      modelOverride: "gpt-5.2",
    };

    const result = applyModelOverrideToSessionEntry({
      entry,
      selection: {
        provider: "openai",
        model: "gpt-5.2",
      },
    });

    expect(result.updated).toBe(false);
    expect(entry.modelProvider).toBe("openai");
    expect(entry.model).toBe("gpt-5.2");
    expect(entry.updatedAt).toBe(before);
  });

  it("refreshes the stored context window when the same model is re-applied", () => {
    const before = Date.now() - 5_000;
    const entry: SessionEntry = {
      sessionId: "sess-4",
      updatedAt: before,
      providerOverride: "openai",
      modelOverride: "gpt-5.2",
      contextTokens: 1_048_576,
      totalTokens: 10,
      totalTokensFresh: true,
    };

    const result = applyModelOverrideToSessionEntry({
      entry,
      selection: {
        provider: "openai",
        model: "gpt-5.2",
      },
      contextTokens: 200_000,
    });

    expect(result.updated).toBe(true);
    expect(entry.contextTokens).toBe(200_000);
    expect(entry.totalTokens).toBeUndefined();
    expect(entry.totalTokensFresh).toBeUndefined();
    expect((entry.updatedAt ?? 0) > before).toBe(true);
  });
});
