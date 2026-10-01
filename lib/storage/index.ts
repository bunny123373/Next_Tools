import "server-only";

import type { ContactRecord, Store, ToolRequestRecord } from "./types";
import { MongoStore } from "./mongo";

/**
 * Storage adapter.
 *
 * Deliberately abstract so the platform runs with zero configuration while
 * still being honest about where submissions go.
 *
 *   - `DATABASE_URL` set            → MongoDB. This is the real, durable one.
 *   - `TOOL_REQUESTS_ENDPOINT` set → forwarded to an operator's HTTP service.
 *   - Neither                     → in-memory. Data is lost on restart, and
 *                                   /admin and /api/health both say so.
 *
 * MongoDB wins when both are present: a database is the better answer than
 * posting JSON at an endpoint, and an operator who sets both almost certainly
 * meant the database.
 *
 * The connection string is never logged and never returned by describeStore().
 */

export type { ContactRecord, Store, ToolRequestRecord } from "./types";

/* ------------------------------------------------------------------ */
/*  In-memory (development / single instance, no configuration)         */
/* ------------------------------------------------------------------ */

const toolRequests = new Map<string, ToolRequestRecord>();
const contacts: ContactRecord[] = [];

class MemoryStore implements Store {
  readonly kind = "memory" as const;

  async saveToolRequest(record: ToolRequestRecord) {
    toolRequests.set(record.id, record);
  }

  async listToolRequests() {
    return [...toolRequests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateToolRequestStatus(id: string, status: ToolRequestRecord["status"]) {
    const existing = toolRequests.get(id);
    if (!existing) return null;
    const updated = { ...existing, status };
    toolRequests.set(id, updated);
    return updated;
  }

  async deleteToolRequest(id: string) {
    return toolRequests.delete(id);
  }

  async saveContact(record: ContactRecord) {
    contacts.push(record);
  }
}

/* ------------------------------------------------------------------ */
/*  HTTP (forward to an operator-supplied service)                      */
/* ------------------------------------------------------------------ */

class HttpStore implements Store {
  readonly kind = "http" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl).toString(), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...init?.headers,
      },
      // Submissions are one-shot; a CDN cache would be wrong here.
      cache: "no-store",
    });

    if (!response.ok) {
      // Log the status only. The upstream body may contain infrastructure
      // detail that must not reach our caller.
      console.error(`[store] ${path} responded ${response.status}`);
      throw new Error(`Upstore responded ${response.status}`);
    }
    return (await response.json()) as T;
  }

  saveToolRequest(record: ToolRequestRecord) {
    return this.request<void>("/tool-requests", {
      method: "POST",
      body: JSON.stringify(record),
    });
  }

  listToolRequests() {
    return this.request<ToolRequestRecord[]>("/tool-requests");
  }

  updateToolRequestStatus(id: string, status: ToolRequestRecord["status"]) {
    return this.request<ToolRequestRecord>(`/tool-requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  async deleteToolRequest(id: string) {
    await this.request<void>(`/tool-requests/${encodeURIComponent(id)}`, { method: "DELETE" });
    return true;
  }

  saveContact(record: ContactRecord) {
    return this.request<void>("/contact", {
      method: "POST",
      body: JSON.stringify(record),
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Resolution                                                         */
/* ------------------------------------------------------------------ */

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;

  const uri = process.env.DATABASE_URL;
  if (uri) {
    cached = new MongoStore(uri);
    return cached;
  }

  const endpoint = process.env.TOOL_REQUESTS_ENDPOINT;
  if (endpoint) {
    cached = new HttpStore(endpoint, process.env.TOOL_REQUESTS_TOKEN);
  } else {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[store] Neither DATABASE_URL nor TOOL_REQUESTS_ENDPOINT is set. Submissions are being " +
          "held in memory and will be lost when the process restarts. Set DATABASE_URL before " +
          "going live.",
      );
    }
    cached = new MemoryStore();
  }

  return cached;
}

/**
 * Describes the active backend, for /admin/settings and /api/health.
 *
 * Presence only. A connection string is a credential, so nothing here or in any
 * caller may include one — `describeStore()` is returned by a public endpoint.
 */
export function describeStore(): {
  kind: Store["kind"];
  persistent: boolean;
  hint: string;
} {
  const kind = getStore().kind;
  const hints: Record<Store["kind"], string> = {
    mongo: "Submissions are stored in MongoDB and persist.",
    http: "Submissions are forwarded to the configured endpoint and persist there.",
    memory: "Submissions are held in memory and lost on restart. Set DATABASE_URL.",
  };
  return { kind, persistent: kind !== "memory", hint: hints[kind] };
}

/** Test helper. */
export function resetMemoryStore(): void {
  toolRequests.clear();
  contacts.length = 0;
}
