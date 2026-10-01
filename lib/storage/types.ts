/**
 * Storage contracts.
 *
 * Split out of `index.ts` so the MongoDB adapter can implement `Store` without
 * importing the module that decides whether to construct it. A circular import
 * between the resolver and the adapter works until the first lazy branch is
 * taken, then fails at runtime instead of at build time.
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
  readonly kind: "memory" | "http" | "mongo";
  saveToolRequest(record: ToolRequestRecord): Promise<void>;
  listToolRequests(): Promise<ToolRequestRecord[]>;
  updateToolRequestStatus(
    id: string,
    status: ToolRequestRecord["status"],
  ): Promise<ToolRequestRecord | null>;
  deleteToolRequest(id: string): Promise<boolean>;
  saveContact(record: ContactRecord): Promise<void>;
  /** Only the durable backends can list contacts; memory and http cannot. */
  listContacts?(): Promise<ContactRecord[]>;
}