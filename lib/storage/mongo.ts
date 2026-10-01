import "server-only";

import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { ContactRecord, Store, ToolRequestRecord } from "./types";

/**
 * MongoDB storage.
 *
 * The connection string is read from `DATABASE_URL` and never logged, never
 * echoed into an error, and never returned by describeStore(). A credential in
 * a log line that may be shipped somewhere public is a credential in the wild.
 *
 * Two things about running this on serverless, both learned the hard way:
 *
 *   - The client is cached on `globalThis`. Without that, every request in a
 *     warm lambda opens a new connection, and Mongo's connection limit is hit
 *     long before the instance runs out of memory.
 *   - Every operation is bounded by `serverSelectionTimeoutMS`. A store that
 *     hangs turns a form submission into a request that never returns, which
 *     looks to the visitor like the site being broken. Failing fast lets the
 *     route report what actually happened.
 */

const CLIENT_TTL_MS = 45_000;

interface Cached {
  client: MongoClient;
  uri: string;
  at: number;
}

/** Survives hot reloads in dev, which otherwise leak a client per edit. */
const globalRef = globalThis as typeof globalThis & { __baluMongo?: Cached };

function cached(): Cached | undefined {
  const entry = globalRef.__baluMongo;
  if (!entry) return undefined;
  // A rotated connection string must not be served from a stale client.
  if (entry.uri !== process.env.DATABASE_URL) {
    void entry.client.close(true).catch(() => {});
    globalRef.__baluMongo = undefined;
    return undefined;
  }
  if (Date.now() - entry.at > CLIENT_TTL_MS) {
    void entry.client.close(true).catch(() => {});
    globalRef.__baluMongo = undefined;
    return undefined;
  }
  return entry;
}

async function connect(uri: string): Promise<Db> {
  const existing = cached();
  if (existing) return existing.client.db();

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
    // Fail fast rather than queueing writes we cannot confirm.
    maxPoolSize: 5,
  });

  await client.connect();
  globalRef.__baluMongo = { client, uri, at: Date.now() };

  const db = client.db();
  await ensureIndexes(db);
  return db;
}

/**
 * Creates the collections, then their indexes.
 *
 * The order is not optional. On a fresh cluster `createIndex` against a
 * collection that does not exist fails with `ns does not exist: <db>.<coll>`,
 * because there is nothing for the index to attach to and MongoDB will not
 * create the namespace on your behalf. So the collections are made first.
 *
 * `createCollection` raises `NamespaceExists` on every call after the first,
 * which is the normal case, so that one is swallowed. Anything else propagates:
 * a permissions error here must not be mistaken for success.
 */
async function ensureIndexes(db: Db): Promise<void> {
  for (const name of ["tool_requests", "contacts"]) {
    try {
      await db.createCollection(name);
    } catch (error) {
      const info = error as { codeName?: string; code?: number } | null;
      // 48 / NamespaceExists is expected. Anything else is a real failure.
      if (info?.codeName !== "NamespaceExists" && info?.code !== 48) throw error;
    }
  }

  // `createdAt` descending backs the admin list, the only place a collection
  // is read in order. Without it, /admin is a collection scan per page load
  // that grows without bound.
  const requests = db.collection<ToolRequestRecord>("tool_requests");
  await requests.createIndex({ createdAt: -1 }, { name: "createdAt_desc" });
  await requests.createIndex({ status: 1, createdAt: -1 }, { name: "status_createdAt" });

  const contacts = db.collection<ContactRecord>("contacts");
  await contacts.createIndex({ createdAt: -1 }, { name: "createdAt_desc" });
}

/** Documents written by an older version may predate a field. */
function toToolRequest(doc: Document): ToolRequestRecord {
  return {
    id: String(doc.id ?? doc._id),
    toolName: String(doc.toolName ?? ""),
    category: String(doc.category ?? ""),
    description: String(doc.description ?? ""),
    ...(doc.reason ? { reason: String(doc.reason) } : {}),
    ...(doc.email ? { email: String(doc.email) } : {}),
    createdAt: String(doc.createdAt ?? new Date(0).toISOString()),
    status: (doc.status as ToolRequestRecord["status"]) ?? "pending",
  };
}

function toContact(doc: Document): ContactRecord {
  return {
    id: String(doc.id ?? doc._id),
    name: String(doc.name ?? ""),
    email: String(doc.email ?? ""),
    message: String(doc.message ?? ""),
    ...(doc.context ? { context: String(doc.context) } : {}),
    createdAt: String(doc.createdAt ?? new Date(0).toISOString()),
  };
}

/**
 * Strips a credential out of anything that might reach a log or a response.
 *
 * The driver's own errors do not carry the connection string, but a failed
 * DNS lookup or an auth failure can quote the URI in some paths, and the one
 * thing this module must never do is help a password escape.
 */
function scrub(error: unknown): Error {
  const uri = process.env.DATABASE_URL;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
  return new Error(uri ? message.split(uri).join("[redacted]") : message);
}

export class MongoStore implements Store {
  readonly kind = "mongo" as const;

  private readonly uri: string;
  private collections: {
    requests?: Collection<ToolRequestRecord>;
    contacts?: Collection<ContactRecord>;
  } = {};

  constructor(uri: string) {
    this.uri = uri;
  }

  private async requests(): Promise<Collection<ToolRequestRecord>> {
    this.collections.requests ??= (await connect(this.uri)).collection<ToolRequestRecord>("tool_requests");
    return this.collections.requests;
  }

  private async contactsCollection(): Promise<Collection<ContactRecord>> {
    this.collections.contacts ??= (await connect(this.uri)).collection<ContactRecord>("contacts");
    return this.collections.contacts;
  }

  /**
   * Upsert on `id`, so a retried submission updates rather than duplicating.
   * The route generates the id, so the same retry is recognisable.
   */
  async saveToolRequest(record: ToolRequestRecord): Promise<void> {
    try {
      await (await this.requests()).updateOne(
        { id: record.id },
        { $set: { ...record } },
        { upsert: true },
      );
    } catch (error) {
      throw scrub(error);
    }
  }

  async listToolRequests(): Promise<ToolRequestRecord[]> {
    try {
      const docs = await (await this.requests())
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(500)
        .toArray();
      return docs.map(toToolRequest);
    } catch (error) {
      throw scrub(error);
    }
  }

  async updateToolRequestStatus(
    id: string,
    status: ToolRequestRecord["status"],
  ): Promise<ToolRequestRecord | null> {
    try {
      const updated = await (await this.requests()).findOneAndUpdate(
        { id },
        { $set: { status } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return updated ? toToolRequest(updated) : null;
    } catch (error) {
      throw scrub(error);
    }
  }

  async deleteToolRequest(id: string): Promise<boolean> {
    try {
      const result = await (await this.requests()).deleteOne({ id });
      return result.deletedCount > 0;
    } catch (error) {
      throw scrub(error);
    }
  }

  async saveContact(record: ContactRecord): Promise<void> {
    try {
      await (await this.contactsCollection()).insertOne({ ...record });
    } catch (error) {
      throw scrub(error);
    }
  }

  /** Used by /admin, so contacts are at least readable. */
  async listContacts(): Promise<ContactRecord[]> {
    try {
      const docs = await (await this.contactsCollection())
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(500)
        .toArray();
      return docs.map(toContact);
    } catch (error) {
      throw scrub(error);
    }
  }

  /** True when the cluster answers. Never throws, so a health check cannot 500. */
  async ping(): Promise<boolean> {
    try {
      await (await connect(this.uri)).command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }
}