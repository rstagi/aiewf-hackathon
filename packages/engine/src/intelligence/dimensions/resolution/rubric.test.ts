import { describe, expect, it } from "vitest";
import { RESOLUTION_RUBRIC } from "./rubric";

describe("RESOLUTION_RUBRIC", () => {
  it("carries the load-bearing scoring phrases verbatim from RFC Appendix B", () => {
    expect(RESOLUTION_RUBRIC).toContain("RESOLVED (score 1)");
    expect(RESOLUTION_RUBRIC).toContain("UNRESOLVED (score 0)");
    // The decisive instruction: completion, not style.
    expect(RESOLUTION_RUBRIC).toContain("Judge goal completion, NOT politeness or faithfulness");
  });

  it("specifies the four structured-output fields the judge must emit", () => {
    for (const field of ["resolved", "confidence", "reasoning", "evidence_span"]) {
      expect(RESOLUTION_RUBRIC).toContain(field);
    }
  });

  it("keys on the behavioral proxies (re-ask / escalate / abandon) that block self-validation", () => {
    expect(RESOLUTION_RUBRIC).toContain("rephrase/correct");
    expect(RESOLUTION_RUBRIC).toContain("ABANDONED");
  });
});
