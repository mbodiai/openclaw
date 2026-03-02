import { describe, expect, it, vi } from "vitest";
import { createCommandHandlers } from "./tui-command-handlers.js";

type LoadHistoryMock = ReturnType<typeof vi.fn> & (() => Promise<void>);
type SetActivityStatusMock = ReturnType<typeof vi.fn> & ((text: string) => void);

function createHarness(params?: {
  sendChat?: ReturnType<typeof vi.fn>;
  resetSession?: ReturnType<typeof vi.fn>;
  loadHistory?: LoadHistoryMock;
  setActivityStatus?: SetActivityStatusMock;
  isConnected?: boolean;
}) {
  const sendChat = params?.sendChat ?? vi.fn().mockResolvedValue({ runId: "r1" });
  const resetSession = params?.resetSession ?? vi.fn().mockResolvedValue({ ok: true });
  const addUser = vi.fn();
  const addSystem = vi.fn();
  const requestRender = vi.fn();
  const loadHistory =
    params?.loadHistory ?? (vi.fn().mockResolvedValue(undefined) as LoadHistoryMock);
  const setActivityStatus = params?.setActivityStatus ?? (vi.fn() as SetActivityStatusMock);

  const { handleCommand } = createCommandHandlers({
    client: { sendChat, resetSession } as never,
    chatLog: { addUser, addSystem } as never,
    tui: { requestRender } as never,
    opts: {},
    state: {
      currentSessionKey: "agent:main:main",
      activeChatRunId: null,
      isConnected: params?.isConnected ?? true,
      sessionInfo: {},
    } as never,
    deliverDefault: false,
    openOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    refreshSessionInfo: vi.fn(),
    loadHistory,
    setSession: vi.fn(),
    refreshAgents: vi.fn(),
    abortActive: vi.fn(),
    setActivityStatus,
    formatSessionKey: vi.fn(),
    applySessionInfoFromPatch: vi.fn(),
    noteLocalRunId: vi.fn(),
    forgetLocalRunId: vi.fn(),
    requestExit: vi.fn(),
  });

  return {
    handleCommand,
    sendChat,
    resetSession,
    addUser,
    addSystem,
    requestRender,
    loadHistory,
    setActivityStatus,
  };
}

describe("tui command handlers", () => {
  it("renders the sending indicator before chat.send resolves", async () => {
    let resolveSend: (value: { runId: string }) => void = () => {
      throw new Error("sendChat promise resolver was not initialized");
    };
    const sendPromise = new Promise<{ runId: string }>((resolve) => {
      resolveSend = (value) => resolve(value);
    });
    const sendChat = vi.fn(() => sendPromise);
    const setActivityStatus = vi.fn();

    const { handleCommand, requestRender } = createHarness({
      sendChat,
      setActivityStatus,
    });

    const pending = handleCommand("/context");
    await Promise.resolve();

    expect(setActivityStatus).toHaveBeenCalledWith("sending");
    const sendingOrder = setActivityStatus.mock.invocationCallOrder[0] ?? 0;
    const renderOrders = requestRender.mock.invocationCallOrder;
    expect(renderOrders.some((order) => order > sendingOrder)).toBe(true);

    resolveSend({ runId: "r1" });
    await pending;
    expect(setActivityStatus).toHaveBeenCalledWith("waiting");
  });

  it("forwards unknown slash commands to the gateway", async () => {
    const { handleCommand, sendChat, addUser, addSystem, requestRender } = createHarness();

    await handleCommand("/context");

    expect(addSystem).not.toHaveBeenCalled();
    expect(addUser).toHaveBeenCalledWith("/context");
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        message: "/context",
      }),
    );
    expect(requestRender).toHaveBeenCalled();
  });

  it("passes reset reason when handling /new and /reset", async () => {
    const loadHistory = vi.fn().mockResolvedValue(undefined);
    const { handleCommand, resetSession } = createHarness({ loadHistory });

    await handleCommand("/new");
    await handleCommand("/reset");

    expect(resetSession).toHaveBeenNthCalledWith(1, "agent:main:main", "new");
    expect(resetSession).toHaveBeenNthCalledWith(2, "agent:main:main", "reset");
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  it("reports send failures and marks activity status as error", async () => {
    const setActivityStatus = vi.fn();
    const { handleCommand, addSystem } = createHarness({
      sendChat: vi.fn().mockRejectedValue(new Error("gateway down")),
      setActivityStatus,
    });

    await handleCommand("/context");

    expect(addSystem).toHaveBeenCalledWith("send failed: Error: gateway down");
    expect(setActivityStatus).toHaveBeenLastCalledWith("error");
  });

  it("reports disconnected status and skips gateway send when offline", async () => {
    const { handleCommand, sendChat, addUser, addSystem, setActivityStatus } = createHarness({
      isConnected: false,
    });

    await handleCommand("/context");

    expect(sendChat).not.toHaveBeenCalled();
    expect(addUser).not.toHaveBeenCalled();
    expect(addSystem).toHaveBeenCalledWith("not connected to gateway — message not sent");
    expect(setActivityStatus).toHaveBeenLastCalledWith("disconnected");
  });

  it("normalizes /reasoning streaming to stream", async () => {
    const patchSession = vi.fn().mockResolvedValue(undefined);
    const addSystem = vi.fn();
    const refreshSessionInfo = vi.fn().mockResolvedValue(undefined);

    const { handleCommand } = createCommandHandlers({
      client: { patchSession } as never,
      chatLog: { addUser: vi.fn(), addSystem } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        isConnected: true,
        sessionInfo: {},
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo,
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
      forgetLocalRunId: vi.fn(),
      requestExit: vi.fn(),
    });

    await handleCommand("/reasoning streaming");

    expect(patchSession).toHaveBeenCalledWith({
      key: "agent:main:main",
      reasoningLevel: "stream",
    });
    expect(addSystem).toHaveBeenCalledWith("reasoning set to stream");
  });

  it("queues messages while a run is active and flushes them in order", async () => {
    const sendChat = vi.fn().mockResolvedValue({ runId: "r1" });
    const addUser = vi.fn();
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const setActivityStatus = vi.fn();
    const state: {
      currentSessionKey: string;
      activeChatRunId: string | null;
      isConnected: boolean;
      sessionInfo: Record<string, never>;
    } = {
      currentSessionKey: "agent:main:main",
      activeChatRunId: "active-run",
      isConnected: true,
      sessionInfo: {},
    };

    const { sendMessage, flushQueuedMessage } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addUser, addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: state as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus,
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
      forgetLocalRunId: vi.fn(),
    });

    await sendMessage("first queued");
    await sendMessage("second queued");

    expect(sendChat).not.toHaveBeenCalled();
    expect(addUser).toHaveBeenNthCalledWith(1, "first queued");
    expect(addUser).toHaveBeenNthCalledWith(2, "second queued");
    expect(addSystem).toHaveBeenNthCalledWith(1, "queued (1)");
    expect(addSystem).toHaveBeenNthCalledWith(2, "queued (2)");

    state.activeChatRunId = null;
    await flushQueuedMessage();
    expect(sendChat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: "first queued", sessionKey: "agent:main:main" }),
    );
    expect(addSystem).toHaveBeenCalledWith("sending queued message (1 left)");

    state.activeChatRunId = null;
    await flushQueuedMessage();
    expect(sendChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: "second queued", sessionKey: "agent:main:main" }),
    );

    expect(setActivityStatus).toHaveBeenCalledWith("sending");
    expect(setActivityStatus).toHaveBeenCalledWith("waiting");
  });

  it("can pop the most recent queued message for edit (LIFO)", async () => {
    const addUser = vi.fn();
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const state: {
      currentSessionKey: string;
      activeChatRunId: string | null;
      sessionInfo: Record<string, never>;
    } = {
      currentSessionKey: "agent:main:main",
      activeChatRunId: "active-run",
      sessionInfo: {},
    };

    const { sendMessage, popQueuedMessage } = createCommandHandlers({
      client: { sendChat: vi.fn() } as never,
      chatLog: { addUser, addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: state as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
      forgetLocalRunId: vi.fn(),
    });

    await sendMessage("first queued");
    await sendMessage("second queued");

    expect(popQueuedMessage()).toBe("second queued");
    expect(popQueuedMessage()).toBe("first queued");
    expect(popQueuedMessage()).toBeNull();
  });
});
