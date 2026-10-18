import { Photon } from "@photon-ai/api";

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

let client: Photon | undefined;
let link: { spaceId: string; senderId: string } | null = null;
export const isLinked = () => !!link;

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
  client ??= new Photon({ headers: { Authorization: `Bearer ${c.key}` } });
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
      link = { spaceId: m.space!.id, senderId: m.receivedBy!.id };
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
  if (!link) await received(new Date(Date.now() - 30 * 86_400_000), "desc", 5);
  if (!link) return "not_linked";
  await client!.projects.sendMessage({
    path: { id: c.project },
    headers: { "idempotency-key": idempotencyKey },
    body: { spaceId: link.spaceId, senderId: link.senderId, content: { type: "text", format: "plain", text } },
  });
  return "sent";
}
