import type { EventBrief, Permit, Vendor, Venue } from "./types";

/**
 * Rule-based permit checklist. A planning aid, not legal advice: agencies, fees and lead times are
 * typical estimates and must be verified with the issuing agency.
 */
type Juris = { fire: string; sound: string; parks: string; health: string; police: string };

const JURIS: Record<string, Juris> = {
  sf: {
    fire: "SF Fire Dept. — Bureau of Fire Prevention",
    sound: "SF Entertainment Commission",
    parks: "SF Recreation & Parks — Permits",
    health: "SF Dept. of Public Health — Environmental Health",
    police: "SFPD Special Events / Traffic Co.",
  },
  la: {
    fire: "LAFD Fire Prevention Bureau",
    sound: "LAPD Commission Investigation Div. (event/noise)",
    parks: "LA Recreation & Parks — Special Events",
    health: "LA County Environmental Health",
    police: "LAPD Special Events Permit Unit",
  },
  berkeley: {
    fire: "Berkeley Fire Dept. — Fire Prevention",
    sound: "City of Berkeley — Special Events",
    parks: "Berkeley Parks, Recreation & Waterfront",
    health: "City of Berkeley Environmental Health",
    police: "Berkeley PD / UCPD Special Events",
  },
  oakland: {
    fire: "Oakland Fire Dept. — Fire Prevention Bureau",
    sound: "City of Oakland Special Activity Permits",
    parks: "Oakland Parks, Recreation & Youth Development",
    health: "Alameda County Environmental Health",
    police: "OPD Special Events",
  },
};

function juris(brief: EventBrief, venue?: Venue): Juris {
  const where = `${brief.city} ${venue?.neighborhood ?? ""}`.toLowerCase();
  if (/berkeley/.test(where)) return JURIS.berkeley;
  if (/oakland/.test(where)) return JURIS.oakland;
  if (/san francisco|\bsf\b|bay area/.test(where)) return JURIS.sf;
  if (/los angeles|\bla\b|santa monica|westwood/.test(where)) return JURIS.la;
  const c = brief.city;
  return { fire: `${c} Fire Marshal`, sound: `${c} special events office`, parks: `${c} Parks Dept.`, health: `${c} county environmental health`, police: `${c} police special events` };
}

const addDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T00:00:00`);
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

export function permitChecklist(brief: EventBrief, venue: Venue | undefined, vendors: Vendor[]): Permit[] {
  const j = juris(brief, venue);
  const text = `${brief.prompt} ${brief.constraints.join(" ")} ${brief.vibe}`.toLowerCase();
  const name = venue?.name ?? "";
  const out: Omit<Permit, "deadline" | "atRisk">[] = [];
  const add = (p: Omit<Permit, "deadline" | "atRisk">) => out.push(p);

  if (brief.guests >= 50)
    add({ name: "Place of Assembly / temporary occupancy permit", agency: j.fire, why: `${brief.guests.toLocaleString()} people; fire marshal signs off on floor plan, exits and occupancy`, leadDays: 14, fee: brief.guests > 1000 ? 1500 : 450 });
  if (brief.eventType === "hackathon" && brief.durationHours > 12)
    add({ name: "Overnight occupancy / fire watch approval", agency: j.fire, why: `${brief.durationHours}h event with people on site overnight`, leadDays: 14, fee: 900 });
  if (/ceremony|concert|music|dj|party|stage|amplif|keynote/.test(text) || brief.guests > 500)
    add({ name: "Amplified sound / one-time event permit", agency: j.sound, why: "Amplified sound for ceremonies or performances", leadDays: 21, fee: 600 });
  if (/pier|ferry building|embarcadero/i.test(`${name} ${venue?.neighborhood ?? ""}`))
    add({ name: "Port of San Francisco special event permit", agency: "Port of San Francisco — Real Estate & Development", why: `${name} is on Port property`, leadDays: 30, fee: 1200 });
  if (venue && !venue.indoor && /park|lawn|green|beach/i.test(`${name} ${venue.style}`))
    add({ name: "Park special event permit", agency: j.parks, why: `${name} is public park space`, leadDays: 30, fee: 800 });
  if (venue && !venue.indoor)
    add({ name: "Temporary tent / canopy permit", agency: j.fire, why: "Tents over ~400 sq ft typically need a fire permit", leadDays: 10, fee: 350 });
  if (vendors.some((v) => /cater|food/i.test(v.category)))
    add({ name: "Temporary food facility permit (or caterer's health permit on file)", agency: j.health, why: "Food served on site to the public", leadDays: 14, fee: 300 });
  if (/alcohol|beer|wine|bar\b|cocktail/.test(text))
    add({ name: "ABC daily / one-day alcohol license", agency: "California Dept. of Alcoholic Beverage Control", why: "Alcohol served or sold", leadDays: 10, fee: 75 });
  if (/campus|uc berkeley|ucla|pauley|ackerman|mlk student union/i.test(`${name} ${venue?.neighborhood ?? ""}`))
    add({ name: "University event registration & security review", agency: "Campus event services + campus police", why: "Event on university property", leadDays: 21, fee: 0 });
  if (brief.guests >= 1000)
    add({ name: "Police / traffic & security plan review", agency: j.police, why: `${brief.guests.toLocaleString()} attendees arriving at once; crowd and traffic plan`, leadDays: 30, fee: 0 });
  if (brief.guests >= 100)
    add({ name: "Event liability insurance (COI naming venue & city)", agency: "Insurance broker", why: "Required by venues and permit offices; typically $1–2M general liability", leadDays: 7, fee: Math.max(300, Math.round(brief.guests * 0.75)) });

  const daysLeft = Math.ceil((new Date(`${brief.date}T00:00:00`).getTime() - Date.now()) / 86_400_000);
  return out.map((p) => ({ ...p, deadline: addDays(brief.date, -p.leadDays), atRisk: daysLeft < p.leadDays }));
}
