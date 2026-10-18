import type { Photon } from "@photon-ai/api";

/**
 * Server-only Photon 2.0 bridge (https://photon.codes/docs/beta). Texts one configured organizer and reads their replies.
 * Shared iMessage lines can't start a conversation, so the organizer texts the agent once; we reply in that space.
 */

type Who = { id: string; kind: string; handle: string };
type Msg = { id: string; status: string; createdAt: string; sentBy?: Who; receivedBy?: Who; space?: { id: string; kind: string }; content?: { type: string; format?: string; text?: string } };
export type Inbound = { id: string; text: string; ts: number };

export function photonConfig() {
  const { PHOTON_API_KEY: key, PHOTON_PROJECT_ID: project, PHOTON_AGENT_HANDLE: agent, PHOTON_ORGANIZER: organizer } = process.env;
  const platform = process.env.PHOTON_PLATFORM || "imessage";
  return key && project && agent && organizer ? { key, project, agent, organizer, platform } : null;
}

// Shared across Next.js bundles (instrumentation + route handlers) in the same process.
const g = globalThis as unknown as { __photonClient?: Photon; __photonLink?: { spaceId: string; senderId: string } | null };
export const isLinked = () => !!g.__photonLink;

const norm = (h: string) => h.toLowerCase().replace(/[\s().-]/g, "");

function fromOrganizer(m: Msg, c: NonNullable<ReturnType<typeof photonConfig>>) {
  return (
    m.status === "received" &&
    m.sentBy?.kind === "human" &&
    norm(m.sentBy.handle) === norm(c.organizer) &&
    m.receivedBy?.kind === "agent" &&
    norm(m.receivedBy.handle) === norm(c.agent) &&
    !!m.space &&
    (c.platform !== "imessage" || m.space.kind === "direct")
  );
}

async function received(since: Date, order: "asc" | "desc", maxPages: number) {
  const c = photonConfig()!;
  g.__photonClient ??= new (await import("@photon-ai/api")).Photon({ headers: { Authorization: `Bearer ${c.key}` } });
  const client = g.__photonClient;
  const out: Msg[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await client.projects.listMessages({
      path: { id: c.project },
      query: { createdSince: since.toISOString(), direction: "received", order, pageSize: 100, platform: c.platform, ...(pageToken ? { pageToken } : {}) },
    });
    for (const raw of page.items) {
      const m = raw as unknown as Msg;
      if (!fromOrganizer(m, c)) continue;
      out.push(m);
      g.__photonLink = { spaceId: m.space!.id, senderId: m.receivedBy!.id };
      if (order === "desc") return out;
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export async function organizerReplies(since: Date): Promise<Inbound[]> {
  const msgs = await received(since, "asc", 5);
  return msgs.flatMap((m) => (m.content?.type === "text" && m.content.text ? [{ id: m.id, text: m.content.text, ts: Date.parse(m.createdAt) }] : []));
}

export async function textOrganizer(text: string, idempotencyKey: string): Promise<"sent" | "not_linked"> {
  const c = photonConfig()!;
  if (!g.__photonLink) await received(new Date(Date.now() - 30 * 86_400_000), "desc", 5);
  const link = g.__photonLink;
  if (!link) return "not_linked";
  await g.__photonClient!.projects.sendMessage({
    path: { id: c.project },
    headers: { "idempotency-key": idempotencyKey },
    body: { spaceId: link.spaceId, senderId: link.senderId, content: { type: "text", format: "plain", text } },
  });
  return "sent";
}

/** Finds the existing organizer conversation (if any) so replies and decision texts can go out right away. */
export async function discoverLink(): Promise<boolean> {
  if (!g.__photonLink && photonConfig()) await received(new Date(Date.now() - 30 * 86_400_000), "desc", 5);
  return !!g.__photonLink;
}
