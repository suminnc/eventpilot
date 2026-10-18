import type { EventPlan } from "./types";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function planToMarkdown(p: EventPlan): string {
  const b = p.brief;
  const v = p.venues[p.selectedVenue];
  return [
    `# ${b.title}`,
    `${b.eventType} · ${b.date} ${b.startTime} · ${b.guests} guests · ${money(b.budget)} · ${b.city}`,
    "",
    p.summary,
    "",
    "## Venue",
    v ? `**${v.name}** (${v.neighborhood}) — ${v.why}` : "TBD",
    "",
    "## Run of show",
    ...p.schedule.map((s) => `- ${s.day && p.schedule.some((x) => (x.day ?? 1) > 1) ? `Day ${s.day} ` : ""}**${s.time}** ${s.title} (${s.durationMin}m) — ${s.detail}`),
    "",
    "## Budget",
    ...p.budget.map((l) => `- ${l.category}: ${money(l.amount)}${l.note ? ` — ${l.note}` : ""}`),
    "",
    "## Tasks",
    ...p.tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.title} — due ${t.due} (${t.owner})`),
    "",
    ...(p.permits?.length ? ["## Permits (estimates; verify with each agency)", ...p.permits.map((x) => `- ${x.name} (${x.agency}): file by ${x.deadline}, ~${x.leadDays}d lead, ${x.fee ? money(x.fee) : "no fee"}${x.atRisk ? " **EXPEDITE**" : ""}`), ""] : []),
    "## Risks",
    ...p.risks.map((r) => `- [${r.level}] ${r.issue} → ${r.mitigation}`),
    "",
    "## Invite",
    `**${p.invite.subject}**`,
    "",
    p.invite.body,
  ].join("\n");
}

const icsDate = (date: string, time: string) => `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;

export function planToICS(p: EventPlan): string {
  const b = p.brief;
  const v = p.venues[p.selectedVenue];
  const start = new Date(`${b.date}T${b.startTime}`);
  const end = new Date(start.getTime() + b.durationHours * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const endStr = `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`;
  const esc = (s: string) => s.replace(/[,;\\]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const events = [
    ["main", icsDate(b.date, b.startTime), endStr, b.title, p.summary],
    ...p.tasks.map((t) => [t.id, t.due.replace(/-/g, ""), "", `[Prep] ${t.title}`, `Owner: ${t.owner}`]),
  ];
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EventPilot//LA Hacks 2026//EN",
    ...events.flatMap(([id, s, e, title, desc]) => [
      "BEGIN:VEVENT",
      `UID:${p.id}-${id}@eventpilot`,
      s.includes("T") ? `DTSTART:${s}` : `DTSTART;VALUE=DATE:${s}`,
      ...(e ? [`DTEND:${e}`] : []),
      `SUMMARY:${esc(title)}`,
      `DESCRIPTION:${esc(desc)}`,
      ...(v && id === "main" ? [`LOCATION:${esc(`${v.name}, ${v.neighborhood}`)}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}
