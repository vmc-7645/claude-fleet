// The query language for Contexts: `branch:foo repo:bar is:live retry backoff`
// — filter tokens are lifted out, whatever's left is full-text over the title
// and the message bodies. Pure (no fs, no git) so it can be unit-tested; the
// index that feeds it lives in ./contexts. SPEC §5.9, §6.5.

import { ContextRecord } from "./contexts";

export interface Query {
  text: string; // free text, lowercased; "" = match everything
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

// Tokens are `key:value`; a bare word is free text. Values are lowercased for
// comparison but a trailing `:` alone (a user mid-type) is treated as text, not
// a filter, so the list doesn't blank out between keystrokes.
const FILTER = /^(branch|repo|is|state):(.*)$/;

export function parseQuery(input: string): Query {
  const q: Query = { text: "" };
  const words: string[] = [];
  for (const raw of input.trim().split(/\s+/)) {
    if (!raw) continue;
    const m = raw.match(FILTER);
    if (!m || !m[2]) {
      words.push(raw);
      continue;
    }
    const [, key, value] = m;
    const v = value.toLowerCase();
    if (key === "branch") q.branch = v;
    else if (key === "repo") q.repo = v;
    else if (key === "state") q.state = v;
    else if (key === "is") {
      if (v === "live") q.live = true;
      else if (v === "idle" || v === "dead") q.live = false;
      else words.push(raw); // unknown is:… — treat as text, not a silent no-op
    }
  }
  q.text = words.join(" ").toLowerCase();
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

export function matchContext(q: Query, r: ContextRecord): Match | null {
  if (!passesFilters(q, r)) return null;

  // Filters with no free text: everything that passed is a hit, ranked by
  // recency alone (score 0 — the caller's recency tiebreak orders them).
  if (!q.text) return { rec: r, score: 0, snippet: "", where: "meta" };

  const title = r.title.toLowerCase();
  if (title.includes(q.text)) {
    return { rec: r, score: 100, snippet: "", where: "title" };
  }

  // Your own words rank above Claude's: you remember what you asked for far
  // better than what came back.
  let best: Match | null = null;
  for (const m of r.messages) {
    const at = m.text.toLowerCase().indexOf(q.text);
    if (at === -1) continue;
    const score = m.role === "u" ? 60 : 40;
    if (!best || score > best.score) {
      best = { rec: r, score, snippet: snippetAround(m.text, q.text), where: "message" };
      if (score === 60) break; // can't beat a user-message hit
    }
  }
  return best;
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
