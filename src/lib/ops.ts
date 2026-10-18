import type { EventBrief, OpsPlan, ScheduleItem, Task, Venue } from "./types";

/** Deterministic ops sizing from headcount, duration and schedule. Ratios are industry rules of thumb, not requirements. */
const ceil = Math.ceil;
const hhmm = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function opsPlan(brief: EventBrief, schedule: ScheduleItem[], venue: Venue | undefined): OpsPlan {
  const g = brief.guests;
  const hack = brief.eventType === "hackathon";
  const small = g < 50;
  const overnight = brief.durationHours > 12;
  const text = `${brief.prompt} ${brief.constraints.join(" ")}`.toLowerCase();

  const [sh, sm] = brief.startTime.split(":").map(Number);
  const start = sh * 60 + sm;
  const shiftLen = brief.durationHours > 8 ? 360 : brief.durationHours * 60;
  const shifts: OpsPlan["shifts"] = [];
  for (let t = 0; !small && t < brief.durationHours * 60; t += shiftLen) {
    const abs = start + t;
    const clock = (abs % 1440) / 60;
    const night = clock >= 22 || clock < 6;
    shifts.push({ label: `Day ${Math.floor(abs / 1440) + 1}`, start: hhmm(abs), end: hhmm(abs + shiftLen), volunteers: Math.max(2, ceil((g / (hack ? 25 : 30)) * (night ? 0.5 : 1))) });
  }
  const volunteerSlots = shifts.reduce((s, x) => s + x.volunteers, 0);
  const volunteers = shifts.length > 1 ? ceil(volunteerSlots / 2) : volunteerSlots;

  const checkWindow = g > 500 ? 60 : 30;
  const lanes = small ? 0 : Math.max(1, ceil(g / (2 * checkWindow)));
  const checkin = small
    ? { lanes: 0, minutes: 0, note: "No check-in desk needed; the host greets guests." }
    : { lanes, minutes: ceil(g / (2 * lanes)), note: `QR scan + badge at ~2 guests/min per lane; ${lanes} lane${lanes > 1 ? "s" : ""} clears ${g.toLocaleString()} in ~${ceil(g / (2 * lanes))} min.` };

  const staffing: OpsPlan["staffing"] = small
    ? [{ role: "Host", count: 1, note: "Greets guests, owns the reservation and the bill" }]
    : [{ role: "Volunteers", count: volunteers, note: shifts.length > 1 ? `${shifts.length} shifts, 2 shifts each; half staffing overnight` : "Covers check-in, food, wayfinding" }];
  if (g >= 100) staffing.push({ role: "Licensed security", count: Math.max(2, ceil(g / 100)), note: overnight ? "24h coverage incl. overnight rounds; bag check at entry" : "Entry + floor" });
  if (!small) staffing.push(g >= 1000 ? { role: "EMTs + first-aid station", count: 2 * ceil(g / 2500), note: "On site the whole event; ambulance access route marked" } : g >= 250 ? { role: "EMT", count: 1, note: "First-aid station near check-in" } : { role: "First-aid certified lead", count: 1, note: "Kit + AED location known" });
  if (lanes) staffing.push({ role: "Check-in staff", count: lanes, note: "One per lane at peak, then join floor team" });
  if (hack) {
    staffing.push({ role: "Mentors", count: ceil(g / 20), note: "Staggered; at least 1 on call overnight" });
    staffing.push({ role: "Judges", count: ceil(g / 4 / 8), note: `~${ceil(g / 4)} teams, ~8 teams per judge per round` });
  }
  if (g >= 300) staffing.push({ role: "Leads (ops, food, sponsors, comms, safety)", count: 5, note: "Each owns one channel on the run sheet" });
  if (!small) staffing.push({ role: "AV / stage tech", count: g >= 500 ? 2 : 1, note: "Ceremonies, livestream, mics" });

  const policies: OpsPlan["policies"] = [];
  if (g >= 50) policies.push({ name: "Code of conduct + reporting channel", why: "Published at registration, two named responders on site" });
  if (g >= 100) policies.push({ name: "Emergency action plan & evacuation map", why: "Required by most venues and fire marshals; brief all staff" });
  if (/ada|accessib|wheelchair/.test(text) || g >= 100) policies.push({ name: "Accessibility plan", why: "Step-free routes, quiet room, captioned ceremonies, accessible restrooms" });
  if (hack || /student|kid|minor|teen|family/.test(text)) policies.push({ name: "Minors policy & guardian waiver", why: "Under-18 attendees need guardian consent and chaperone rules" });
  if (!small) policies.push({ name: "Photo/media consent", why: "Opt-out lanyards or stickers for attendees who don't want photos" });
  if (hack || (venue && !venue.indoor)) policies.push({ name: "Liability waiver", why: "Collected at registration" });
  policies.push({ name: "Allergen labeling", why: "Every food station labeled; separate prep for halal / gluten-free" });
  if (overnight) policies.push({ name: "Overnight safety plan", why: "Sleeping area, no-alcohol rule, security rounds, sign-out after midnight" });

  const staff = staffing.reduce((s, x) => s + x.count, 0);
  const rates: [string, RegExp, number, number][] = [
    ["vegetarian", /vegetarian/, 0.18, 0.12],
    ["vegan", /vegan/, 0.08, 0.04],
    ["halal", /halal/, 0.12, 0.05],
    ["gluten-free", /gluten/, 0.06, 0.03],
  ];
  const meals = schedule
    .filter((s) => /breakfast|lunch|dinner|snack|food service/i.test(s.title))
    .map((s) => {
      const servings = ceil((g + staff) * 1.05);
      const split: Record<string, number> = {};
      let special = 0;
      for (const [k, re, hi, lo] of rates) {
        const n = Math.round(servings * (re.test(text) ? hi : lo));
        split[k] = n;
        special += n;
      }
      split.standard = Math.max(0, servings - special);
      return { slot: s.title, day: s.day ?? 1, time: s.time, servings, split };
    });

  const devices = ceil(g * (hack ? 2.5 : 1.2));
  const mbps = ceil(g * (hack ? 2 : 0.5));
  const infra: OpsPlan["infra"] = small ? [{ item: "Tables", qty: `${ceil(g / 8)}`, note: "Confirm seating with the venue" }] : [
    { item: "Wi-Fi access points", qty: `${ceil(devices / 60)}`, note: `${devices.toLocaleString()} concurrent devices at ~60 per AP` },
    { item: "Uplink bandwidth", qty: mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`, note: hack ? "~2 Mbps per hacker; ask the venue for a dedicated circuit" : "~0.5 Mbps per guest" },
    { item: "Power circuits (20A)", qty: `${ceil((g * (hack ? 120 : 10)) / 1920) + 2}`, note: hack ? "~120 W per hacker; power strips at every table" : "AV, catering and charging" },
    { item: hack ? "6-ft tables" : "Tables", qty: `${ceil(g / (hack ? 6 : 8))}`, note: hack ? "6 hackers per table" : "8 guests per table" },
    { item: "Chairs", qty: `${g.toLocaleString()}`, note: "Plus 5% spare" },
    venue && !venue.indoor
      ? { item: "Portable restrooms", qty: `${ceil((g / 50) * Math.max(1, brief.durationHours / 8))}`, note: "1 per 50 guests per 8h, at least 5% ADA units" }
      : { item: "Restroom fixtures (venue)", qty: `${ceil(g / 75)}`, note: "Confirm the venue has ~1 fixture per 75 guests" },
    { item: "Trash / recycling / compost stations", qty: `${ceil(g / 100)}`, note: "Pair with every food station" },
  ];
  if (overnight && !small) infra.push({ item: "Quiet/sleep room capacity", qty: `${ceil(g * 0.3)}`, note: "~30% of attendees rest at once overnight" });

  const sponsorEvent = hack || brief.eventType === "conference";
  const r = (n: number) => Math.max(1000, Math.round(n / 1000) * 1000);
  const sponsors: OpsPlan["sponsors"] = sponsorEvent
    ? [
        { tier: "Title", price: r(brief.budget * 0.15), count: 1, perks: "Naming, keynote, prize track, booth, recruiting access" },
        { tier: "Platinum", price: r(brief.budget * 0.08), count: 3, perks: "Workshop, prize track, large booth" },
        { tier: "Gold", price: r(brief.budget * 0.04), count: 5, perks: "Prize track, booth, resume book" },
        { tier: "Silver", price: r(brief.budget * 0.02), count: 6, perks: "Booth, logo on site" },
        { tier: "Bronze", price: r(brief.budget * 0.01), count: 6, perks: "Logo, swag table" },
      ]
    : [];
  const sponsorTarget = sponsors.reduce((s, t) => s + t.price * t.count, 0);

  const contacts: OpsPlan["contacts"] = small
    ? [
        { role: "Medical emergency", owner: "Call 911; host knows the address", when: "Immediately" },
        { role: "Venue or reservation issue", owner: "Host, then venue manager", when: "As it happens" },
      ]
    : [
    { role: "Medical or fire emergency", owner: "Call 911, then the EMT / safety lead", when: "Immediately" },
    { role: "Harassment or CoC report", owner: "Two named CoC responders", when: "Within 15 min" },
    { role: "Venue issue (doors, HVAC, damage)", owner: "Venue manager on site", when: "As it happens" },
    { role: "Wi-Fi or power down", owner: "AV / network lead", when: "Within 5 min" },
    { role: "Food late or short", owner: "Food lead, then caterer", when: "30 min before each meal" },
    { role: "Sponsor or press request", owner: "Sponsor lead", when: "Same day" },
    { role: "Lost & found, badge reprint", owner: "Check-in desk", when: "Ongoing" },
  ];

  return { staffing, shifts, policies, meals, infra, checkin, sponsors, sponsorTarget, contacts };
}

export function opsTasks(ops: OpsPlan, brief: EventBrief): Task[] {
  const days = Math.max(0, Math.round((new Date(brief.date).getTime() - Date.now()) / 86_400_000));
  const due = (before: number) => {
    const d = new Date(brief.date);
    d.setDate(d.getDate() - Math.min(before, days));
    return d.toISOString().slice(0, 10);
  };
  const n = (role: RegExp) => ops.staffing.find((s) => role.test(s.role))?.count ?? 0;
  const inf = (item: RegExp) => ops.infra.find((i) => item.test(i.item))?.qty ?? "";
  const list: [string, number, Task["priority"], string][] = [];
  if (n(/volunteer/i)) list.push([`Recruit ${n(/volunteer/i)} volunteers & publish shift schedule`, 14, "high", "Volunteer lead"]);
  if (n(/security/i)) list.push([`Book ${n(/security/i)} licensed security guards`, 14, "high", "Safety lead"]);
  const medic = ops.staffing.find((s) => /emt|first-aid/i.test(s.role));
  if (medic) list.push([/^first-aid/i.test(medic.role) ? "Assign a first-aid certified lead & stock the kit" : `Book ${medic.role} coverage`, 14, "high", "Safety lead"]);
  if (ops.policies.some((p) => /code of conduct/i.test(p.name))) list.push(["Publish code of conduct & safety policies", 10, "high", "Organizer"]);
  if (!inf(/power/i)) return finish(list);
  list.push([`Order ${inf(/tables/i)} tables, chairs & ${inf(/power/i)} power circuits`, 10, "medium", "Ops lead"]);
  list.push([`Confirm Wi-Fi: ${inf(/access points/i)} APs, ${inf(/bandwidth/i)} uplink`, 10, "high", "AV lead"]);
  if (ops.sponsors.length) list.push([`Close sponsors: $${ops.sponsorTarget.toLocaleString()} target`, 30, "high", "Sponsor lead"]);
  list.push([`Set up ${ops.checkin.lanes} check-in lanes & badge printing`, 3, "medium", "Check-in lead"]);
  list.push(["Brief all staff on run sheet & emergency plan", 1, "high", "Organizer"]);
  return finish(list);

  function finish(list: [string, number, Task["priority"], string][]): Task[] {
    return list.map(([title, before, priority, owner], i) => ({ id: `op${i}`, title, due: due(before), owner, priority, done: false, agent: "logistics" }));
  }
}
