import { DatabaseSync } from "node:sqlite";
import type { EventPlan } from "../types.ts";
import { generateEventId, normalizeEventId } from "./ids.ts";

const MAX_ID_ATTEMPTS = 20;

export class EventStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(
      "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
  }

  create(plan: Omit<EventPlan, "id">, random: () => number = Math.random): EventPlan {
    const insert = this.#db.prepare(
      "INSERT OR IGNORE INTO events (id, json, created_at) VALUES (?, ?, ?)",
    );
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      const saved: EventPlan = { id: generateEventId(random), ...plan };
      const result = insert.run(saved.id, JSON.stringify(saved), saved.createdAt);
      if (Number(result.changes) === 1) return saved;
    }
    throw new Error(`Could not allocate a unique event ID after ${MAX_ID_ATTEMPTS} attempts`);
  }

  get(id: string): EventPlan | null {
    const row = this.#db
      .prepare("SELECT json FROM events WHERE id = ?")
      .get(normalizeEventId(id)) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as EventPlan) : null;
  }

  close(): void {
    this.#db.close();
  }
}
