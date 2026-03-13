import { vi } from "vitest";
import { createEditorSubmitHandler } from "./tui.js";

type MockFn = ReturnType<typeof vi.fn>;

export type SubmitHarness = {
  editor: {
    setText: MockFn;
  };
  promptHistory: {
    noteSubmitted: MockFn;
  };
  getSessionKey: () => string;
  handleCommand: MockFn;
  sendMessage: MockFn;
  handleBangLine: MockFn;
  onSubmit: (text: string) => void;
};

export function createSubmitHarness(): SubmitHarness {
  const editor = {
    setText: vi.fn(),
  };
  const promptHistory = {
    noteSubmitted: vi.fn(),
  };
  const getSessionKey = () => "agent:main:main";
  const handleCommand = vi.fn();
  const sendMessage = vi.fn();
  const handleBangLine = vi.fn();
  const onSubmit = createEditorSubmitHandler({
    editor,
    promptHistory,
    getSessionKey,
    handleCommand,
    sendMessage,
    handleBangLine,
  });
  return {
    editor,
    promptHistory,
    getSessionKey,
    handleCommand,
    sendMessage,
    handleBangLine,
    onSubmit,
  };
}
