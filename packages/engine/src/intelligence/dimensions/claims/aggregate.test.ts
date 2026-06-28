import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@sia/contract";
import { aggregateClaimIntents, type SessionExtraction } from "./aggregate";

function ex(
  sessionId: string,
  intents: string[],
  claims: [import("@sia/contract").ClaimSubtype, string][],
): SessionExtraction {
  const result: ExtractionResult = {
    intents: intents.map((content) => ({ content })),
    claims: claims.map(([subtype, content]) => ({ subtype, content })),
  };
  return { sessionId, result };
}

describe("aggregateClaimIntents", () => {
  it("counts claims by subtype and totals across sessions", () => {
    const report = aggregateClaimIntents([
      ex("s1", ["list linear projects"], [
        ["capability", "I can query Linear"],
        ["factoid", "Linear has 5 projects"],
      ]),
      ex("s2", ["deploy to prod"], [
        ["capability", "I can deploy"],
        ["unverifiable", "this will be fast"],
      ]),
    ]);

    expect(report.sessionsWithTranscript).toBe(2);
    expect(report.totalClaims).toBe(4);
    expect(report.totalIntents).toBe(2);
    expect(report.claimsBySubtype).toEqual({
      factoid: 1,
      capability: 2,
      user_assertion: 0,
      unverifiable: 1,
    });
    expect(report.capabilityClaimRate).toBeCloseTo(0.5);
    expect(report.unverifiableClaimRate).toBeCloseTo(0.25);
  });

  it("lists distinct claims with subtype, deduped by subtype+text, ranked by recurrence", () => {
    const report = aggregateClaimIntents([
      ex("s1", [], [["capability", "I can deploy"], ["factoid", "prod is us-east-1"]]),
      ex("s2", [], [["capability", "I can deploy"], ["factoid", "prod is eu-west-1"]]),
    ]);

    expect(report.totalClaims).toBe(4);
    expect(report.claims).toHaveLength(3); // "I can deploy" deduped across 2 sessions
    expect(report.claims[0]).toMatchObject({
      subtype: "capability",
      content: "I can deploy",
      sessionCount: 2,
      sessionIds: ["s1", "s2"],
    });
    // same text under a different subtype would NOT dedupe together
    expect(report.claims.filter((c) => c.subtype === "factoid")).toHaveLength(2);
  });

  it("de-duplicates intents case/whitespace-insensitively and ranks by session recurrence", () => {
    const report = aggregateClaimIntents([
      ex("s1", ["List Linear  Projects"], []),
      ex("s2", ["list linear projects"], []),
      ex("s3", ["deploy to prod"], []),
    ]);

    expect(report.totalIntents).toBe(3); // raw count, not deduped
    expect(report.intents).toHaveLength(2); // deduped distinct
    expect(report.intents[0].sessionCount).toBe(2); // the Linear intent, most recurrent first
    expect(report.intents[0].sessionIds).toEqual(["s1", "s2"]);
    expect(report.intents[0].content).toBe("List Linear  Projects"); // first-seen canonical text
  });

  it("ignores unknown subtypes and blank intents", () => {
    const report = aggregateClaimIntents([
      {
        sessionId: "s1",
        result: {
          // @ts-expect-error — exercising tolerance to a drifted subtype
          claims: [{ subtype: "speculation", content: "x" }, { subtype: "factoid", content: "y" }],
          intents: [{ content: "  " }, { content: "real intent" }],
        },
      },
    ]);

    expect(report.totalClaims).toBe(1);
    expect(report.claimsBySubtype.factoid).toBe(1);
    expect(report.totalIntents).toBe(1);
    expect(report.perSession[0].claimCount).toBe(1);
    expect(report.perSession[0].intentCount).toBe(1);
  });

  it("returns zeroed rates on an empty corpus without dividing by zero", () => {
    const report = aggregateClaimIntents([]);
    expect(report.sessionsWithTranscript).toBe(0);
    expect(report.totalClaims).toBe(0);
    expect(report.capabilityClaimRate).toBe(0);
    expect(report.unverifiableClaimRate).toBe(0);
    expect(report.intents).toEqual([]);
  });
});
