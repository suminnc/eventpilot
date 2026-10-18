import type { EventBrief } from "./types";

const TYPES: [RegExp, string][] = [
  [/hackathon|hacks\b|cal ?hacks|treehacks|hackmit/i, "hackathon"],
  [/wedding/i, "wedding"],
  [/picnic|bbq|barbecue/i, "picnic"],
  [/birthday|bday/i, "birthday party"],
  [/conference|summit|symposium/i, "conference"],
  [/gala|fundrais/i, "gala"],
  [/launch/i, "product launch"],
  [/meetup|networking|mixer/i, "networking meetup"],
  [/workshop|bootcamp/i, "workshop"],
  [/offsite|retreat|team/i, "team offsite"],
  [/dinner/i, "dinner"],
  [/concert|festival/i, "festival"],
  [/reunion/i, "reunion"],
  [/shower/i, "shower"],
  [/party/i, "party"],
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY = /\b(next|this|on)?\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*day\b/;

export function defaultDate(daysOut = 30) {
  const d = new Date(Date.now() + daysOut * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Heuristic intent parser used when no LLM key is configured, and to pre-fill the LLM. */
export function parseBriefOffline(prompt: string, base: Partial<EventBrief> = {}): EventBrief {
  const raw = prompt;
  const p = prompt.toLowerCase();
  const eventType = base.eventType || TYPES.find(([re]) => re.test(p))?.[1] || "social event";

  const pn = p.replace(/(\d),(\d{3})/g, "$1$2");
  const guestsM =
    pn.match(/(\d{1,5})\s*(?:\+\s*)?(?:people|guests|attendees|hackers|folks|ppl|friends|students|pax|kids|adults|of us)/) ||
    pn.match(/\b(?:for|party of|table for)\s+(\d{1,5})\b(?!\s*(?:h\b|hours?|hrs?|days?|min|%|am|pm|k\b|:\d))/);
  const budgetM = p.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/) || p.match(/(\d[\d,]*)\s*(k\b)?\s*(?:dollars|usd|budget)/);
  let budget = base.budget || 0;
  if (!budget && budgetM) budget = parseFloat(budgetM[1].replace(/,/g, "")) * (budgetM[2] ? 1000 : 1);

  const cityM = prompt.match(/\bin\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*(?:,\s?[A-Z]{2})?)/) || prompt.match(/\b(?:at|near)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*(?:,\s?[A-Z]{2})?)/);
  const city =
    base.city ||
    (cityM && !/^(the|a)$/i.test(cityM[1]) ? cityM[1] : /cal ?hacks|berkeley/i.test(prompt) ? "San Francisco" : /\bsf\b/i.test(prompt) ? "San Francisco" : "Los Angeles");

  let date = base.date || "";
  const iso = p.match(/(20\d{2})-(\d{2})-(\d{2})/);
  const md = p.match(new RegExp(`(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?`));
  if (!date && iso) date = iso[0];
  else if (!date && md) {
    const now = new Date();
    const m = MONTHS.indexOf(md[1]);
    let y = md[3] ? +md[3] : now.getFullYear();
    if (!md[3] && new Date(y, m, +md[2]) < now) y += 1;
    date = `${y}-${String(m + 1).padStart(2, "0")}-${String(+md[2]).padStart(2, "0")}`;
  } else if (!date && /\btomorrow\b/.test(p)) date = defaultDate(1);
  else if (!date && /\btoday\b|\btonight\b/.test(p)) date = defaultDate(0);
  else if (!date && WEEKDAY.test(p)) {
    const w = p.match(WEEKDAY)!;
    const target = DAYS.indexOf(w[2].slice(0, 3));
    let ahead = (target - new Date().getDay() + 7) % 7 || 7;
    if (w[1] === "next" && ahead < 3) ahead += 7;
    date = defaultDate(ahead);
  } else if (!date && /this weekend/.test(p)) date = defaultDate((6 - new Date().getDay() + 7) % 7 || 7);
  else if (!date && /next week/.test(p)) date = defaultDate(7);
  else if (!date && /next month/.test(p)) date = defaultDate(30);
  const assumed: string[] = [];
  if (!date) assumed.push("the date");
  if (!date) date = defaultDate(eventType === "wedding" ? 180 : eventType === "hackathon" || eventType === "conference" ? 60 : 30);

  const timeM = p.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  let startTime = base.startTime || "";
  if (!startTime && timeM) {
    let h = +timeM[1] % 12;
    if (timeM[3] === "pm") h += 12;
    startTime = `${String(h).padStart(2, "0")}:${timeM[2] || "00"}`;
  }
  const defaults: Record<string, [string, number, number, number]> = {
    hackathon: ["09:00", 24, 300, 25000],
    wedding: ["16:00", 6, 120, 30000],
    conference: ["09:00", 8, 250, 20000],
    gala: ["18:30", 4, 200, 25000],
    "product launch": ["18:00", 3, 120, 10000],
    "networking meetup": ["18:00", 3, 60, 2500],
    workshop: ["10:00", 4, 40, 1500],
    picnic: ["12:00", 4, 30, 600],
    "birthday party": ["19:00", 4, 30, 1500],
    "team offsite": ["09:30", 7, 25, 6000],
    dinner: ["19:00", 3, 12, 900],
  };
  const [dt, dh, dg, db] = defaults[eventType] || ["18:00", 4, 50, 3000];
  const hoursM = p.match(/(\d{1,2})\s*(?:-|\s)?(?:hour|hr|h\b)/);
  const guests = base.guests || (guestsM ? +guestsM[1] : dg);

  const vibeWords = ["casual", "formal", "cozy", "chill", "elegant", "rooftop", "outdoor", "indoor", "techy", "fun", "intimate", "upscale", "sustainable", "beach", "retro", "minimal"];
  const vibe = base.vibe || vibeWords.filter((w) => p.includes(w)).join(", ") || "welcoming, well-run";

  const constraints: string[] = [...(base.constraints || [])];
  if (/vegan|vegetarian/.test(p)) constraints.push("vegetarian/vegan food options");
  if (/halal|kosher/.test(p)) constraints.push("halal/kosher catering");
  if (/gluten/.test(p)) constraints.push("gluten-free options");
  if (/accessib|wheelchair|ada/.test(p)) constraints.push("ADA accessible");
  if (/no alcohol|alcohol-free|dry/.test(p)) constraints.push("alcohol-free");
  if (/parking/.test(p)) constraints.push("parking required");
  if (/transit|metro/.test(p)) constraints.push("near public transit");
  if (/kid|family|children/.test(p)) constraints.push("kid-friendly");

  if (!base.city && !cityM && !/cal ?hacks|berkeley|\bsf\b/i.test(prompt)) assumed.push(`${city} as the city`);
  if (!base.guests && !guestsM) assumed.push(`${guests} guests`);
  if (!base.budget && !budgetM) assumed.push("the budget");
  return {
    assumptions: assumed,
    prompt,
    eventType,
    title: base.title || titleFor(eventType, city, raw),
    city,
    date,
    startTime: startTime || dt,
    durationHours: base.durationHours || (hoursM ? +hoursM[1] : dh),
    guests,
    budget: budget || Math.round((db * guests) / dg / 100) * 100 || db,
    vibe,
    constraints,
  };
}

function titleFor(type: string, city: string, prompt: string) {
  const c = city.split(",")[0];
  const named = prompt.match(/\b([A-Z][a-zA-Z]*\s?Hacks(?:\s\d+(?:\.\d)?)?)/);
  if (named) return named[1];
  return `${c} ${type.replace(/\b\w/g, (m) => m.toUpperCase())}`;
}

/** Applies natural-language feedback (e.g. "make it cheaper", "move indoors") in offline mode. */
export function applyFeedbackOffline(brief: EventBrief, feedback: string): EventBrief {
  const f = feedback.toLowerCase();
  const b: EventBrief = { ...brief, constraints: [...brief.constraints] };
  const pct = f.match(/(\d{1,2})\s*%/);
  if (/cheaper|cut|lower|less expensive|reduce/.test(f)) b.budget = Math.round(b.budget * (1 - (pct ? +pct[1] / 100 : 0.25)));
  if (/more budget|splurge|fancier|upscale|bigger budget/.test(f)) b.budget = Math.round(b.budget * 1.3);
  const g = f.replace(/(\d),(\d{3})/g, "$1$2").match(/(\d{1,5})\s*(more\s+)?(?:people|guests|attendees|hackers)/);
  if (g) b.guests = g[2] ? b.guests + +g[1] : +g[1];
  const $ = f.match(/\$\s?(\d[\d,]*)\s*(k\b)?/);
  if ($) b.budget = parseFloat($[1].replace(/,/g, "")) * ($[2] ? 1000 : 1);
  if (/indoor/.test(f)) b.vibe = b.vibe.replace(/outdoor|rooftop/g, "").trim() + ", indoor";
  if (/outdoor|rooftop/.test(f)) b.vibe += ", outdoor";
  const re = parseBriefOffline(feedback, {});
  if (/\d{4}-\d{2}-\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.test(f)) b.date = re.date;
  if (/\d\s*(am|pm)/.test(f)) b.startTime = re.startTime;
  b.constraints = Array.from(new Set([...b.constraints, ...re.constraints]));
  b.prompt = `${brief.prompt}\nRefinement: ${feedback}`;
  return b;
}
