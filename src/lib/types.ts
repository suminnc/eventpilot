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
  weather: Weather | null;
  invite: { subject: string; body: string; sms: string };
  risks: Risk[];
  score: number; // critic confidence 0-100
  mode: "llm" | "offline";
  model: string;
};

export type AgentId =
  | "coordinator"
  | "scout"
  | "budget"
  | "scheduler"
  | "logistics"
  | "comms"
  | "critic";

export type AgentEvent =
  | { type: "agent_start"; agent: AgentId; message: string; ts: number }
  | { type: "thought"; agent: AgentId; message: string; ts: number }
  | { type: "tool_call"; agent: AgentId; tool: string; input: string; ts: number }
  | { type: "tool_result"; agent: AgentId; tool: string; output: string; ts: number }
  | { type: "agent_done"; agent: AgentId; message: string; ms: number; ts: number }
  | { type: "plan"; plan: EventPlan; ts: number }
  | { type: "error"; message: string; ts: number };

export const AGENTS: Record<AgentId, { name: string; role: string; color: string }> = {
  coordinator: { name: "Coordinator", role: "Parses intent & delegates", color: "#a78bfa" },
  scout: { name: "Venue Scout", role: "Finds & ranks venues", color: "#38bdf8" },
  budget: { name: "Budget Analyst", role: "Allocates every dollar", color: "#34d399" },
  scheduler: { name: "Scheduler", role: "Builds run-of-show", color: "#fbbf24" },
  logistics: { name: "Logistics", role: "Vendors, weather, tasks", color: "#fb923c" },
  comms: { name: "Comms", role: "Invites & reminders", color: "#f472b6" },
  critic: { name: "Critic", role: "Stress-tests the plan", color: "#f87171" },
};
