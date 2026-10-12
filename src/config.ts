export interface AppConfig {
  placesApiKey?: string;
  agentNumber: string;
  publicBaseUrl: string;
  port: number;
  dbPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT || "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${env.PORT}"`);
  }
  return {
    placesApiKey: env.GOOGLE_PLACES_API_KEY || undefined,
    agentNumber: env.GUAVA_AGENT_NUMBER || "+12402514603",
    publicBaseUrl: (env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),
    port,
    dbPath: env.EVENTS_DB_PATH || "./events.db",
  };
}

export function shareUrl(publicBaseUrl: string, eventId: string): string {
  return `${publicBaseUrl}/e/${encodeURIComponent(eventId)}`;
}
