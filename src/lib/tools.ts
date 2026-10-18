import type { Venue, Weather } from "./types";

/** Real tool: Open-Meteo geocoding + forecast (free, no key). Falls back to climate normals. */
export async function weatherTool(city: string, date: string): Promise<Weather> {
  try {
    const geo = await fetchJSON<{ results?: { latitude: number; longitude: number; name: string }[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
    );
    const loc = geo.results?.[0];
    if (!loc) throw new Error("city not found");
    const daysOut = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
    if (daysOut >= 0 && daysOut <= 15) {
      const f = await fetchJSON<{
        daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
      }>(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${date}&end_date=${date}`,
      );
      const hi = f.daily.temperature_2m_max[0];
      const lo = f.daily.temperature_2m_min[0];
      const p = f.daily.precipitation_probability_max[0];
      return {
        summary: describe(hi, p),
        highC: hi,
        lowC: lo,
        precipChance: p,
        source: `Open-Meteo forecast for ${loc.name}`,
      };
    }
    // Outside forecast window: use last year's same day as a climate proxy.
    const d = new Date(date);
    d.setFullYear(d.getFullYear() - 1);
    const past = d.toISOString().slice(0, 10);
    const h = await fetchJSON<{ daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[] } }>(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&start_date=${past}&end_date=${past}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`,
    );
    const hi = h.daily.temperature_2m_max[0];
    const rain = h.daily.precipitation_sum[0];
    const p = rain > 1 ? 60 : rain > 0 ? 25 : 5;
    return {
      summary: describe(hi, p) + " (based on last year's conditions)",
      highC: hi,
      lowC: h.daily.temperature_2m_min[0],
      precipChance: p,
      source: `Open-Meteo historical for ${loc.name}`,
    };
  } catch {
    return { summary: "Weather unavailable — plan an indoor backup", highC: null, lowC: null, precipChance: null, source: "n/a" };
  }
}

function describe(hi: number, p: number) {
  const temp = hi >= 30 ? "Hot" : hi >= 22 ? "Warm" : hi >= 15 ? "Mild" : "Cool";
  const sky = p >= 50 ? "rain likely" : p >= 20 ? "chance of showers" : "mostly dry";
  return `${temp}, ${sky}`;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Curated venue catalog used as the Scout's search tool (LA-focused, with generic fallbacks). */
const CATALOG: (Omit<Venue, "why"> & { tags: string[]; city: string })[] = [
  { name: "Pauley Pavilion Club Level", neighborhood: "Westwood", capacity: 400, pricePerHour: 900, style: "Campus arena lounge", indoor: true, tags: ["hackathon", "conference", "corporate", "student"], city: "los angeles" },
  { name: "Ackerman Grand Ballroom", neighborhood: "UCLA", capacity: 800, pricePerHour: 650, style: "Ballroom", indoor: true, tags: ["hackathon", "gala", "conference", "student", "formal"], city: "los angeles" },
  { name: "The Line Hotel Rooftop", neighborhood: "Koreatown", capacity: 150, pricePerHour: 700, style: "Rooftop terrace", indoor: false, tags: ["party", "birthday", "networking", "launch", "social"], city: "los angeles" },
  { name: "ROW DTLA Event Loft", neighborhood: "Arts District", capacity: 300, pricePerHour: 550, style: "Industrial loft", indoor: true, tags: ["launch", "meetup", "hackathon", "networking", "corporate", "party"], city: "los angeles" },
  { name: "Griffith Park Old Zoo Picnic Area", neighborhood: "Los Feliz", capacity: 200, pricePerHour: 60, style: "Outdoor park", indoor: false, tags: ["picnic", "birthday", "family", "casual", "social", "reunion"], city: "los angeles" },
  { name: "Santa Monica Pier Pacific Room", neighborhood: "Santa Monica", capacity: 180, pricePerHour: 480, style: "Oceanfront hall", indoor: true, tags: ["wedding", "gala", "party", "networking", "formal"], city: "los angeles" },
  { name: "WeWork Playa Vista Commons", neighborhood: "Playa Vista", capacity: 120, pricePerHour: 250, style: "Coworking event space", indoor: true, tags: ["meetup", "workshop", "hackathon", "corporate", "networking"], city: "los angeles" },
  { name: "Grand Park Event Lawn", neighborhood: "Downtown", capacity: 1500, pricePerHour: 300, style: "Civic lawn", indoor: false, tags: ["festival", "concert", "community", "family", "casual"], city: "los angeles" },
  { name: "Petersen Automotive Museum Penthouse", neighborhood: "Miracle Mile", capacity: 350, pricePerHour: 1200, style: "Museum penthouse", indoor: true, tags: ["gala", "wedding", "corporate", "formal", "launch"], city: "los angeles" },
  { name: "Highland Park Bowl Private Room", neighborhood: "Highland Park", capacity: 60, pricePerHour: 350, style: "Retro bowling lounge", indoor: true, tags: ["birthday", "party", "team", "casual", "social"], city: "los angeles" },
  { name: "Cafe Gratitude Private Garden", neighborhood: "Venice", capacity: 40, pricePerHour: 200, style: "Garden patio", indoor: false, tags: ["dinner", "birthday", "intimate", "shower", "social"], city: "los angeles" },
  { name: "LA Public Library Mark Taper Auditorium", neighborhood: "Downtown", capacity: 235, pricePerHour: 280, style: "Auditorium", indoor: true, tags: ["talk", "conference", "workshop", "student", "community"], city: "los angeles" },
  { name: "Moscone Center West", neighborhood: "SoMa, San Francisco", capacity: 5000, pricePerHour: 9500, style: "Convention center halls", indoor: true, tags: ["hackathon", "conference", "expo", "large", "corporate", "techy"], city: "bay area" },
  { name: "Palace of Fine Arts Exhibition Hall", neighborhood: "Marina, San Francisco", capacity: 3500, pricePerHour: 6000, style: "Historic exhibition hall", indoor: true, tags: ["hackathon", "gala", "expo", "conference", "large", "iconic"], city: "bay area" },
  { name: "Fort Mason Festival Pavilion", neighborhood: "Marina, San Francisco", capacity: 3000, pricePerHour: 4200, style: "Waterfront pier pavilion", indoor: true, tags: ["hackathon", "festival", "expo", "launch", "large", "party"], city: "bay area" },
  { name: "Pier 27 Cruise Terminal", neighborhood: "Embarcadero, San Francisco", capacity: 2500, pricePerHour: 5200, style: "Bayfront terminal hall", indoor: true, tags: ["hackathon", "gala", "launch", "conference", "large"], city: "bay area" },
  { name: "Oakland Marriott City Center Ballrooms", neighborhood: "Downtown Oakland", capacity: 2200, pricePerHour: 3200, style: "Convention ballrooms", indoor: true, tags: ["hackathon", "conference", "corporate", "large"], city: "bay area" },
  { name: "UC Berkeley RSF Fieldhouse", neighborhood: "Berkeley campus", capacity: 1800, pricePerHour: 1400, style: "Campus fieldhouse", indoor: true, tags: ["hackathon", "student", "sports", "large", "campus"], city: "bay area" },
  { name: "Pauley Ballroom, MLK Student Union", neighborhood: "Berkeley campus", capacity: 900, pricePerHour: 700, style: "Campus ballroom", indoor: true, tags: ["hackathon", "student", "gala", "workshop", "campus"], city: "bay area" },
  { name: "Shack15 at the Ferry Building", neighborhood: "Embarcadero, San Francisco", capacity: 300, pricePerHour: 1500, style: "Founder clubhouse", indoor: true, tags: ["networking", "launch", "meetup", "techy", "party"], city: "bay area" },
  { name: "Dolores Park North Lawn", neighborhood: "Mission, San Francisco", capacity: 400, pricePerHour: 80, style: "City park", indoor: false, tags: ["picnic", "birthday", "casual", "social", "family"], city: "bay area" },
];

const GENERIC: (Omit<Venue, "why" | "neighborhood"> & { tags: string[] })[] = [
  { name: "Downtown Event Loft", capacity: 250, pricePerHour: 450, style: "Industrial loft", indoor: true, tags: ["launch", "meetup", "hackathon", "party", "corporate"] },
  { name: "University Conference Center", capacity: 600, pricePerHour: 500, style: "Conference hall", indoor: true, tags: ["hackathon", "conference", "student", "workshop"] },
  { name: "Botanical Garden Pavilion", capacity: 180, pricePerHour: 520, style: "Garden pavilion", indoor: false, tags: ["wedding", "gala", "dinner", "formal"] },
  { name: "Public park picnic area", capacity: 200, pricePerHour: 0, style: "Open lawn, first come or reserved via park permit", indoor: false, tags: ["picnic", "family", "casual", "outdoor", "park"] },
  { name: "Community Park Pavilion", capacity: 150, pricePerHour: 50, style: "Covered park pavilion", indoor: false, tags: ["picnic", "birthday", "family", "casual"] },
  { name: "Boutique Hotel Rooftop", capacity: 120, pricePerHour: 650, style: "Rooftop terrace", indoor: false, tags: ["party", "networking", "social", "launch"] },
  { name: "Restaurant table reservation", capacity: 16, pricePerHour: 0, style: "Restaurant, no room fee", indoor: true, tags: ["dinner", "intimate", "birthday", "team", "casual"] },
  { name: "Convention Center Hall", capacity: 8000, pricePerHour: 2500, style: "Exhibit hall, rented by the day", indoor: true, tags: ["conference", "expo", "convention", "trade show"] },
  { name: "Fairgrounds / Stadium Lot", capacity: 60000, pricePerHour: 4000, style: "Open grounds with staging and power", indoor: false, tags: ["festival", "concert", "fair", "large", "music"] },
  { name: "Private Dining Room", capacity: 40, pricePerHour: 220, style: "Restaurant private room", indoor: true, tags: ["dinner", "intimate", "birthday", "team"] },
];

export function venueSearchTool(city: string, eventType: string, vibe: string, guests: number, maxHourly: number, prompt = "") {
  const asked = prompt.toLowerCase();
  const region = regionFor(city);
  const words = `${eventType} ${vibe}${guests >= 1000 ? " large" : ""}`.toLowerCase();
  const local = GENERIC.map((v) => ({ ...v, neighborhood: city.split(",")[0], city }));
  const pool = region ? [...CATALOG.filter((v) => v.city === region), ...local] : local;
  return pool
    .map((v) => {
      const tagScore = v.tags.filter((t) => new RegExp(`\\b${t}\\b`).test(words)).length * 3 + (v.tags.includes(eventType.toLowerCase()) ? 4 : 0);
      const fits = v.capacity >= guests ? Math.max(-6, 4 - 2 * Math.log2(v.capacity / Math.max(guests, 1))) : -10;
      const wantsIndoor = /indoor/.test(words) && !v.indoor ? -12 : 0;
      const price = v.pricePerHour <= maxHourly ? 2 : -3 - 2 * Math.log2(v.pricePerHour / Math.max(maxHourly, 1));
      const cityName = city.split(",")[0].trim().toLowerCase();
      const named = CATALOG.includes(v as (typeof CATALOG)[number]);
      const near = named && cityName && `${v.name} ${v.neighborhood}`.toLowerCase().includes(cityName) ? 3 : 0;
      const requested = asked && namePattern(v.name).test(asked) ? 30 : 0;
      return { v, score: requested + wantsIndoor + tagScore + (tagScore ? 0 : -3) + fits + price + near + (named ? 2 : 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ v }) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tags, city: _c, ...rest } = v as typeof v & { city?: string };
      return { ...rest, why: "" } as Venue;
    });
}

/** Matches a venue named in free text by its first two distinctive words, e.g. "Palace of Fine Arts" or "Pier 27". */
function namePattern(name: string) {
  const words = name.toLowerCase().split(/\s+/).filter((w) => /^[a-z0-9]+$/.test(w) && !/^(of|at|the|a|and)$/.test(w));
  return new RegExp(`\\b${words.slice(0, 2).join("\\W+(?:\\w+\\W+){0,2}")}\\b`);
}

export function regionFor(city: string): "los angeles" | "bay area" | null {
  if (/los angeles|\bla\b|westwood|santa monica|ucla|hollywood|venice|pasadena/i.test(city)) return "los angeles";
  if (/san francisco|\bsf\b|berkeley|oakland|bay area|palo alto|san jose|mountain view|dolores|presidio|golden gate|fort mason|embarcadero|mission district/i.test(city)) return "bay area";
  return null;
}

/** Venues bill multi-day events by the day (~12 billable hours/day), not every overnight hour. */
export function billableHours(durationHours: number) {
  return durationHours <= 12 ? durationHours : Math.ceil(durationHours / 24) * 12;
}
