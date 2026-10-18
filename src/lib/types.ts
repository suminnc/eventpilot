export type EventBrief = {
  prompt: string;
  eventType: string;
  title: string;
  city: string;
  date: string; // ISO yyyy-mm-dd
  startTime: string; // HH:mm
  durationHours: number;
  guests: number;
  budget: number; // USD
  vibe: string;
  constraints: string[];
  assumptions?: string[];
};

export type Venue = {
  name: string;
  neighborhood: string;
  capacity: number;
  pricePerHour: number;
  style: string;
  why: string;
  indoor: boolean;
  url?: string;
};

export type BudgetLine = {
  category: string;
  amount: number;
  note: string;
};

export type ScheduleItem = {
  day?: number;
  time: string; // HH:mm
  durationMin: number;
  title: string;
  detail: string;
  owner?: string;
};

export type Task = {
  id: string;
  title: string;
  due: string; // ISO date
  owner: string;
  priority: "high" | "medium" | "low";
  done: boolean;
  agent: AgentId;
};

export type Vendor = {
  category: string;
  suggestion: string;
  estCost: number;
  contactTip: string;
};

export type Weather = {
  summary: string;
  highC: number | null;
  lowC: number | null;
  precipChance: number | null;
  source: string;
};

export type Risk = {
  level: "high" | "medium" | "low";
  issue: string;
  mitigation: string;
};

export type EventPlan = {
  id: string;
  createdAt: string;
  brief: EventBrief;
  summary: string;
  venues: Venue[];
  selectedVenue: number;
  budget: BudgetLine[];
  schedule: ScheduleItem[];
  tasks: Task[];
  vendors: Vendor[];
  permits?: Permit[];
  ops?: OpsPlan;
  weather: Weather | null;
  invite: { subject: string; body: string; sms: string };
  risks: Risk[];
  score: number; // verifier confidence 0-100
  mode: "llm" | "offline";
  model: string;
  usage?: { calls: number; promptTokens: number; completionTokens: number };
  autopilot?: Autopilot;
  workflowDone?: string[];
};

export type SpendMandate = {
  totalCap: number;
  perPurchaseCap: number;
  approvalThreshold: number;
  allowedCategories: string[];
};

export type Purchase = {
  id: string;
  idempotencyKey: string;
  vendor: string;
  category: string;
  purpose: string;
  amount: number;
  status: "auto_approved" | "pending" | "approved" | "rejected" | "blocked" | "refunded" | "canceled";
  why?: string;
  reason: string;
  card?: string; // masked single-use virtual card (simulated)
  ts: number;
};

export type OutboxMessage = {
  id: string;
  channel: "email" | "sms";
  to: string;
  subject: string;
  body: string;
  status: "draft" | "sent";
  taskId?: string;
};

export type AuditEntry = { ts: number; actor: string; action: string; detail: string; prev: string; hash: string };

export type OpsPlan = {
  staffing: { role: string; count: number; note: string }[];
  shifts: { label: string; start: string; end: string; volunteers: number }[];
  policies: { name: string; why: string }[];
  meals: { slot: string; day: number; time: string; servings: number; split: Record<string, number> }[];
  infra: { item: string; qty: string; note: string }[];
  checkin: { lanes: number; minutes: number; note: string };
  sponsors: { tier: string; price: number; count: number; perks: string }[];
  sponsorTarget: number;
  contacts: { role: string; owner: string; when: string }[];
};

export type Permit = {
  name: string;
  agency: string;
  why: string;
  leadDays: number;
  fee: number;
  deadline: string;
  atRisk: boolean;
  taskId?: string;
};

export type Round = { by: "agent" | "vendor"; price: number; note: string };

export type Quote = {
  vendor: string;
  price: number;
  listPrice?: number;
  rounds?: Round[];
  rating: number;
  leadDays: number;
  cancellable: boolean;
  tags: string[];
  note?: string;
};

export type Shortlist = {
  category: string;
  target: number;
  quotes: Quote[];
  pick: number;
  why: string;
  negotiated?: boolean;
};

export type TextMessage = {
  id: string;
  dir: "out" | "in";
  body: string;
  ts: number;
  via: "photon" | "simulated";
  queued?: boolean;
};

export type ThreadEntry = { dir: "in" | "out"; ts: number; body: string; price?: number };
/** A real email conversation with one vendor (replies read from the mailbox, negotiated by the agent). */
export type VendorThread = {
  id: string;
  vendor: string;
  category: string;
  to: string;
  subject: string;
  messageIds: string[];
  status: "awaiting_reply" | "negotiating" | "agreed" | "booked" | "declined" | "needs_you";
  target: number;
  ceiling: number;
  offer?: number;
  theirPrice?: number;
  agreed?: number;
  depositPct?: number;
  rounds: number;
  followups: number;
  lastOut: number;
  purchaseId?: string;
  flagged?: boolean;
  log: ThreadEntry[];
};
export type Autopilot = {
  threads?: VendorThread[];
  shortlists?: Shortlist[];
  texts?: TextMessage[];
  texted?: string[];
  mandate: SpendMandate;
  purchases: Purchase[];
  outbox: OutboxMessage[];
  audit: AuditEntry[];
};

export type AgentId =
  | "exec"
  | "logistics_lead"
  | "venue"
  | "food"
  | "program"
  | "merch"
  | "people"
  | "finance"
  | "sponsorship"
  | "comms"
  | "verifier"
  | "permits"
  | "payments";

export type AgentEvent =
  | { type: "agent_start"; agent: AgentId; message: string; ts: number }
  | { type: "thought"; agent: AgentId; message: string; ts: number }
  | { type: "tool_call"; agent: AgentId; tool: string; input: string; ts: number }
  | { type: "tool_result"; agent: AgentId; tool: string; output: string; ts: number }
  | { type: "agent_done"; agent: AgentId; message: string; ms: number; ts: number }
  | { type: "plan"; plan: EventPlan; ts: number }
  | { type: "error"; message: string; ts: number };

/**
 * The organizing crew follows the subteam model: one Exec owns delivery and the attendee experience,
 * a Logistics lead scopes the event and distributes to one sub-agent per overarching task, Finance gates
 * every dollar, Sponsorship owns revenue and Comms owns the attendee voice, and a Verifier closes the loop.
 */
export const AGENTS: Record<AgentId, { name: string; role: string; color: string }> = {
  exec: { name: "Exec", role: "Owns delivery & attendee experience", color: "#a78bfa" },
  logistics_lead: { name: "Logistics Lead", role: "Scopes the event & distributes", color: "#fb923c" },
  venue: { name: "Venue & Services", role: "Venue, wifi, power, A/V, floorplan", color: "#38bdf8" },
  food: { name: "Food", role: "Catering, dietary, portions", color: "#f97316" },
  program: { name: "Program & Run-of-show", role: "Agenda & day-of timing", color: "#fbbf24" },
  merch: { name: "Merch & Gifts", role: "Swag, print, prizes, signage art", color: "#e879f9" },
  people: { name: "People Logistics", role: "Buses, hotels, parking, travel", color: "#60a5fa" },
  finance: { name: "Finance", role: "Budget, cost gate & payments", color: "#34d399" },
  sponsorship: { name: "Sponsorship", role: "Revenue & sponsor deliverables", color: "#f472b6" },
  comms: { name: "Comms", role: "Attendee guide & reminders", color: "#c084fc" },
  verifier: { name: "Verifier", role: "Adversarially checks the plan", color: "#f87171" },
  permits: { name: "Permits", role: "Permits & compliance", color: "#a3e635" },
  payments: { name: "Payments", role: "Guarded agentic checkout", color: "#22d3ee" },
};
