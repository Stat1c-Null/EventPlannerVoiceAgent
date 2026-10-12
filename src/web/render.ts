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
:root{--bg:#faf7f2;--card:#fff;--text:#1f1b16;--muted:#6b645b;--accent:#c2410c;--border:#e7e0d6;--badge:#fde7d8;--warn:#fef3c7}
@media (prefers-color-scheme: dark){:root{--bg:#171412;--card:#221e1b;--text:#f3ede6;--muted:#a89f94;--accent:#fb923c;--border:#3a332d;--badge:#3b2416;--warn:#3a2f12}}
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
button{background:var(--accent);color:#fff;border:none;cursor:pointer}
form{display:flex;gap:8px;flex-wrap:wrap}
input{flex:1;min-width:0;text-transform:uppercase}
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

function formatWhen(when: string): string {
  const date = new Date(when);
  if (!when || Number.isNaN(date.getTime())) return when;
  return date.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
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
  const facts = [
    formatWhen(plan.basics.when),
    plan.basics.area,
    plan.basics.partySize ? `${plan.basics.partySize} people` : "",
    plan.basics.budget ? `Budget: ${plan.basics.budget}` : "",
  ].filter(Boolean);

  const body = `
<span class="badge">${escapeHtml(TYPE_LABELS[plan.type])}</span>
<h1>${escapeHtml(plan.title)}</h1>
<p class="muted">${facts.map(escapeHtml).join(" · ")}</p>
<p class="muted">Event ID <span class="code">${escapeHtml(plan.id)}</span></p>
${plan.status === "incomplete" ? `<div class="banner">This plan is not finished — the call ended before everything was confirmed.</div>` : ""}
${plan.items.length > 0 ? plan.items.map(renderItem).join("\n") : `<p class="card">Nothing was booked for this event.</p>`}
<p><button type="button" id="copy" data-url="${escapeHtml(shareLink)}">Copy link</button></p>
<p class="muted">${escapeHtml(shareLink)}</p>
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
