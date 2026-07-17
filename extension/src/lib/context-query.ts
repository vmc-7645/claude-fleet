// The query language for Contexts: `branch:foo repo:bar is:live retry backoff`
// — filter tokens are lifted out, whatever's left is full-text over the title
// and the message bodies. Pure (no fs, no git) so it can be unit-tested; the
// index that feeds it lives in ./contexts. SPEC §5.9, §6.5.

import { ContextRecord } from "./contexts";

export interface Query {
  terms: string[]; // ALL must match (AND); a "quoted run" is one term
  branch?: string;
  repo?: string;
  live?: boolean;
  state?: string;
}

export interface Match {
  rec: ContextRecord;
  score: number;
  snippet: string; // context around the hit, "" when nothing matched on text
  where: "title" | "message" | "meta";
}

// One token = an optional `key:` plus either a "quoted run" or a bare word.
// Quotes are what let a value hold a space (`repo:"My Project"`, which the
// dropdown relies on) and what lets you ask for a literal phrase
// (`"retry backoff"`) now that bare words are ANDed rather than concatenated.
const TOKEN = /([a-zA-Z]+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g;

export function parseQuery(input: string): Query {
  const q: Query = { terms: [] };
  for (const m of input.matchAll(TOKEN)) {
    const [raw, rawKey, keyedQuoted, keyedBare, quoted, bare] = m;
    const key = rawKey?.toLowerCase(); // `Branch:main` must work like `branch:`
    const value = keyedQuoted ?? keyedBare;

    if (key && value !== undefined) {
      const v = value.toLowerCase();
      if (key === "branch") q.branch = v;
      else if (key === "repo") q.repo = v;
      else if (key === "state") q.state = v;
      else if (key === "is") {
        if (v === "live") q.live = true;
        else if (v === "idle" || v === "dead") q.live = false;
        // An unknown is:… is text, not a silently dropped filter.
        else q.terms.push(raw.toLowerCase());
      } else q.terms.push(raw.toLowerCase()); // unknown key → plain text
      continue;
    }

    // A bare `branch:` (mid-type) has no value and lands here as plain text, so
    // the list doesn't blank out between keystrokes.
    const text = quoted ?? bare;
    if (text) q.terms.push(text.toLowerCase());
  }
  return q;
}

// True when every *filter* in the query holds. Free text is scored separately —
// a filter miss excludes the row outright, a text miss just means no snippet.
function passesFilters(q: Query, r: ContextRecord): boolean {
  // A session touches several branches over its life (verified: 84 of 237 span
  // more than one), so `branch:` matches ANY branch it touched, not just the
  // one it ended on — otherwise a third of history is invisible to the filter.
  if (q.branch && !r.branches.some((b) => b.toLowerCase() === q.branch)) {
    return false;
  }
  if (q.repo && r.repo.toLowerCase() !== q.repo) return false;
  if (q.live !== undefined && Boolean(r.live) !== q.live) return false;
  if (q.state && (r.state || "").toLowerCase() !== q.state) return false;
  return true;
}

const SNIPPET_PAD = 70;

// A window of text around the first hit, collapsed to one line and ellipsed on
// whichever side was cut.
export function snippetAround(text: string, needle: string): string {
  const i = text.toLowerCase().indexOf(needle);
  if (i === -1) return "";
  const start = Math.max(0, i - SNIPPET_PAD);
  const end = Math.min(text.length, i + needle.length + SNIPPET_PAD);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function hasAll(hay: string, terms: string[]): boolean {
  return terms.every((t) => hay.includes(t));
}

// Snippet around whichever term actually appears in this text.
function snippetFor(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const hit = terms.find((t) => lower.includes(t));
  return hit ? snippetAround(text, hit) : "";
}

export function matchContext(q: Query, r: ContextRecord): Match | null {
  if (!passesFilters(q, r)) return null;

  // Filters with no free text: everything that passed is a hit, ranked by
  // recency alone (score 0 — the caller's recency tiebreak orders them).
  if (!q.terms.length) return { rec: r, score: 0, snippet: "", where: "meta" };

  const title = r.title.toLowerCase();
  if (hasAll(title, q.terms)) {
    return { rec: r, score: 100, snippet: "", where: "title" };
  }

  // Terms are ANDed, and the strongest hit is one message carrying all of them.
  // Your own words rank above Claude's: you remember what you asked for far
  // better than what came back.
  let best: Match | null = null;
  const found = new Set(q.terms.filter((t) => title.includes(t)));
  let firstHit = "";

  for (const m of r.messages) {
    const lower = m.text.toLowerCase();
    let hits = 0;
    for (const t of q.terms) {
      if (!lower.includes(t)) continue;
      found.add(t);
      hits++;
      if (!firstHit) firstHit = m.text;
    }
    if (hits < q.terms.length) continue;
    const score = m.role === "u" ? 60 : 40;
    if (!best || score > best.score) {
      best = {
        rec: r,
        score,
        snippet: snippetFor(m.text, q.terms),
        where: "message",
      };
      if (score === 60) break; // can't beat a user-message hit
    }
  }
  if (best) return best;

  // Terms scattered across the session still count — you remember discussing
  // both things, not necessarily in one breath. Ranked below a single message
  // that has them all.
  if (found.size === q.terms.length) {
    return {
      rec: r,
      score: 20,
      snippet: snippetFor(firstHit, q.terms),
      where: "message",
    };
  }
  return null;
}

// Rank matches: score first, then recency. Returns a new array.
export function rankMatches(matches: Match[]): Match[] {
  return [...matches].sort(
    (a, b) => b.score - a.score || b.rec.updatedAt - a.rec.updatedAt,
  );
}

export function searchContexts(input: string, recs: ContextRecord[]): Match[] {
  const q = parseQuery(input);
  const out: Match[] = [];
  for (const r of recs) {
    const m = matchContext(q, r);
    if (m) out.push(m);
  }
  return rankMatches(out);
}
