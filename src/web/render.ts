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

const KIND_ICONS: Record<PlanItemKind, string> = {
  dinner: "🍽️",
  food: "🍔",
  activity: "🎟️",
  venue: "🏢",
  catering: "🥪",
  parking: "🅿️",
  gift: "🎁",
};

/** Degrees added around the located items so the map isn't cropped tight to the pins. */
const MAP_PADDING = 0.005;

const STYLES = `
:root{--bg:#f8f7fc;--card:#fff;--text:#1c1a24;--muted:#66617a;--accent:#7c3aed;--on-accent:#fff;--border:#e4e0f0;--badge:#ede9fe;--warn:#fef3c7;--tint:var(--accent);--tint-soft:var(--badge)}
@media (prefers-color-scheme: dark){:root{--bg:#14121b;--card:#1f1c29;--text:#f1eff7;--muted:#a49fb6;--accent:#a78bfa;--on-accent:#1a1030;--border:#353046;--badge:#2e1f52;--warn:#3a2f12}}
.theme-date{--tint:#e11d48;--tint-soft:#ffe4e6}
.theme-friends{--tint:#0d9488;--tint-soft:#ccfbf1}
.theme-business{--tint:#475569;--tint-soft:#e2e8f0}
@media (prefers-color-scheme: dark){.theme-date{--tint:#fb7185;--tint-soft:#3f1020}.theme-friends{--tint:#2dd4bf;--tint-soft:#0f2f2c}.theme-business{--tint:#94a3b8;--tint-soft:#1f2937}}
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
button:hover,.action:hover{filter:brightness(1.08)}
form{display:flex;gap:8px;flex-wrap:wrap}
input{flex:1;min-width:0;text-transform:uppercase}
.hero{background:linear-gradient(135deg,var(--tint-soft),var(--badge));border:1px solid var(--border);border-radius:20px;padding:24px 20px}
.hero .type{background:var(--card);color:var(--tint)}
.hero h1{font-size:2rem;margin:12px 0 6px}
.hero-date{font-size:1.2rem;font-weight:600;margin:0 0 16px}
.id-chip{display:inline-flex;align-items:center;gap:8px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:999px;padding:6px 14px;font:600 .95rem ui-monospace,SFMono-Regular,Menlo,monospace}
.id-chip span{color:var(--muted)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:16px 0}
.facts div{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 12px}
.facts dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.facts dd{margin:2px 0 0;font-weight:600}
.facts .sub{display:block;font-weight:400;color:var(--muted)}
.timeline{list-style:none;margin:24px 0;padding:0;position:relative}
.timeline::before{content:"";position:absolute;left:21px;top:34px;bottom:34px;width:2px;background:var(--tint);opacity:.35}
.stop{display:grid;grid-template-columns:44px 1fr;gap:12px;align-items:start}
.marker{width:44px;height:44px;margin-top:12px;border-radius:50%;background:var(--tint-soft);border:2px solid var(--tint);display:grid;place-items:center;font-size:1.2rem;position:relative}
.map h2,.share h2{font-size:1rem;margin:0;color:var(--muted);font-weight:600}
.map{margin:32px 0 0;display:flex;flex-direction:column;gap:12px}
.map iframe{width:100%;height:260px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.action{display:inline-block;padding:12px 20px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--accent);font-weight:600;text-decoration:none;text-align:center}
.share{margin:40px 0 0;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.share-link{display:inline-block;max-width:100%;padding:10px 16px;border:1px solid var(--border);border-radius:999px;background:var(--badge);color:var(--accent);font:600 .95rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none;overflow-wrap:anywhere}
.share-link:hover{border-color:var(--accent)}
.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.share button{min-width:160px;padding:12px 20px}
`;

// Any element with data-copy copies that value and briefly says so.
const COPY_SCRIPT = `
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const label = button.innerHTML;
    try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = "Copied!"; }
    catch { button.textContent = button.dataset.copy; }
    setTimeout(() => { button.innerHTML = label; }, 1500);
  });
}
`;

function page(title: string, body: string, bodyClass = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}><main>${body}</main></body>
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

function renderHero(plan: EventPlan): string {
  const when = whenParts(plan.basics.when);
  const dateLine = when ? `${when.date} · ${when.time}` : plan.basics.when || "Date not set";
  return `<header class="hero">
  <span class="badge type">${escapeHtml(TYPE_LABELS[plan.type])}</span>
  <h1>${escapeHtml(plan.title)}</h1>
  <p class="hero-date">${escapeHtml(dateLine)}</p>
  <button type="button" class="id-chip" data-copy="${escapeHtml(plan.id)}" title="Copy event ID">${escapeHtml(plan.id)} <span aria-hidden="true">⧉</span></button>
</header>`;
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

function renderStop(item: PlanItem): string {
  const maps = safeHttpsUrl(item.mapsUrl);
  const time = item.time ? whenParts(item.time)?.time ?? item.time : "";
  return `<li class="stop">
  <span class="marker" aria-hidden="true">${KIND_ICONS[item.kind]}</span>
  <section class="card">
    <div class="kind">${escapeHtml(KIND_LABELS[item.kind])}${time ? ` · ${escapeHtml(time)}` : ""}</div>
    <h2>${escapeHtml(item.name)}</h2>
    <div class="muted">${escapeHtml(item.address)}</div>
    ${maps ? `<div><a href="${escapeHtml(maps)}" target="_blank" rel="noopener noreferrer">Open in Maps</a></div>` : ""}
    ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
    <p>Confirmation <span class="code">${escapeHtml(item.confirmation.code)}</span> <span class="badge">Simulated</span></p>
  </section>
</li>`;
}

function renderTimeline(items: PlanItem[]): string {
  if (items.length === 0) return `<p class="card">Nothing was booked for this event.</p>`;
  return `<ol class="timeline">${items.map(renderStop).join("\n")}</ol>`;
}

/** OpenStreetMap embed (no API key in the page) pinned on the first located item. */
function osmEmbedUrl(items: PlanItem[]): string | null {
  const points = items.flatMap((item) => (item.location ? [item.location] : []));
  const pin = points[0];
  if (!pin) return null;
  const round = (n: number) => String(Number(n.toFixed(5)));
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const bbox = [
    Math.min(...lngs) - MAP_PADDING,
    Math.min(...lats) - MAP_PADDING,
    Math.max(...lngs) + MAP_PADDING,
    Math.max(...lats) + MAP_PADDING,
  ].map(round).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${round(pin.lat)},${round(pin.lng)}`;
}

/** Google Maps walking directions from the parking spot to the first non-parking stop. */
function walkingDirectionsUrl(items: PlanItem[]): { url: string; to: string } | null {
  const parking = items.find((item) => item.kind === "parking");
  const destination = items.find((item) => item.kind !== "parking");
  if (!parking || !destination) return null;
  const url =
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${encodeURIComponent(parking.address)}` +
    `&destination=${encodeURIComponent(destination.address)}&travelmode=walking`;
  return { url, to: destination.name };
}

function renderMap(items: PlanItem[]): string {
  const embed = osmEmbedUrl(items);
  const directions = walkingDirectionsUrl(items);
  if (!embed && !directions) return "";
  return `<section class="map">
  <h2>Getting there</h2>
  ${embed ? `<iframe title="Map of the plan" src="${escapeHtml(embed)}" loading="lazy" referrerpolicy="no-referrer"></iframe>` : ""}
  ${directions ? `<a class="action" href="${escapeHtml(directions.url)}" target="_blank" rel="noopener noreferrer">🚶 Walking directions from parking to ${escapeHtml(directions.to)}</a>` : ""}
</section>`;
}

function renderShare(plan: EventPlan, shareLink: string): string {
  const calendar = whenParts(plan.basics.when)
    ? `<a class="action" href="/e/${encodeURIComponent(plan.id)}/calendar.ics">📅 Add to calendar</a>`
    : "";
  return `<section class="share">
  <h2>Share this plan</h2>
  <a class="share-link" href="${escapeHtml(shareLink)}">${escapeHtml(shareLink)}</a>
  <div class="actions">
    <button type="button" id="copy" data-copy="${escapeHtml(shareLink)}">Copy link</button>
    ${calendar}
  </div>
</section>`;
}

export function renderPlan(plan: EventPlan, shareLink: string): string {
  const body = `
${renderHero(plan)}
${renderFacts(plan.basics)}
${plan.status === "incomplete" ? `<div class="banner">This plan is not finished — the call ended before everything was confirmed.</div>` : ""}
${renderTimeline(plan.items)}
${renderMap(plan.items)}
${renderShare(plan, shareLink)}
<script>${COPY_SCRIPT}</script>`;
  return page(plan.title, body, `theme-${plan.type}`);
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
