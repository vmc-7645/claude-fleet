// Usage — estimated tokens & cost per session, today vs earlier. SPEC (Manage).

import { List, Icon, Color } from "@raycast/api";
import { useEffect, useState } from "react";
import { basename } from "path";
import { readTranscripts, TranscriptMeta } from "./lib/history";
import { costOf, totalTokens, fmtCost, fmtTokens } from "./lib/usage";

export default function Command() {
  const [rows, setRows] = useState<TranscriptMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const metas = [...readTranscripts().values()].filter(
      (m) => totalTokens(m) > 0,
    );
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    setRows(metas);
    setIsLoading(false);
  }, []);

  const startOfToday = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const today = rows.filter((r) => r.updatedAt >= startOfToday);
  const earlier = rows.filter((r) => r.updatedAt < startOfToday);
  const sumCost = (a: TranscriptMeta[]) => a.reduce((n, r) => n + costOf(r), 0);
  const sumTok = (a: TranscriptMeta[]) =>
    a.reduce((n, r) => n + totalTokens(r), 0);

  const Item = (r: TranscriptMeta) => (
    <List.Item
      key={r.sessionId}
      icon={{ source: Icon.Coins, tintColor: Color.Yellow }}
      title={basename(r.cwd) || "?"}
      subtitle={r.title}
      accessories={[
        { text: fmtCost(costOf(r)) },
        { tag: fmtTokens(totalTokens(r)) },
      ]}
    />
  );

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Cost is est. at API rates — not your subscription bill"
    >
      {!isLoading && rows.length === 0 && (
        <List.EmptyView
          icon={{ source: Icon.Coins, tintColor: Color.Yellow }}
          title="No usage yet"
          description="Sessions with token usage will show estimated cost here."
        />
      )}
      <List.Section
        title={`Today — ~${fmtCost(sumCost(today))} API-equiv · ${fmtTokens(sumTok(today))} tokens`}
      >
        {today.map(Item)}
      </List.Section>
      <List.Section
        title={`Earlier — ~${fmtCost(sumCost(earlier))} API-equiv · ${fmtTokens(sumTok(earlier))} tokens`}
      >
        {earlier.map(Item)}
      </List.Section>
    </List>
  );
}
