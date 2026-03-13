import { describe, expect, it } from "vitest";
import { createSubmitHarness } from "./tui-submit-test-helpers.js";

describe("createEditorSubmitHandler", () => {
  it("records submitted messages to prompt history", () => {
    const { editor, promptHistory, getSessionKey, onSubmit } = createSubmitHarness();

    onSubmit("hello world");

    expect(editor.setText).toHaveBeenCalledWith("");
    expect(promptHistory.noteSubmitted).toHaveBeenCalledWith(getSessionKey(), "hello world");
  });

  it("trims input before recording to prompt history", () => {
    const { promptHistory, getSessionKey, onSubmit } = createSubmitHarness();

    onSubmit("   hi   ");

    expect(promptHistory.noteSubmitted).toHaveBeenCalledWith(getSessionKey(), "hi");
  });

  it.each(["", "   "])("does not record blank submissions", (text) => {
    const { promptHistory, onSubmit } = createSubmitHarness();

    onSubmit(text);

    expect(promptHistory.noteSubmitted).not.toHaveBeenCalled();
  });

  it("routes slash commands to handleCommand", () => {
    const { promptHistory, getSessionKey, handleCommand, sendMessage, onSubmit } =
      createSubmitHarness();

    onSubmit("/models");

    expect(promptHistory.noteSubmitted).toHaveBeenCalledWith(getSessionKey(), "/models");
    expect(handleCommand).toHaveBeenCalledWith("/models");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("routes normal messages to sendMessage", () => {
    const { promptHistory, getSessionKey, handleCommand, sendMessage, onSubmit } =
      createSubmitHarness();

    onSubmit("hello");

    expect(promptHistory.noteSubmitted).toHaveBeenCalledWith(getSessionKey(), "hello");
    expect(sendMessage).toHaveBeenCalledWith("hello");
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it("routes bang-prefixed lines to handleBangLine", () => {
    const { promptHistory, getSessionKey, handleBangLine, onSubmit } = createSubmitHarness();

    onSubmit("!ls");

    expect(promptHistory.noteSubmitted).toHaveBeenCalledWith(getSessionKey(), "!ls");
    expect(handleBangLine).toHaveBeenCalledWith("!ls");
  });
});
