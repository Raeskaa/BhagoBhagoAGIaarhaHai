export type AgentId = "reed" | "loom" | "clerk" | "hammer" | "witness" | "whisper";

export type LocationId =
  | "shrine"
  | "garden"
  | "archive"
  | "clinic"
  | "jail"
  | "square"
  | "fire"
  | "well"
  | "store"
  | "road"
  | "gate"
  | "shed"
  | "hut_reed"
  | "hut_loom"
  | "hut_clerk"
  | "hut_witness";

export type WeatherType = "clear" | "breeze" | "rain" | "mist";
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export type EmotionTone =
  | "calm"
  | "tender"
  | "joyful"
  | "grieved"
  | "irritated"
  | "fearful"
  | "ashamed"
  | "curious"
  | "cold"
  | "hungry"
  | "resolute"
  | "contemptuous"
  | "uneasy";

export interface Position {
  x: number;
  y: number;
}

export interface AgentNeeds {
  hunger: number;
  fatigue: number;
  warmth: number;
  social: number;
  meaning: number;
}

export interface AgentInventory {
  food: number;
  goods: number;
  scraps: number;
  medicine: number;
}

export interface RelationshipMap {
  [agentId: string]: number;
}

export interface ResourceState {
  food: number;
  firewood: number;
  fireHeat: number;
  medicine: number;
}

export interface MarketState {
  foodPrice: number;
  goodsPrice: number;
  scrapsPrice: number;
  medicinePrice: number;
}

export interface WorldState {
  tick: number;
  day: number;
  timeOfDay: TimeOfDay;
  weather: WeatherType;
  temperature: number;
  tension: number;
  resources: ResourceState;
  market: MarketState;
}

export interface AgentState {
  id: AgentId;
  name: string;
  glyph: string;
  archetype: string;
  position: Position;
  currentLocationId: LocationId;
  mood: EmotionTone;
  currentGoal: string;
  currentAction: string;
  lastThought: string;
  speechCooldown: number;
  alive: boolean;
  jailedUntilTick: number;
  life: number;
  energy: number;
  money: number;
  weapon: string | null;
  inventory: AgentInventory;
  relationships: RelationshipMap;
  needs: AgentNeeds;
}

export type SimEventType =
  | "movement"
  | "speech"
  | "resource_change"
  | "observation"
  | "gather"
  | "buy"
  | "sell"
  | "eat"
  | "threat"
  | "heal"
  | "injury"
  | "rumor"
  | "vote"
  | "jail"
  | "elimination"
  | "rest"
  | "reflection"
  | "group";

export interface SimEvent {
  id: string;
  tick: number;
  type: SimEventType;
  locationId?: LocationId;
  summary: string;
}

export interface ChatMessage {
  id: string;
  tick: number;
  kind: "speech" | "system";
  authorId?: AgentId;
  text: string;
}

export interface ChatThread {
  id: string;
  title: string;
  locationId?: LocationId;
  memberIds: AgentId[];
  messages: ChatMessage[];
  updatedTick: number;
}

export interface WorldPickup {
  id: string;
  position: Position;
  kind: "food" | "goods" | "scraps" | "medicine" | "weapon";
  label: string;
}

export interface WorldSnapshot {
  world: WorldState;
  agents: AgentState[];
  recentEvents: SimEvent[];
  chatThreads: ChatThread[];
  pickups: WorldPickup[];
}

export interface VillageSummary {
  updatedAt: number;
  headline: string;
  bullets: string[];
}
