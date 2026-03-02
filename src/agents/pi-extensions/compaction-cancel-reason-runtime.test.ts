import { describe, expect, it } from "vitest";
import {
  consumeCompactionCancelReason,
  setCompactionCancelReason,
} from "./compaction-cancel-reason-runtime.js";

describe("compaction cancel reason runtime", () => {
  it("stores and consumes cancel reason per session manager", () => {
    const sessionManager = {};

    expect(consumeCompactionCancelReason(sessionManager)).toBeNull();

    setCompactionCancelReason(sessionManager, "  nope  ");
    expect(consumeCompactionCancelReason(sessionManager)).toBe("nope");
    expect(consumeCompactionCancelReason(sessionManager)).toBeNull();
  });
});
