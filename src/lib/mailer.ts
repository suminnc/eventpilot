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
    pass,
    from: process.env.EMAIL_FROM || user,
    redirect,
  };
}

export type MailResult = { ok: true; to: string; messageId: string } | { ok: false; error: string };

export async function sendEmail(m: Pick<OutboxMessage, "to" | "subject" | "body">, eventTitle: string): Promise<MailResult> {
  const c = mailConfig();
  if (!c) return { ok: false, error: "email not configured" };
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
  try {
    const info = await t.sendMail({
      from: c.from,
      to: c.redirect,
      subject: `[EventPilot demo → ${m.to}] ${m.subject}`,
      text: `EventPilot demo: this message was written for ${m.to} (${eventTitle}) and redirected to this test inbox. No vendor received it.\n\n----\n\n${m.body}`,
      headers: { "X-EventPilot-Intended-To": m.to },
    });
    return { ok: true, to: c.redirect, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "send failed" };
  }
}
