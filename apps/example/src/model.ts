// Vercel AI SDK seam — PRESENT but not yet wired into the run loop (PLAN Phase 0:
// "add the Vercel AI SDK … not wired up yet — just present"). Phase 3 turns the
// synthetic driver into a real AI-SDK agent that calls `model()` to answer.
//
// Importing `anthropic` here proves the provider resolves at build time; it reads
// ANTHROPIC_API_KEY lazily (only when a model is actually invoked), so merely
// constructing a model needs no secret.

import { anthropic } from "@ai-sdk/anthropic";
import { SEED_MODEL_DEFAULT } from "@sia/seed";
import type { LanguageModel } from "ai";

/** Resolve a Claude model handle by id (defaults to the seed catalog's model). */
export function model(modelId: string = SEED_MODEL_DEFAULT): LanguageModel {
  return anthropic(modelId);
}
