import { mailConfig } from "./mailer";

export type Inbound = { messageId: string; inReplyTo?: string; references: string[]; subject: string; text: string; date: number };

/** Drops the quoted history Gmail/Outlook append under a reply. */
export function stripQuoted(t: string): string {
  const cut = t.search(/\n[^\n]*\bOn [^\n]{0,200}(\n[^\n]{0,200})?wrote:\s*\n|\n-{2,}\s*Original Message|\nFrom: [^\n]+\nSent: /i);
  const body = cut >= 0 ? t.slice(0, cut) : t;
  return body.split("\n").filter((l) => !l.startsWith(">")).join("\n").trim();
}

/** Replies from the vendor inbox (EMAIL_REDIRECT_TO) in the last 2 days that we haven't processed. Read-only IMAP. */
export async function fetchReplies(seen: Set<string>): Promise<Inbound[]> {
  const c = mailConfig();
  if (!c) return [];
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({ host: process.env.IMAP_HOST || "imap.gmail.com", port: 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false });
  await client.connect();
  const out: Inbound[] = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ from: c.redirect, since: new Date(Date.now() - 2 * 86_400_000) }, { uid: true })) || [];
      if (uids.length) {
        for await (const m of client.fetch(uids.slice(-40), { envelope: true, source: true }, { uid: true })) {
          const id = m.envelope?.messageId;
          if (!id || seen.has(id) || !m.source) continue;
          const p = await simpleParser(m.source);
          const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : [];
          out.push({ messageId: id, inReplyTo: p.inReplyTo, references: refs, subject: p.subject ?? "", text: stripQuoted(p.text ?? ""), date: p.date?.getTime() ?? Date.now() });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out.sort((a, b) => a.date - b.date);
}
