import type { OutboxMessage } from "./types";

/**
 * Real email for vendor/permit drafts. Live only when SMTP_USER + SMTP_PASS are set.
 * EMAIL_REDIRECT_TO (required for live mode) sends every message to one test inbox instead of the vendor.
 */
export function mailConfig() {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS, redirect = process.env.EMAIL_REDIRECT_TO;
  if (!user || !pass || !redirect) return null;
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass: pass.replace(/\s+/g, ""),
    from: process.env.EMAIL_FROM || user,
    redirect,
  };
}

export type MailResult = { ok: true; to: string; messageId: string } | { ok: false; error: string };

type Transport = { sendMail: (o: Record<string, unknown>) => Promise<{ messageId: string }> };
const g = globalThis as unknown as { __mailer?: { key: string; t: Transport } };

/** One pooled SMTP connection set, reused across sends (a new TLS login per email is what made batches slow). */
async function transport(c: NonNullable<ReturnType<typeof mailConfig>>): Promise<Transport> {
  const key = `${c.host}:${c.port}:${c.user}:${c.pass.length}`;
  if (g.__mailer?.key === key) return g.__mailer.t;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport({ pool: true, maxConnections: 3, maxMessages: 100, host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } }) as unknown as Transport;
  g.__mailer = { key, t };
  return t;
}

export type ReplyOpts = { reply?: boolean; inReplyTo?: string; references?: string[] };

export async function sendEmail(m: Pick<OutboxMessage, "to" | "subject" | "body">, eventTitle: string, opts: ReplyOpts = {}): Promise<MailResult> {
  const c = mailConfig();
  if (!c) return { ok: false, error: "email not configured" };
  const t = await transport(c);
  for (let attempt = 0; ; attempt++) {
    try {
      return await deliver(t, c, m, eventTitle, opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "send failed";
      if (attempt < 2 && /\b4\d\d\b|ETIMEDOUT|ECONNRESET/.test(msg)) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      return { ok: false, error: msg.slice(0, 160) };
    }
  }
}

async function deliver(t: Transport, c: NonNullable<ReturnType<typeof mailConfig>>, m: Pick<OutboxMessage, "to" | "subject" | "body">, eventTitle: string, opts: ReplyOpts): Promise<MailResult> {
  {
    const info = await t.sendMail({
      from: c.from,
      to: c.redirect,
      subject: `${opts.reply ? "Re: " : ""}[EventPilot demo → ${m.to}] ${m.subject}`,
      text: opts.reply ? `(EventPilot test inbox · written for ${m.to})\n\n${m.body}` : `EventPilot demo: this message was written for ${m.to} (${eventTitle}) and redirected to this test inbox. No vendor received it.\n\n----\n\n${m.body}`,
      inReplyTo: opts.inReplyTo,
      references: opts.references,
      headers: { "X-EventPilot-Intended-To": m.to },
    });
    return { ok: true, to: c.redirect, messageId: info.messageId };
  }
}
