import { describe, expect, it } from "vitest";
import { TuiPromptHistory } from "./tui-prompt-history.js";

describe("TuiPromptHistory", () => {
  it("restores cleared buffer first on up", () => {
    const h = new TuiPromptHistory();
    const key = "agent:main:main";

    h.noteSubmitted(key, "first");
    h.noteSubmitted(key, "second");
    h.noteClearedBuffer(key, "draft-x");

    expect(h.navigate(key, "up", "")).toBe("draft-x");
    expect(h.navigate(key, "up", "draft-x")).toBe("second");
  });

  it("down from cleared returns to draft", () => {
    const h = new TuiPromptHistory();
    const key = "agent:main:main";

    h.noteClearedBuffer(key, "draft-x");

    expect(h.navigate(key, "up", "my-draft")).toBe("draft-x");
    expect(h.navigate(key, "down", "draft-x")).toBe("my-draft");
  });

  it("navigates history newest to oldest and back", () => {
    const h = new TuiPromptHistory();
    const key = "agent:main:main";

    h.noteSubmitted(key, "one");
    h.noteSubmitted(key, "two");
    h.noteSubmitted(key, "three");

    expect(h.navigate(key, "up", "draft")).toBe("three");
    expect(h.navigate(key, "up", "three")).toBe("two");
    expect(h.navigate(key, "down", "two")).toBe("three");
    expect(h.navigate(key, "down", "three")).toBe("draft");
  });

  it("autosuggest returns remainder from most recent matching entry", () => {
    const h = new TuiPromptHistory();
    const key = "agent:main:main";

    h.noteSubmitted(key, "openclaw tui");
    h.noteSubmitted(key, "openclaw gateway status");

    expect(h.getAutosuggestRemainder(key, "openclaw g")).toBe("ateway status");
  });

  it("seedFromTranscript adds unique items", () => {
    const h = new TuiPromptHistory();
    const key = "agent:main:main";

    h.noteSubmitted(key, "hello");
    h.seedFromTranscript(key, ["hello", "world"]);

    expect(h.getMatches(key, "w")).toEqual(["world"]);
  });
});
