import { describe, expect, it, vi } from "vitest";
import type { GatewayChatClient } from "./gateway-chat.js";
import { createSessionActions } from "./tui-session-actions.js";
import type { TuiStateAccess } from "./tui-types.js";

describe("tui session actions", () => {
  it("queues session refreshes and applies the latest result", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;

    const listSessions = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const state: TuiStateAccess = {
      agentDefaultId: "main",
      sessionMainKey: "agent:main:main",
      sessionScope: "global",
      agents: [],
      currentAgentId: "main",
      currentSessionKey: "agent:main:main",
      currentSessionId: null,
      activeChatRunId: null,
      historyLoaded: false,
      sessionInfo: {},
      initialSessionApplied: true,
      isConnected: true,
      autoMessageSent: false,
      toolsExpanded: false,
      showThinking: false,
      connectionStatus: "connected",
      activityStatus: "idle",
      statusTimeout: null,
      lastCtrlCAt: 0,
    };

    const updateFooter = vi.fn();
    const updateAutocompleteProvider = vi.fn();
    const requestRender = vi.fn();

    const { refreshSessionInfo } = createSessionActions({
      client: { listSessions } as unknown as GatewayChatClient,
      chatLog: { addSystem: vi.fn() } as unknown as import("./components/chat-log.js").ChatLog,
      tui: { requestRender } as unknown as import("@mariozechner/pi-tui").TUI,
      opts: {},
      state,
      agentNames: new Map(),
      initialSessionInput: "",
      initialSessionAgentId: null,
      resolveSessionKey: vi.fn(),
      updateHeader: vi.fn(),
      updateFooter,
      updateAutocompleteProvider,
      setActivityStatus: vi.fn(),
    });

    const first = refreshSessionInfo();
    const second = refreshSessionInfo();

    await Promise.resolve();
    expect(listSessions).toHaveBeenCalledTimes(1);

    resolveFirst?.({
      ts: Date.now(),
      path: "/tmp/sessions.json",
      count: 1,
      defaults: {},
      sessions: [
        {
          key: "agent:main:main",
          model: "old",
          modelProvider: "anthropic",
        },
      ],
    });

    await first;
    await Promise.resolve();

    expect(listSessions).toHaveBeenCalledTimes(2);

    resolveSecond?.({
      ts: Date.now(),
      path: "/tmp/sessions.json",
      count: 1,
      defaults: {},
      sessions: [
        {
          key: "agent:main:main",
          model: "Minimax-M2.1",
          modelProvider: "minimax",
        },
      ],
    });

    await second;

    expect(state.sessionInfo.model).toBe("Minimax-M2.1");
    expect(updateAutocompleteProvider).toHaveBeenCalledTimes(2);
    expect(updateFooter).toHaveBeenCalledTimes(2);
    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  it("reloads history when sessionId changes (avoids stale token display)", async () => {
    let resolveHistory: ((value: unknown) => void) | undefined;

    const listSessions = vi
      .fn()
      .mockResolvedValueOnce({
        ts: Date.now(),
        path: "/tmp/sessions.json",
        count: 1,
        defaults: {},
        sessions: [
          {
            key: "agent:main:main",
            sessionId: "session-new",
            model: "gpt-5.2",
            modelProvider: "openai",
            totalTokens: 123,
            contextTokens: 272000,
          },
        ],
      })
      .mockResolvedValueOnce({
        ts: Date.now(),
        path: "/tmp/sessions.json",
        count: 1,
        defaults: {},
        sessions: [
          {
            key: "agent:main:main",
            sessionId: "session-new",
            model: "gpt-5.2",
            modelProvider: "openai",
            totalTokens: 42,
            contextTokens: 272000,
          },
        ],
      });

    const loadHistory = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );

    const state: TuiStateAccess = {
      agentDefaultId: "main",
      sessionMainKey: "agent:main:main",
      sessionScope: "global",
      agents: [],
      currentAgentId: "main",
      currentSessionKey: "agent:main:main",
      currentSessionId: "session-old",
      activeChatRunId: null,
      historyLoaded: true,
      sessionInfo: {
        totalTokens: 229_000,
        contextTokens: 272_000,
      },
      initialSessionApplied: true,
      isConnected: true,
      autoMessageSent: false,
      toolsExpanded: false,
      showThinking: false,
      connectionStatus: "connected",
      activityStatus: "idle",
      statusTimeout: null,
      lastCtrlCAt: 0,
    };

    const updateFooter = vi.fn();
    const updateAutocompleteProvider = vi.fn();
    const requestRender = vi.fn();

    const chatLog = {
      addSystem: vi.fn(),
      clearAll: vi.fn(),
      addUser: vi.fn(),
      finalizeAssistant: vi.fn(),
      startTool: vi.fn().mockReturnValue({ setResult: vi.fn() }),
      dropAssistant: vi.fn(),
    } as unknown as import("./components/chat-log.js").ChatLog;

    const { refreshSessionInfo } = createSessionActions({
      client: { listSessions, loadHistory } as unknown as GatewayChatClient,
      chatLog,
      tui: { requestRender } as unknown as import("@mariozechner/pi-tui").TUI,
      opts: {},
      state,
      agentNames: new Map(),
      initialSessionInput: "",
      initialSessionAgentId: null,
      resolveSessionKey: vi.fn(),
      updateHeader: vi.fn(),
      updateFooter,
      updateAutocompleteProvider,
      setActivityStatus: vi.fn(),
    });

    await refreshSessionInfo();

    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(state.sessionInfo.totalTokens).toBeNull();
    expect(updateFooter).toHaveBeenCalled();

    resolveHistory?.({ messages: [], sessionId: "session-new" });

    // Flush the loadHistory → refreshSessionInfo chain.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    expect(state.currentSessionId).toBe("session-new");
    expect(state.sessionInfo.totalTokens).toBe(42);
  });
});
