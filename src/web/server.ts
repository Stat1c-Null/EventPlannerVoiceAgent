import { createServer, type Server, type ServerResponse } from "node:http";
import { shareUrl } from "../config.ts";
import type { EventStore } from "../store/events.ts";
import { normalizeEventId } from "../store/ids.ts";
import type { EventPlan } from "../types.ts";
import { renderIcs } from "./calendar.ts";
import { publicPlan, renderHome, renderNotFound, renderPlan } from "./render.ts";

export interface WebDeps {
  store: Pick<EventStore, "get">;
  publicBaseUrl: string;
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
    "frame-src https://www.openstreetmap.org; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
};

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": contentType, ...extraHeaders });
  res.end(body);
}

const html = (res: ServerResponse, status: number, body: string) =>
  send(res, status, "text/html; charset=utf-8", body);

const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body));

const redirect = (res: ServerResponse, location: string) =>
  send(res, 302, "text/plain; charset=utf-8", "", { Location: location });

function lookup(deps: WebDeps, encodedId: string): EventPlan | null {
  let id: string;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return null;
  }
  return deps.store.get(id);
}

function route(deps: WebDeps, method: string, rawUrl: string, res: ServerResponse): void {
  if (method !== "GET" && method !== "HEAD") {
    send(res, 405, "text/plain; charset=utf-8", "Method not allowed", { Allow: "GET, HEAD" });
    return;
  }
  const url = new URL(rawUrl, "http://localhost");
  const path = url.pathname;

  if (path === "/") return html(res, 200, renderHome());

  if (path === "/e") {
    const id = normalizeEventId(url.searchParams.get("id") ?? "");
    return redirect(res, id ? `/e/${encodeURIComponent(id)}` : "/");
  }

  const calendarMatch = /^\/e\/([^/]+)\/calendar\.ics$/.exec(path);
  if (calendarMatch) {
    const plan = lookup(deps, calendarMatch[1]!);
    const ics = plan ? renderIcs(plan, shareUrl(deps.publicBaseUrl, plan.id)) : null;
    if (!plan || !ics) return html(res, 404, renderNotFound());
    return send(res, 200, "text/calendar; charset=utf-8", ics, {
      "Content-Disposition": `attachment; filename="${plan.id}.ics"`,
    });
  }

  const pageMatch = /^\/e\/([^/]+)$/.exec(path);
  if (pageMatch) {
    const plan = lookup(deps, pageMatch[1]!);
    return plan
      ? html(res, 200, renderPlan(plan, shareUrl(deps.publicBaseUrl, plan.id)))
      : html(res, 404, renderNotFound());
  }

  const apiMatch = /^\/api\/events\/([^/]+)$/.exec(path);
  if (apiMatch) {
    const plan = lookup(deps, apiMatch[1]!);
    return plan ? json(res, 200, publicPlan(plan)) : json(res, 404, { error: "not_found" });
  }

  return html(res, 404, renderNotFound());
}

export function createWebServer(deps: WebDeps): Server {
  return createServer((req, res) => {
    try {
      route(deps, req.method ?? "GET", req.url ?? "/", res);
    } catch (err) {
      console.error("Web request failed:", err);
      if (!res.headersSent) send(res, 500, "text/plain; charset=utf-8", "Internal server error");
      else res.end();
    }
  });
}
