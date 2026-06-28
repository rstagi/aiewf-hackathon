import { describe, expect, it } from "vitest";
import { FLOW_JUDGE_CRITERIA, FLOW_JUDGE_RUBRIC } from "./flow-judge-rubric";
import { RESOLUTION_RUBRIC } from "./rubric";

describe("FLOW_JUDGE_RUBRIC", () => {
  it("defines exactly the binary score levels Flow-Judge maps to resolved 0|1", () => {
    expect(FLOW_JUDGE_RUBRIC).toContain("Score 0");
    expect(FLOW_JUDGE_RUBRIC).toContain("Score 1");
    expect(FLOW_JUDGE_RUBRIC).toContain("UNRESOLVED");
    expect(FLOW_JUDGE_RUBRIC).toContain("RESOLVED");
    // No middle ground — resolution is binary, so no 3/5-Likert levels leak in.
    expect(FLOW_JUDGE_RUBRIC).not.toContain("Score 2");
  });

  it("stays semantically aligned with the frozen Claude rubric (re-ask / escalate / abandon)", () => {
    for (const phrase of ["rephrase/correct", "escalated", "ABANDONED", "re-asked"]) {
      expect(FLOW_JUDGE_RUBRIC).toContain(phrase);
    }
    // Both rubrics share the decisive abandonment proxy, so they can't diverge silently.
    expect(RESOLUTION_RUBRIC).toContain("ABANDONED");
  });
});

describe("FLOW_JUDGE_CRITERIA", () => {
  it("carries the completion-not-style instruction shared with the Claude rubric", () => {
    expect(FLOW_JUDGE_CRITERIA).toContain("goal completion, NOT politeness or faithfulness");
    expect(RESOLUTION_RUBRIC).toContain("Judge goal completion, NOT politeness or faithfulness");
  });
});
