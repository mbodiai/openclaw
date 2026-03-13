import { describe, expect, it, vi } from "vitest";
import { createSubmitHarness } from "./tui-submit-test-helpers.js";
import { createSubmitBurstCoalescer, shouldEnableWindowsGitBashPasteFallback } from "./tui.js";

describe("createEditorSubmitHandler", () => {
  it("routes lines starting with ! to handleBangLine", () => {
    const { handleCommand, sendMessage, handleBangLine, onSubmit } = createSubmitHarness();

    onSubmit("!ls");

    expect(handleBangLine).toHaveBeenCalledTimes(1);
    expect(handleBangLine).toHaveBeenCalledWith("!ls");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it("treats a lone ! as a normal message", () => {
    const { sendMessage, handleBangLine, onSubmit } = createSubmitHarness();

    onSubmit("!");

    expect(handleBangLine).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("!");
  });

  it("does not treat leading whitespace before ! as a bang command", () => {
    const { promptHistory, getSessionKey, sendMessage, handleBangLine, onSubmit } =
      createSubmitHarness();

    onSubmit("  !ls");

    expect(handleBangLine).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("!ls");
    expect(promptHistory.noteSubmitted).toHaveBeenCalledWith(getSessionKey(), "!ls");
  });

  it("trims normal messages before sending and recording to history", () => {
    const { promptHistory, getSessionKey, sendMessage, onSubmit } = createSubmitHarness();

    onSubmit("  hello  ");

    expect(sendMessage).toHaveBeenCalledWith("hello");
    expect(promptHistory.noteSubmitted).toHaveBeenCalledWith(getSessionKey(), "hello");
  });

  it("preserves internal newlines for multiline messages", () => {
    const { promptHistory, getSessionKey, handleCommand, sendMessage, handleBangLine, onSubmit } =
      createSubmitHarness();

    onSubmit("Line 1\nLine 2\nLine 3");

    expect(sendMessage).toHaveBeenCalledWith("Line 1\nLine 2\nLine 3");
    expect(promptHistory.noteSubmitted).toHaveBeenCalledWith(
      getSessionKey(),
      "Line 1\nLine 2\nLine 3",
    );
    expect(handleCommand).not.toHaveBeenCalled();
    expect(handleBangLine).not.toHaveBeenCalled();
  });
});

describe("createSubmitBurstCoalescer", () => {
  it("coalesces rapid single-line submits into one multiline submit when enabled", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    let now = 1_000;
    const onSubmit = createSubmitBurstCoalescer({
      submit,
      enabled: true,
      burstWindowMs: 50,
      now: () => now,
    });

    onSubmit("Line 1");
    now += 10;
    onSubmit("Line 2");
    now += 10;
    onSubmit("Line 3");

    expect(submit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("Line 1\nLine 2\nLine 3");
    vi.useRealTimers();
  });

  it("passes through immediately when disabled", () => {
    const submit = vi.fn();
    const onSubmit = createSubmitBurstCoalescer({
      submit,
      enabled: false,
    });

    onSubmit("Line 1");
    onSubmit("Line 2");

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledWith("Line 1");
    expect(submit).toHaveBeenCalledWith("Line 2");
  });
});

describe("shouldEnableWindowsGitBashPasteFallback", () => {
  it("returns true on macOS iTerm2", () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: "darwin",
        env: { TERM_PROGRAM: "iTerm.app" },
      }),
    ).toBe(true);
  });

  it("returns false on macOS unknown terminals", () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: "darwin",
        env: { TERM_PROGRAM: "WeirdTerm" },
      }),
    ).toBe(false);
  });

  it("returns true on Windows Git Bash", () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: "win32",
        env: { MSYSTEM: "MINGW64", SHELL: "bash" },
      }),
    ).toBe(true);
  });

  it("returns false on non-Windows", () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: "linux",
        env: {},
      }),
    ).toBe(false);
  });
});
