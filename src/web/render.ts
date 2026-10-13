import { toLocalIso } from "../datetime.ts";
import { formatUsd } from "../money.ts";
import type { EventPlan, PlanItem, PlanItemKind } from "../types.ts";

export type PublicPlan = Omit<EventPlan, "callerPhone">;

export function publicPlan(plan: EventPlan): PublicPlan {
  const { callerPhone: _callerPhone, ...rest } = plan;
  return rest;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

const TYPE_LABELS: Record<EventPlan["type"], string> = {
  date: "Date",
  friends: "Friends hangout",
  business: "Business event",
};

const KIND_LABELS: Record<PlanItemKind, string> = {
  dinner: "Dinner",
  food: "Food",
  activity: "Activity",
  venue: "Venue",
  catering: "Catering",
  parking: "Parking",
  gift: "Gift",
};

const STYLES = `
:root{--bg:#f8f7fc;--card:#fff;--text:#1c1a24;--muted:#66617a;--accent:#7c3aed;--on-accent:#fff;--border:#e4e0f0;--badge:#ede9fe;--warn:#fef3c7}
@media (prefers-color-scheme: dark){:root{--bg:#14121b;--card:#1f1c29;--text:#f1eff7;--muted:#a49fb6;--accent:#a78bfa;--on-accent:#1a1030;--border:#353046;--badge:#2e1f52;--warn:#3a2f12}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;line-height:1.2;margin:8px 0}
a{color:var(--accent)}
.muted{color:var(--muted)}
.badge{display:inline-block;background:var(--badge);color:var(--accent);border-radius:999px;padding:2px 10px;font-size:.8rem;font-weight:600}
.banner{background:var(--warn);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin:16px 0}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin:12px 0}
.card h2{font-size:1.1rem;margin:4px 0}
.kind{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
button,input{font:inherit;border-radius:10px;border:1px solid var(--border);padding:10px 14px;background:var(--card);color:var(--text)}
button{background:var(--accent);color:var(--on-accent);border:none;cursor:pointer;font-weight:600}
button:hover{filter:brightness(1.08)}
.share{margin:40px 0 0;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.share h2{font-size:1rem;margin:0;color:var(--muted);font-weight:600}
.share-link{display:inline-block;max-width:100%;padding:10px 16px;border:1px solid var(--border);border-radius:999px;background:var(--badge);color:var(--accent);font:600 .95rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none;overflow-wrap:anywhere}
.share-link:hover{border-color:var(--accent)}
.share button{min-width:160px;padding:12px 20px}
form{display:flex;gap:8px;flex-wrap:wrap}
input{flex:1;min-width:0;text-transform:uppercase}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:16px 0}
.facts div{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 12px}
.facts dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.facts dd{margin:2px 0 0;font-weight:600}
.facts .sub{display:block;font-weight:400;color:var(--muted)}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/** Splits a stored time into display parts, or null when it can't be parsed. */
function whenParts(when: string): { date: string; time: string } | null {
  const iso = toLocalIso(when) ?? when;
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return null;
  // ICU puts a narrow no-break space before AM/PM; use a plain space.
  const plain = (text: string) => text.replace(/ /g, " ");
  return {
    date: plain(date.toLocaleDateString("en-US", { dateStyle: "full" })),
    time: plain(date.toLocaleTimeString("en-US", { timeStyle: "short" })),
  };
}

function formatWhen(when: string): string {
  const parts = whenParts(when);
  return parts ? `${parts.date}, ${parts.time}` : when;
}

function renderFacts(basics: EventPlan["basics"]): string {
  const when = whenParts(basics.when);
  const tiles: Array<[label: string, html: string]> = [
    ["When", when
      ? `${escapeHtml(when.date)}<span class="sub">${escapeHtml(when.time)}</span>`
      : escapeHtml(basics.when || "Not set")],
    ["Where", escapeHtml(basics.area || "Not set")],
  ];
  if (basics.partySize) {
    tiles.push(["Group", `${basics.partySize} ${basics.partySize === 1 ? "person" : "people"}`]);
  }
  if (basics.budget) tiles.push(["Budget", escapeHtml(formatUsd(basics.budget) ?? basics.budget)]);
  return `<dl class="facts">${tiles.map(([label, html]) => `<div><dt>${label}</dt><dd>${html}</dd></div>`).join("")}</dl>`;
}

function renderItem(item: PlanItem): string {
  const maps = safeHttpsUrl(item.mapsUrl);
  return `<section class="card">
  <div class="kind">${escapeHtml(KIND_LABELS[item.kind])}${item.time ? ` · ${escapeHtml(formatWhen(item.time))}` : ""}</div>
  <h2>${escapeHtml(item.name)}</h2>
  <div class="muted">${escapeHtml(item.address)}</div>
  ${maps ? `<div><a href="${escapeHtml(maps)}" target="_blank" rel="noopener noreferrer">Open in Maps</a></div>` : ""}
  ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
  <p>Confirmation <span class="code">${escapeHtml(item.confirmation.code)}</span> <span class="badge">Simulated</span></p>
</section>`;
}

export function renderPlan(plan: EventPlan, shareLink: string): string {
  const body = `
<span class="badge">${escapeHtml(TYPE_LABELS[plan.type])}</span>
<h1>${escapeHtml(plan.title)}</h1>
${renderFacts(plan.basics)}
<p class="muted">Event ID <span class="code">${escapeHtml(plan.id)}</span></p>
${plan.status === "incomplete" ? `<div class="banner">This plan is not finished — the call ended before everything was confirmed.</div>` : ""}
${plan.items.length > 0 ? plan.items.map(renderItem).join("\n") : `<p class="card">Nothing was booked for this event.</p>`}
<section class="share">
  <h2>Share this plan</h2>
  <a class="share-link" href="${escapeHtml(shareLink)}">${escapeHtml(shareLink)}</a>
  <button type="button" id="copy" data-url="${escapeHtml(shareLink)}">Copy link</button>
</section>
<script>
document.getElementById("copy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try { await navigator.clipboard.writeText(button.dataset.url); button.textContent = "Copied!"; }
  catch { button.textContent = button.dataset.url; }
});
</script>`;
  return page(plan.title, body);
}

export function renderHome(): string {
  return page(
    "Event Planner",
    `<h1>Event Planner</h1>
<p class="muted">Enter the event ID the agent gave you, like BLUE-FALCON-42.</p>
<form action="/e" method="get">
  <input name="id" placeholder="BLUE-FALCON-42" aria-label="Event ID" required autocomplete="off">
  <button type="submit">View plan</button>
</form>`,
  );
}

export function renderNotFound(): string {
  return page(
    "Plan not found",
    `<h1>Plan not found</h1>
<p class="muted">Check the event ID and try again.</p>
<p><a href="/">Look up another plan</a></p>`,
  );
}
