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

async function fetchJSON<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store", headers });
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

type Cand = Omit<Venue, "why"> & { tags?: string[]; source: "ai" | "map" | "catalog" };
type Geo = { lat: number; lon: number; name: string };
const UA = { "User-Agent": "EventPilot/1.0 (https://eventpilot-sigma.vercel.app)" };

/** Rough rental size/price by map category; AI-proposed venues carry their own estimates. */
const KIND: Record<string, { capacity: number; pricePerHour: number; style: string; indoor: boolean; tags: string[] }> = {
  conference_centre: { capacity: 1000, pricePerHour: 1500, style: "Conference center", indoor: true, tags: ["hackathon", "conference", "expo", "summit", "convention"] },
  community_centre: { capacity: 200, pricePerHour: 150, style: "Community center hall", indoor: true, tags: ["meetup", "workshop", "community", "meeting"] },
  hotel: { capacity: 250, pricePerHour: 900, style: "Hotel event space", indoor: true, tags: ["wedding", "gala", "formal", "banquet"] },
  park: { capacity: 300, pricePerHour: 60, style: "City park (permit)", indoor: false, tags: ["picnic", "outdoor", "park", "family", "festival"] },
  restaurant: { capacity: 50, pricePerHour: 250, style: "Restaurant private dining", indoor: true, tags: ["dinner", "intimate", "team", "rehearsal"] },
  bar: { capacity: 150, pricePerHour: 350, style: "Bar buyout", indoor: true, tags: ["mixer", "networking", "party", "launch", "happy hour", "social"] },
};

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !/^(the|at|of|a|and|sf|la)$/.test(w));
function sameName(a: string, b: string) {
  const [x, y] = [norm(a), norm(b)].sort((p, q) => p.length - q.length);
  const big = new Set(y);
  return x.length > 0 && x.filter((w) => big.has(w)).length / x.length >= 0.75;
}

const ALIAS: Record<string, string> = { la: "Los Angeles", sf: "San Francisco", nyc: "New York", dtla: "Los Angeles", "bay area": "San Francisco" };

/** Geocodes the event city. Ambiguous names (Pasadena TX vs CA) prefer the state/country given, then California (home market), then the US. */
async function geocode(city: string): Promise<Geo | null> {
  const [head, ...rest] = city.split(",").map((x) => x.trim());
  const name = ALIAS[head.toLowerCase()] ?? head;
  const hint = rest.join(" ").toLowerCase();
  const g = await fetchJSON<{ results?: { latitude: number; longitude: number; name: string; admin1?: string; country_code?: string; population?: number }[] }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10`,
  ).catch(() => null);
  const score = (r: { admin1?: string; country_code?: string; population?: number }) =>
    (hint && r.admin1 && (hint.includes(r.admin1.toLowerCase()) || (hint === "ca" && r.admin1 === "California") || hint === r.admin1.slice(0, 2).toLowerCase()) ? 1e9 : 0) +
    (r.admin1 === "California" ? 1e8 : 0) + (r.country_code === "US" ? 1e7 : 0) + Math.min(r.population ?? 0, 9e6);
  const r = [...(g?.results ?? [])].sort((x, y) => score(y) - score(x))[0];
  return r ? { lat: r.latitude, lon: r.longitude, name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name } : null;
}

type PhotonHit = { geometry: { coordinates: [number, number] }; properties: { name?: string; osm_type: string; osm_id: number; osm_value: string; street?: string; housenumber?: string; district?: string; city?: string } };
const osmUrl = (t: string, id: number) => `https://www.openstreetmap.org/${{ N: "node", W: "way", R: "relation" }[t] ?? "node"}/${id}`;
const addr = (p: PhotonHit["properties"]) => [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.city ?? p.district].filter(Boolean).join(", ");

/** Checks a venue name against OpenStreetMap near the city; returns its real address + map link, or null if it can't be found. */
async function verifyPlace(name: string, geo: Geo) {
  const j = await fetchJSON<{ features: PhotonHit[] }>(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(name)}&lat=${geo.lat}&lon=${geo.lon}&limit=8`, UA,
  ).catch(() => null);
  const town = geo.name.split(",")[0].toLowerCase();
  const claimsTown = new RegExp(`\\b(${town}|downtown|dtla)\\b`, "i").test(name);
  const hit = (j?.features ?? [])
    .map((f) => ({ f, d: km(geo, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }) }))
    .filter(({ f, d }) => f.properties.name && sameName(name, f.properties.name) && d < 40 && !(claimsTown && f.properties.city && f.properties.city.toLowerCase() !== town))
    .sort((a, b) => a.d - b.d)[0]?.f;
  return hit ? { address: addr(hit.properties), url: osmUrl(hit.properties.osm_type, hit.properties.osm_id) } : null;
}

type NomHit = { name: string; type: string; lat: string; lon: string; osm_type: string; osm_id: number; address?: Record<string, string>; extratags?: Record<string, string> };
/** Lists real places of one kind around the city from OpenStreetMap (Nominatim), e.g. "community centre in Pasadena". */
async function mapListing(kind: string, label: string, city: string, geo: Geo): Promise<Cand[]> {
  const j = await fetchJSON<NomHit[]>(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${label} in ${city.split(",")[0].trim()}`)}&format=jsonv2&limit=10&extratags=1&addressdetails=1`, UA,
  ).catch(() => [] as NomHit[]);
  const k = KIND[kind];
  return j
    .filter((h) => h.name && km(geo, { lat: +h.lat, lon: +h.lon }) < 30 && !/senior|church|school|clinic|hospital|apartment|housing|shelter|library|recovery/i.test(h.name))
    .map((h) => ({
      name: h.name,
      neighborhood: [h.address?.house_number && h.address?.road ? `${h.address.house_number} ${h.address.road}` : h.address?.road, h.address?.neighbourhood ?? h.address?.suburb ?? h.address?.city].filter(Boolean).join(", "),
      capacity: Number(h.extratags?.capacity) || k.capacity,
      pricePerHour: k.pricePerHour,
      style: k.style,
      indoor: k.indoor,
      url: h.extratags?.website ?? `https://www.openstreetmap.org/${h.osm_type}/${h.osm_id}`,
      tags: k.tags,
      source: "map" as const,
    }));
}

function kindsFor(words: string, guests: number): [string, string][] {
  const k: [string, string][] = [];
  if (/hackathon|conference|expo|summit|convention/.test(words) || guests >= 400) k.push(["conference_centre", "conference centre"]);
  if (/picnic|park|outdoor|family|festival/.test(words)) k.push(["park", "park"]);
  if (/dinner|intimate|team|shower|rehearsal/.test(words)) k.push(["restaurant", "restaurant"]);
  if (/mixer|networking|party|launch|social|happy hour|birthday/.test(words)) k.push(["bar", "bar"]);
  if (/wedding|gala|formal|banquet/.test(words) || guests >= 150) k.push(["hotel", "hotel"]);
  k.push(["community_centre", "community centre"]);
  return k.slice(0, 2);
}

export type VenueSearch = { venues: Venue[]; checked: number; dropped: string[]; source: string; aiError?: string };

/**
 * Live venue search, run fresh for every plan: the AI proposes real venues it knows in the city, each one is checked
 * against OpenStreetMap (unverifiable names are dropped), and real places from a map listing fill in. Prices are
 * typical rental estimates to confirm with the venue.
 */
export async function venueSearchTool(
  city: string, eventType: string, vibe: string, guests: number, maxHourly: number, prompt = "",
  propose?: () => Promise<Omit<Venue, "why" | "url">[]>,
): Promise<VenueSearch> {
  const words = `${eventType} ${vibe} ${prompt}`.toLowerCase();
  const geo = await geocode(city);
  const dropped: string[] = [];
  let pool: Cand[] = [];
  let checked = 0;
  let aiError: string | undefined;
  if (geo) {
    const [ai, ...maps] = await Promise.all([
      propose ? propose().catch((e: Error) => ((aiError = e.message.slice(0, 120)), [] as Omit<Venue, "why" | "url">[])) : Promise.resolve([] as Omit<Venue, "why" | "url">[]),
      ...kindsFor(words, guests).map(([k, l], i) => new Promise<Cand[]>((r) => setTimeout(r, i * 1100)).then(() => mapListing(k, l, city, geo))),
    ]);
    checked = ai.length;
    const verified = await Promise.all(ai.slice(0, 10).map(async (v) => ({ v, real: await verifyPlace(v.name, geo) })));
    for (const { v, real } of verified) {
      if (real) pool.push({ ...v, neighborhood: real.address || v.neighborhood, url: real.url, source: "ai" });
      else dropped.push(v.name);
    }
    const key = (v: Cand) => v.neighborhood.split(",")[0].trim().toLowerCase();
    for (const m of maps.flat()) if (!pool.some((p) => sameName(p.name, m.name) || (/^\d/.test(key(m)) && key(p) === key(m)))) pool.push(m);
  }
  const region = regionFor(city);
  const low = prompt.toLowerCase();
  const picks = CATALOG.filter((v) => v.city === region && (namePattern(v.name).test(low) || (guests >= 500 && v.capacity >= guests)) && !pool.some((p) => sameName(p.name, v.name)));
  const located = geo ? await Promise.all(picks.map((c) => verifyPlace(c.name.split(/,| at /)[0], geo))) : [];
  picks.forEach((c, i) => pool.push({ ...c, url: c.url ?? located[i]?.url ?? `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${c.name}, ${c.neighborhood}`)}`, source: "catalog" }));
  const fromCatalog = !pool.some((p) => p.source !== "catalog") && !!region;
  if (fromCatalog && !pool.length) pool = CATALOG.filter((v) => v.city === region).map((v) => ({ ...v, source: "catalog" as const }));
  const ranked = pool
    .map((v) => {
      const fits = v.capacity >= guests ? Math.max(-6, 4 - 2 * Math.log2(v.capacity / Math.max(guests, 1))) : -10;
      const wantsIndoor = /indoor/.test(words) && !v.indoor ? -12 : /picnic|outdoor|park\b|lawn/.test(words) ? (v.indoor ? -2 : 4) : 0;
      const price = v.pricePerHour <= maxHourly ? 2 : -3 - 2 * Math.log2(v.pricePerHour / Math.max(maxHourly, 1));
      const tagScore = (v.tags ?? []).filter((t) => new RegExp(`\\b${t}\\b`).test(words)).length * 3;
      const requested = namePattern(v.name).test(prompt.toLowerCase()) ? 30 : 0;
      return { v, score: requested + wantsIndoor + fits + price + tagScore + (v.source === "ai" ? 6 : 0) };
    })
    .sort((a, b) => b.score - a.score)
    .filter(({ v }, i, all) => all.slice(0, i).filter((x) => x.v.style === v.style).length < 2)
    .slice(0, 5)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ v: { tags, source, ...rest } }) => ({ ...rest, why: "" }) as Venue);
  return {
    venues: ranked,
    checked,
    dropped,
    aiError,
    source: fromCatalog
      ? "Live search found nothing; used curated real venues"
      : geo ? `OpenStreetMap search around ${geo.name}${checked ? ` + ${checked} AI-suggested venues checked` : ""}` : "City not found",
  };
}

/** Matches a venue named in free text by its first two distinctive words, e.g. "Palace of Fine Arts" or "Pier 27". */
export function namePattern(name: string) {
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
