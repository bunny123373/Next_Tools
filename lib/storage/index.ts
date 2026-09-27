import "server-only";

/**
 * Storage adapter.
 *
 * Deliberately abstract so the platform runs with zero configuration while
 * still being honest about where submissions go. There are no database
 * credentials in this repository and there never will be — the operator supplies
 * an endpoint, and we POST to it.
 *
 *   - No `TOOL_REQUESTS_ENDPOINT`  → in-memory (dev). Data is lost on restart.
 *   - `TOOL_REQUESTS_ENDPOINT` set → forwarded to that service.
 *   - `DATABASE_URL` set            → see the note in resolveStore(); a real
 *                                     adapter should be implemented here.
 *
 * Adding a database means writing one class below. Nothing else changes.
 */

export interface ToolRequestRecord {
  id: string;
  toolName: string;
  category: string;
  description: string;
  reason?: string;
  email?: string;
  createdAt: string;
  status: "pending" | "planned" | "completed";
}

export interface ContactRecord {
  id: string;
  name: string;
  email: string;
  message: string;
  context?: string;
  createdAt: string;
}

export interface Store {
  readonly kind: "memory" | "http";
  saveToolRequest(record: ToolRequestRecord): Promise<void>;
  listToolRequests(): Promise<ToolRequestRecord[]>;
  updateToolRequestStatus(
    id: string,
    status: ToolRequestRecord["status"],
  ): Promise<ToolRequestRecord | null>;
  deleteToolRequest(id: string): Promise<boolean>;
  saveContact(record: ContactRecord): Promise<void>;
}

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

  const endpoint = process.env.TOOL_REQUESTS_ENDPOINT;
  if (endpoint) {
    cached = new HttpStore(endpoint, process.env.TOOL_REQUESTS_TOKEN);
  } else {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[store] TOOL_REQUESTS_ENDPOINT is not set. Submissions are being held in memory and " +
          "will be lost when the process restarts. Set it before going live.",
      );
    }
    cached = new MemoryStore();
  }

  return cached;
}

/** Describes the active backend, for /admin/settings. No secrets. */
export function describeStore(): {
  kind: Store["kind"];
  persistent: boolean;
  hint: string;
} {
  const kind = getStore().kind;
  return {
    kind,
    persistent: kind === "http",
    hint:
      kind === "http"
        ? "Submissions are forwarded to the configured endpoint and persist there."
        : "Submissions are held in memory. Set TOOL_REQUESTS_ENDPOINT to persist them.",
  };
}

/** Test helper. */
export function resetMemoryStore(): void {
  toolRequests.clear();
  contacts.length = 0;
}
