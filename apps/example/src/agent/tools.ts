// ─────────────────────────────────────────────────────────────────────────────
// The agent's own tools — atomic, composable PRIMITIVES exposed directly to the model.
//
// Design notes (these enable the skills SIA will later author):
//   • One job per tool. No "mega-tool" that pre-bakes a workflow — composition is the
//     value a SIA skill adds, so we deliberately leave it unprovided here.
//   • Structured, parseable outputs so a skill can reference fields and chain tools.
//   • Deterministic mock data (reproducible on stage) with values that aren't guessable,
//     so a composition skill that *forces tool use* is demonstrably more correct than the
//     model doing the math/lookups in its head.
//   • Descriptions stay primitive (no workflow language) — that keeps multi-tool intents
//     genuinely "uncovered" until a skill stitches the tools together.
// ─────────────────────────────────────────────────────────────────────────────
import { tool } from "ai";
import { z } from "zod";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function safeCalc(expression: string): string {
  const expr = String(expression ?? "").trim();
  if (!expr || !/^[0-9+\-*/().%\s]+$/.test(expr)) {
    return "Cannot evaluate: only basic arithmetic (+ - * / % and parentheses) is supported.";
  }
  try {
    // Input is whitelisted to digits/operators above, so this cannot run arbitrary code.
    const val = Function(`"use strict"; return (${expr});`)() as unknown;
    if (typeof val !== "number" || !Number.isFinite(val)) return "That expression did not produce a number.";
    return String(Math.round(val * 1e6) / 1e6);
  } catch {
    return "Cannot evaluate that expression.";
  }
}

// Fixed mock FX table relative to USD (1 USD = rate[code]). Deterministic + not guessable
// to the cent, so currency math must go through this tool to be correct.
const FX: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 157, CAD: 1.36, AUD: 1.51, CHF: 0.88 };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const calculator = tool({
  description: "Evaluate arithmetic and everyday math: tips, splits, percentages, totals.",
  inputSchema: z.object({ expression: z.string().describe("An arithmetic expression, e.g. 84*0.2/5") }),
  execute: ({ expression }) => safeCalc(expression),
});

const currency_convert = tool({
  description: "Convert an amount of money from one currency to another (ISO codes like USD, EUR, JPY).",
  inputSchema: z.object({
    amount: z.number().describe("The amount to convert"),
    from: z.string().describe("Source ISO currency code, e.g. JPY"),
    to: z.string().describe("Target ISO currency code, e.g. USD"),
  }),
  execute: ({ amount, from, to }) => {
    const f = String(from ?? "").toUpperCase();
    const t = String(to ?? "").toUpperCase();
    if (!FX[f] || !FX[t]) {
      return `Unknown currency. Supported: ${Object.keys(FX).join(", ")}.`;
    }
    const usd = amount / FX[f];
    const converted = Math.round(usd * FX[t] * 100) / 100;
    const rate = Math.round((FX[t] / FX[f]) * 10000) / 10000;
    return `${amount} ${f} = ${converted} ${t} (rate: 1 ${f} = ${rate} ${t}). (mock fixed rates)`;
  },
});

const current_datetime = tool({
  description: "Get the current date and time, optionally for a given timezone or city.",
  inputSchema: z.object({ timezone: z.string().optional().describe("IANA timezone, e.g. Europe/Lisbon") }),
  execute: ({ timezone }) => {
    const now = new Date();
    try {
      return now.toLocaleString("en-US", timezone ? { timeZone: timezone } : undefined);
    } catch {
      return now.toString();
    }
  },
});

const get_calendar = tool({
  description: "Look up the user's calendar events for a given day.",
  inputSchema: z.object({ date: z.string().optional().describe("ISO date (YYYY-MM-DD); defaults to today") }),
  execute: ({ date }) => {
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();
    // Deterministic mock schedule (a typical weekday).
    const events = [
      "09:30–10:00  Team standup",
      "11:00–11:30  Dentist appointment",
      "13:00–14:00  Lunch with Sam",
      "15:00–15:45  1:1 with manager",
      "18:30–19:30  Gym",
    ];
    return `Calendar for ${day} (mock data):\n` + events.map((e) => `- ${e}`).join("\n");
  },
});

const get_weather = tool({
  description: "Check the weather (condition, temperature, chance of rain) for a location, optionally on a date.",
  inputSchema: z.object({
    location: z.string().describe("City or place name"),
    date: z.string().optional().describe("ISO date (YYYY-MM-DD) for a forecast; defaults to today"),
  }),
  execute: ({ location, date }) => {
    const place = String(location ?? "your area");
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();
    const conditions = ["sunny", "partly cloudy", "overcast", "light rain", "clear skies"];
    const h = hash(`${place.toLowerCase()}|${day}`);
    const temp = 12 + (h % 18);
    const rain = (h >> 3) % 70;
    return `Weather for ${place} on ${day}: ${conditions[h % conditions.length]}, ${temp}°C, ${rain}% chance of rain. (mock data)`;
  },
});

const web_search = tool({
  description: "Search the web to look up facts, places, and recent information.",
  inputSchema: z.object({ query: z.string().describe("What to search for") }),
  execute: ({ query }) => {
    const q = String(query ?? "");
    return (
      `Top results for "${q}" (mock — wire a real search later):\n` +
      `1. A relevant overview about ${q}.\n` +
      `2. A practical guide covering ${q}.\n` +
      `3. A recent discussion thread on ${q}.`
    );
  },
});

/** The tool set passed to the model. Keys are the tool names the model calls. */
export const TOOLS = { calculator, currency_convert, current_datetime, get_calendar, get_weather, web_search };

/** Lightweight metadata for the UI's tools card. */
export const TOOL_INFO: { id: string; description: string }[] = [
  { id: "calculator", description: "Arithmetic: tips, splits, percentages, totals." },
  { id: "currency_convert", description: "Convert money between currencies (mock fixed rates)." },
  { id: "current_datetime", description: "Current date and time (optionally by timezone)." },
  { id: "get_calendar", description: "The user's calendar events for a day (mock)." },
  { id: "get_weather", description: "Weather + rain chance for a location/date (mock)." },
  { id: "web_search", description: "Look up facts and places on the web (mock)." },
];
