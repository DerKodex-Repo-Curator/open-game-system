import { BETS, judge, type Check, type Status } from "./bets";
import type { Windows } from "./board";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (c: Check) => {
  if (c.value === null) return "–";
  const n = c.format === "percent" ? `${Math.round(c.value * 100)}%` : c.value.toLocaleString("en-US");
  return c.source === "estimate" ? `≈ ${n}` : n;
};
const LABEL: Record<Status, string> = { running: "Running", pass: "Pass", fail: "Fail", between: "In between", missing: "Can't tell yet" };
const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/Los_Angeles" });

/** Things the board can't see, beyond the per-check gaps. */
const CAVEATS = [
  "Workers Logs keeps a sample on this account (sampleInterval 10): try-path link opens and rounds are estimates (≈), good to about ±30% at 100. Exact counts need the Workers Observability API (an API token with Workers Observability read) or a rounds counter in each game.",
  "Trivia Jam's round event (client.round_started) carries no ref, so its rounds can't be split by source.",
  "The front door's tally counts from its first snapshot here (this board started snapshotting on Sun 10-18): earlier taps sit in the baseline, not in the bets.",
  "The games' e2e tests open the try paths with ?ref=hn. After Wed 10-21 8am PT, run them with another ref (or not at all) so they don't count as HN visitors.",
  "Bet 5's second read (≥ 2 co-op households host at home by Mon 11-02) needs those households' profiles marked as co-op: nothing tags them yet.",
];

/** The scoreboard page: each bet, its checks against its lines, then what can't be measured yet. */
export function render(windows: Windows, now: Date, updatedAt: string, health: Record<string, string> = {}): string {
  const cards = BETS.map((bet) => {
    const inputs = windows[bet.from.toISOString()];
    if (!inputs) return `<section class="bet"><h2>${bet.n}. ${esc(bet.title)}</h2><p class="muted">No data gathered yet.</p></section>`;
    const v = judge(bet, inputs, now);
    const rows = v.checks
      .map(
        (c) =>
          `<tr class="${c.source}"><td>${esc(c.label)}</td><td class="num">${esc(fmt(c))}</td><td>${esc(c.target)}</td><td class="note">${esc(c.source === "missing" ? `Missing: ${c.note}` : c.note)}</td></tr>`,
      )
      .join("");
    return `<section class="bet"><div class="head"><h2>${bet.n}. ${esc(bet.title)}</h2><span class="status ${v.status}">${LABEL[v.status]}</span></div>
<p class="lines"><b>Pass:</b> ${esc(bet.pass)}. <b>Fail:</b> ${esc(bet.fail)}. Counting from ${day(bet.from)}, read ${day(bet.read)}.</p>
<table><thead><tr><th>Measure</th><th>Now</th><th>Line</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("\n");
  const missing = BETS.flatMap((bet) => {
    const inputs = windows[bet.from.toISOString()];
    return inputs ? judge(bet, inputs, now).checks.filter((c) => c.source === "missing").map((c) => `<li><b>Bet ${bet.n}, ${esc(c.label)}:</b> ${esc(c.note)}</li>`) : [];
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bets scoreboard</title><meta name="robots" content="noindex">
<style>
:root{--bg:#f7f6f2;--card:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e4e2dc;--pass:#1f7a3a;--fail:#b3261e;--run:#3557c4;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d21;--ink:#ececef;--muted:#9a9aa2;--line:#2c2c33;--pass:#5cc27d;--fail:#ff8a80;--run:#8fa8ff;--warn:#e3b341}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 48px}h1{font-size:24px;margin:0 0 4px}.muted{color:var(--muted)}
.bet{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}
.head{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h2{font-size:17px;margin:0}
.status{font-weight:700;font-size:13px;padding:3px 10px;border-radius:99px;border:1.5px solid currentColor;white-space:nowrap}
.status.pass{color:var(--pass)}.status.fail{color:var(--fail)}.status.running{color:var(--run)}.status.between,.status.missing{color:var(--warn)}
.lines{color:var(--muted);margin:8px 0 12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 8px;border-top:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600}.num{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}.note{color:var(--muted);font-size:13px}
tr.missing .num{color:var(--warn)}ul{padding-left:20px}li{margin:6px 0}
@media (max-width:640px){th:nth-child(4),td.note{display:none}}
</style></head><body><main>
<h1>Distribution bets scoreboard</h1>
<p class="muted">Week of Mon 10-19 (docs/research/next-week-bets.md). Updated ${esc(updatedAt)}. Every 15 minutes from what OGS already records: opengame-api's tables, the front door's tally, the docs waitlist, Workers Logs and the Hacker News API.</p>
<form method="post" action="/refresh"><button>Refresh now</button></form>
${cards}
<section class="bet"><h2>Sources</h2><table><tbody>${Object.entries(health).map(([name, state]) => `<tr><td>${esc(name)}</td><td class="note">${esc(state)}</td></tr>`).join("") || `<tr><td class="note">Not read yet.</td></tr>`}</tbody></table></section>
<section class="bet"><h2>Can't measure yet</h2><ul>${missing.join("")}${CAVEATS.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></section>
</main></body></html>`;
}
