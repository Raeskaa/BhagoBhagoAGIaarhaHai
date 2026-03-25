import { baseMapRows, locationPositions } from "@/lib/constants/map";
import { createAgentPromptPayload, generateLocalFallbackDecisionMap, type AIDecision, type AgentPromptPayload } from "@/lib/ai";
import type { AgentId, AgentNeeds, AgentState, ChatMessage, ChatThread, EmotionTone, LocationId, Position, SceneFocus, SimEvent, WorldPickup, WorldSnapshot } from "@/lib/types";

const AGENT_ORDER: AgentId[] = ["reed", "loom", "clerk", "hammer", "witness", "whisper"];
const TIME_SEQUENCE = ["dawn", "day", "dusk", "night"] as const;
const WEATHER_SEQUENCE = ["clear", "breeze", "rain", "mist"] as const;

const locationLabels: Record<LocationId, string> = {
  shrine: "shrine grove",
  garden: "garden beds",
  archive: "archive house",
  clinic: "clinic",
  jail: "jail block",
  square: "village square",
  fire: "communal fire",
  well: "stone well",
  store: "storehouse",
  road: "main path",
  gate: "eastern gate",
  shed: "woodshed",
  hut_reed: "Modi's bungalow",
  hut_loom: "Rahul's room",
  hut_clerk: "Mahesh's room",
  hut_witness: "Beggar's corner",
};

const starterWeapons: Record<AgentId, string | null> = {
  reed: "security baton",
  loom: null,
  clerk: "steel bottle",
  hammer: "paint knife",
  witness: "rusted stick",
  whisper: null,
};

const threadTemplates = [
  { id: "square-circle", title: "Power Adda", locationId: "square" as LocationId },
  { id: "fireside", title: "Bonfire Bakchodi", locationId: "fire" as LocationId },
  { id: "garden-club", title: "Mola's Studio Lawn", locationId: "garden" as LocationId },
  { id: "clinic-desk", title: "Clinic Desk", locationId: "clinic" as LocationId },
  { id: "jail-yard", title: "Jail Yard", locationId: "jail" as LocationId },
  { id: "well-watch", title: "Tapri Watch", locationId: "well" as LocationId },
  { id: "roadside", title: "Roadside Drama", locationId: "road" as LocationId },
];

const ITEM_PRICES = {
  food: 2,
  goods: 3,
  scraps: 1,
  medicine: 4,
} as const;

const weaponPower: Record<string, number> = {
  "security baton": 16,
  "steel bottle": 12,
  "paint knife": 14,
  "rusted stick": 9,
};

const locationSceneFocus: Partial<Record<LocationId, SceneFocus>> = {
  fire: "gossip",
  square: "confrontation",
  well: "gossip",
  road: "trade",
  store: "trade",
  clinic: "healing",
  jail: "jail-vote",
  archive: "reflection",
  shrine: "reflection",
  garden: "alliance",
  gate: "survival",
  shed: "survival",
  hut_reed: "rest",
  hut_loom: "rest",
  hut_clerk: "rest",
  hut_witness: "rest",
};

function createInitialPickups(): WorldPickup[] {
  return [
    { id: "pickup-food-1", position: { x: 25, y: 4 }, kind: "food", label: "ration crate" },
    { id: "pickup-med-1", position: { x: 22, y: 10 }, kind: "medicine", label: "med kit" },
    { id: "pickup-scrap-1", position: { x: 19, y: 6 }, kind: "scraps", label: "metal scraps" },
    { id: "pickup-goods-1", position: { x: 15, y: 7 }, kind: "goods", label: "trade bundle" },
  ];
}

function activeAgents(agents: AgentState[]) {
  return agents.filter((agent) => agent.alive);
}

function liveDecisionAgents(agents: AgentState[]) {
  return agents.filter((agent) => agent.alive);
}

function withPanicState(agent: AgentState, nextTick: number) {
  const stillPanicking = agent.panicUntilTick > nextTick;
  return {
    ...agent,
    panicUntilTick: stillPanicking ? agent.panicUntilTick : 0,
    panicSourcePosition: stillPanicking && agent.panicSourcePosition ? { ...agent.panicSourcePosition } : null,
  };
}

function relationshipValue(agent: AgentState, otherId: AgentId) {
  return agent.relationships[otherId] ?? 0;
}

function shiftRelationship(agent: AgentState, otherId: AgentId, delta: number) {
  agent.relationships[otherId] = clamp((agent.relationships[otherId] ?? 0) + delta, -100, 100);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function distance(a: Position, b: Position) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isWalkable(position: Position) {
  const row = baseMapRows[position.y];
  const tile = row?.[position.x];
  return tile !== undefined && tile !== "^" && tile !== "t" && tile !== "~";
}

function pickMood(needs: AgentNeeds): EmotionTone {
  if (needs.hunger > 72) return "hungry";
  if (needs.warmth > 68) return "cold";
  if (needs.fatigue > 76) return "uneasy";
  if (needs.social > 70) return "tender";
  if (needs.meaning > 70) return "curious";
  return "calm";
}

function preferredLocation(agent: AgentState): LocationId {
  if (!agent.alive) return "jail";
  if (agent.jailedUntilTick > 0) return "jail";
  if (agent.life < 42) return "clinic";
  if (agent.inventory.medicine < 1 && agent.life < 58) return "clinic";
  if (agent.needs.hunger > 70) return agent.id === "loom" ? "garden" : "store";
  if (agent.needs.fatigue > 78) {
    if (agent.id === "reed") return "hut_reed";
    if (agent.id === "loom") return "hut_loom";
    if (agent.id === "clerk") return "hut_clerk";
    if (agent.id === "witness") return "hut_witness";
    return "road";
  }
  if (agent.needs.social > 65) return agent.id === "hammer" ? "square" : "fire";
  if (agent.needs.meaning > 66) return agent.id === "clerk" ? "archive" : "shrine";

  const byNature: Record<AgentId, LocationId[]> = {
    reed: ["garden", "fire", "shrine", "square"],
    loom: ["garden", "store", "road", "fire"],
    clerk: ["archive", "well", "square", "hut_clerk"],
    hammer: ["square", "gate", "well", "road"],
    witness: ["fire", "well", "shrine", "hut_witness"],
    whisper: ["well", "road", "square", "jail"],
  };

  const options = byNature[agent.id];
  return options[(Math.floor(Math.random() * options.length) + agent.position.x + agent.position.y) % options.length];
}

function homeLocationFor(agent: AgentState): LocationId {
  if (agent.id === "reed") return "hut_reed";
  if (agent.id === "loom") return "hut_loom";
  if (agent.id === "clerk") return "hut_clerk";
  if (agent.id === "witness") return "hut_witness";
  return "road";
}

function scheduleLocationFor(agent: AgentState, world: WorldSnapshot["world"]): LocationId {
  if (!agent.alive) return "jail";
  if (agent.jailedUntilTick > world.tick) return "jail";
  if (agent.life < 42 || (agent.life < 58 && agent.inventory.medicine < 1)) return "clinic";
  if (agent.needs.hunger > 72) return agent.id === "loom" ? "garden" : "store";
  if (agent.needs.fatigue > 80 || (world.timeOfDay === "night" && agent.energy < 58)) return homeLocationFor(agent);

  if (world.timeOfDay === "dawn") {
    const dawnPlan: Record<AgentId, LocationId> = {
      reed: "shrine",
      loom: "garden",
      clerk: "archive",
      hammer: "well",
      witness: "store",
      whisper: "road",
    };

    return dawnPlan[agent.id];
  }

  if (world.timeOfDay === "day") {
    const dayPlan: Record<AgentId, LocationId> = {
      reed: "square",
      loom: "garden",
      clerk: "road",
      hammer: "square",
      witness: "well",
      whisper: "store",
    };

    return dayPlan[agent.id];
  }

  if (world.timeOfDay === "dusk") {
    const duskPlan: Record<AgentId, LocationId> = {
      reed: "fire",
      loom: "fire",
      clerk: "well",
      hammer: "fire",
      witness: "fire",
      whisper: "square",
    };

    return duskPlan[agent.id];
  }

  const nightPlan: Record<AgentId, LocationId> = {
    reed: "hut_reed",
    loom: "hut_loom",
    clerk: "hut_clerk",
    hammer: "road",
    witness: "hut_witness",
    whisper: "jail",
  };

  return nightPlan[agent.id];
}

function agentSceneFocus(agent: AgentState, world: WorldSnapshot["world"]): SceneFocus {
  if (!agent.alive) return "survival";
  if (agent.jailedUntilTick > world.tick) return "jail-vote";
  if (agent.life < 45) return "healing";
  if (agent.needs.hunger > 70 || agent.energy < 28) return "survival";
  if (world.tension > 72 && agent.weapon) return "confrontation";
  if (world.timeOfDay === "dawn") return "reflection";
  if (world.timeOfDay === "night") return "rest";
  return locationSceneFocus[agent.currentLocationId] ?? "gossip";
}

function chooseCommittedDestination(agent: AgentState, agents: AgentState[], world: WorldSnapshot["world"], decision?: AIDecision) {
  const scheduledLocation = scheduleLocationFor(agent, world);
  const decisionLocation = resolveDecisionDestination(agent, agents, world, decision);
  const hostileEnemy = strongestEnemy(agent, agents);

  let destination = decisionLocation;

  if (agent.needs.social < 45 && world.timeOfDay !== "dusk") {
    destination = scheduledLocation;
  }

  if (hostileEnemy && relationshipValue(agent, hostileEnemy.id) < -50 && world.tension > 64 && hostileEnemy.alive) {
    destination = hostileEnemy.currentLocationId;
  }

  if (agent.targetLocationId === destination && agent.destinationCommitment > 0) {
    return {
      destination,
      commitment: Math.max(agent.destinationCommitment - 1, 2),
    };
  }

  const tripDistance = distance(agent.position, locationPositions[destination]);
  return {
    destination,
    commitment: clamp(3 + tripDistance + (world.timeOfDay === "night" ? 2 : 0), 3, 12),
  };
}

function activeDestinationFor(agent: AgentState, agents: AgentState[], world: WorldSnapshot["world"], decision?: AIDecision): LocationId {
  const reachedTarget = distance(agent.position, locationPositions[agent.targetLocationId]) <= 1;
  const shouldRefresh =
    reachedTarget ||
    agent.destinationCommitment <= 0 ||
    agent.jailedUntilTick > world.tick ||
    agent.life < 40 ||
    (world.timeOfDay === "night" && agent.targetLocationId !== homeLocationFor(agent) && agent.id !== "whisper");

  if (!shouldRefresh) {
    return agent.targetLocationId;
  }

  const nextPlan = chooseCommittedDestination(agent, agents, world, decision);
  agent.targetLocationId = nextPlan.destination;
  agent.destinationCommitment = nextPlan.commitment;
  return nextPlan.destination;
}

function rememberLine(agent: AgentState, line: string) {
  agent.recentLines = [line, ...agent.recentLines.filter((entry) => entry !== line)].slice(0, 4);
}

function getCandidateSteps(start: Position, target: Position): Position[] {
  const horizontal = { x: start.x + Math.sign(target.x - start.x), y: start.y };
  const vertical = { x: start.x, y: start.y + Math.sign(target.y - start.y) };
  const candidates = [horizontal, vertical];

  if (Math.random() > 0.5) candidates.reverse();

  return [
    ...candidates,
    { x: start.x + 1, y: start.y },
    { x: start.x - 1, y: start.y },
    { x: start.x, y: start.y + 1 },
    { x: start.x, y: start.y - 1 },
  ];
}

function nextStepToward(start: Position, target: Position, occupied: Set<string>): Position {
  for (const candidate of getCandidateSteps(start, target)) {
    const key = `${candidate.x}:${candidate.y}`;
    if (isWalkable(candidate) && !occupied.has(key)) {
      return candidate;
    }
  }

  return start;
}

function nextStepAwayFrom(start: Position, danger: Position, occupied: Set<string>): Position {
  const candidates = [
    { x: start.x + 1, y: start.y },
    { x: start.x - 1, y: start.y },
    { x: start.x, y: start.y + 1 },
    { x: start.x, y: start.y - 1 },
  ].sort((left, right) => distance(right, danger) - distance(left, danger));

  for (const candidate of candidates) {
    const key = `${candidate.x}:${candidate.y}`;
    if (isWalkable(candidate) && !occupied.has(key)) {
      return candidate;
    }
  }

  return start;
}

function nearestAgent(agent: AgentState, agents: AgentState[]) {
  return agents
    .filter((other) => other.id !== agent.id)
    .sort((left, right) => distance(agent.position, left.position) - distance(agent.position, right.position))[0];
}

function describeGoal(destination: LocationId) {
  const names: Record<LocationId, string> = {
    shrine: "wander toward the shrine",
    garden: "circle the gardens",
    archive: "enter the archive house",
    clinic: "head toward the clinic",
    jail: "head toward the jail",
    square: "show up in the square",
    fire: "draw near the fire circle",
    well: "pause near the well",
    store: "check the storehouse",
    road: "walk the main path",
    gate: "test the village edge",
    shed: "look through the shed",
    hut_reed: "return to Modi's bungalow",
    hut_loom: "return to Rahul's room",
    hut_clerk: "go back to Mahesh's room",
    hut_witness: "slip back to Beggar's corner",
  };

  return names[destination];
}

function createEvent(snapshot: WorldSnapshot, type: SimEvent["type"], summary: string, locationId?: LocationId): SimEvent {
  return {
    id: `${snapshot.world.tick}-${snapshot.recentEvents.length}-${Math.random().toString(36).slice(2, 8)}`,
    tick: snapshot.world.tick,
    type,
    locationId,
    summary,
  };
}

function createInitialThreads(): ChatThread[] {
  return threadTemplates.map((template) => ({
    id: template.id,
    title: template.title,
    locationId: template.locationId,
    memberIds: [],
    messages: [],
    updatedTick: 0,
  }));
}

function assignThreads(agents: AgentState[], tick: number, previousThreads: ChatThread[]) {
  const threads = previousThreads.map((thread) => ({ ...thread, memberIds: [...thread.memberIds], messages: [...thread.messages] }));

  threads.forEach((thread) => {
    thread.memberIds = agents
      .filter((agent) => (thread.locationId ? distance(agent.position, locationPositions[thread.locationId]) <= 3 : false))
      .map((agent) => agent.id);
  });

  agents.forEach((agent) => {
    const localThread = threads.find((thread) => thread.locationId === agent.currentLocationId || thread.memberIds.includes(agent.id));
    if (!localThread) return;
    if (localThread.memberIds.includes(agent.id)) return;

    const joinMessage: ChatMessage = {
      id: `join-${tick}-${agent.id}`,
      tick,
      kind: "system",
      text: `${agent.name.replace("The ", "")} joined ${localThread.title}.`,
    };

    localThread.memberIds.push(agent.id);
    localThread.messages = [joinMessage, ...localThread.messages].slice(0, 10);
    localThread.updatedTick = tick;
  });

  return threads;
}

function postThreadMessage(threads: ChatThread[], threadId: string, message: ChatMessage) {
  const thread = threads.find((entry) => entry.id === threadId);
  if (!thread) return;
  thread.messages = [message, ...thread.messages].slice(0, 12);
  thread.updatedTick = message.tick;
}

function threadForAgent(agent: AgentState, threads: ChatThread[]) {
  return (
    threads.find((thread) => thread.memberIds.includes(agent.id)) ??
    threads.find((thread) => thread.locationId === agent.currentLocationId) ??
    threads[0]
  );
}

function crowdAtLocation(agents: AgentState[], locationId: LocationId) {
  return agents.filter((agent) => distance(agent.position, locationPositions[locationId]) <= 3).length;
}

function socialAnchorFor(agent: AgentState, agents: AgentState[], world: WorldSnapshot["world"]): LocationId {
  const hotspots: LocationId[] = world.tension > 42 ? ["square", "fire", "well", "road", "garden", "clinic"] : ["fire", "square", "well", "garden", "road", "clinic"];

  return hotspots
    .map((locationId) => ({
      locationId,
      crowd: crowdAtLocation(agents, locationId),
      range: distance(agent.position, locationPositions[locationId]),
    }))
    .sort((left, right) => right.crowd - left.crowd || left.range - right.range)[0]?.locationId ?? "fire";
}

function nearbyPartners(agent: AgentState, agents: AgentState[]) {
  return agents
    .filter((other) => other.id !== agent.id && distance(agent.position, other.position) <= 3)
    .sort((left, right) => distance(agent.position, left.position) - distance(agent.position, right.position));
}

function richestBuyerAround(agent: AgentState, agents: AgentState[]) {
  return agents
    .filter((other) => other.id !== agent.id && distance(agent.position, other.position) <= 3 && other.money > 0)
    .sort((left, right) => right.money - left.money)[0];
}

function composeSpeech(agent: AgentState, suggested?: string) {
  if (suggested && suggested.trim().length > 0) {
    return suggested.trim();
  }

  return null;
}

function maybeCreateGroupMoment(snapshot: WorldSnapshot, threads: ChatThread[]) {
  threads.forEach((thread) => {
    if (thread.memberIds.length < 2) return;
    if (thread.updatedTick >= snapshot.world.tick) return;

    const line: ChatMessage = {
      id: `group-${snapshot.world.tick}-${thread.id}`,
      tick: snapshot.world.tick,
      kind: "system",
      text: `${thread.memberIds.length} voices gather in ${thread.title}.`,
    };

    postThreadMessage(threads, thread.id, line);
  });
}

function marketPrice(base: number, world: WorldSnapshot["world"], pressure: number) {
  return Math.max(1, Math.round(base + pressure + world.tension / 28));
}

function strongestEnemy(agent: AgentState, agents: AgentState[]) {
  return agents
    .filter((other) => other.id !== agent.id)
    .sort((left, right) => relationshipValue(agent, left.id) - relationshipValue(agent, right.id))[0];
}

function strongestAlly(agent: AgentState, agents: AgentState[]) {
  return agents
    .filter((other) => other.id !== agent.id)
    .sort((left, right) => relationshipValue(agent, right.id) - relationshipValue(agent, left.id))[0];
}

function resolveDecisionDestination(agent: AgentState, agents: AgentState[], world: WorldSnapshot["world"], decision?: AIDecision) {
  const worstEnemy = strongestEnemy(agent, agents);
  const bestAlly = strongestAlly(agent, agents);

  if (decision?.targetLocationId) return decision.targetLocationId;
  if (agent.life < 45 || (agent.life < 60 && agent.inventory.medicine < 1)) return "clinic";
  if (worstEnemy && relationshipValue(agent, worstEnemy.id) < -42 && world.tension > 56) return worstEnemy.currentLocationId;
  if (bestAlly && relationshipValue(agent, bestAlly.id) > 30 && agent.needs.social > 34) return bestAlly.currentLocationId;
  if (decision?.action === "speak") return socialAnchorFor(agent, agents, world);
  if (decision?.action === "gather") return agent.id === "loom" ? "garden" : "store";
  if (decision?.action === "reflect") return agent.id === "clerk" ? "archive" : "shrine";
  if (decision?.action === "rest") {
    if (agent.id === "reed") return "hut_reed";
    if (agent.id === "loom") return "hut_loom";
    if (agent.id === "clerk") return "hut_clerk";
    if (agent.id === "witness") return "hut_witness";
    return "road";
  }
  if (agent.needs.social > 52 || world.timeOfDay === "dusk" || world.timeOfDay === "night") {
    return socialAnchorFor(agent, agents, world);
  }
  return preferredLocation(agent);
}

function applyLocationState(
  agent: AgentState,
  snapshot: WorldSnapshot,
  events: SimEvent[],
) {
  if (agent.currentLocationId === "fire") {
    agent.needs.warmth = clamp(agent.needs.warmth - 10);
    agent.energy = clamp(agent.energy + 4);
    snapshot.world.resources.fireHeat = clamp(snapshot.world.resources.fireHeat + 1, 0, 10);
    agent.lastThought = `${agent.name} stays where people naturally gather.`;
    return;
  }

  if (agent.currentLocationId === "store" || agent.currentLocationId === "garden") {
    agent.currentAction = "gather";
    agent.inventory.food += 1;
    agent.inventory.goods += agent.currentLocationId === "store" ? 1 : 0;
    snapshot.world.resources.food = clamp(snapshot.world.resources.food + 1, 0, 99);
    agent.lastThought = `${agent.name} measures the day by what can actually be carried home.`;
    events.push(
      createEvent(
        snapshot,
        "gather",
        `${agent.name} picked up supplies near the ${locationLabels[agent.currentLocationId]}.`,
        agent.currentLocationId,
      ),
    );
    return;
  }

  if (agent.currentLocationId === "clinic") {
    if (snapshot.world.resources.medicine > 0) {
      snapshot.world.resources.medicine = clamp(snapshot.world.resources.medicine - 1, 0, 99);
      agent.inventory.medicine += 1;
    }
    if (agent.inventory.medicine > 0) {
      agent.inventory.medicine -= 1;
      agent.life = clamp(agent.life + 18, 0, 100);
      agent.energy = clamp(agent.energy + 10, 0, 100);
      agent.currentAction = "heal";
      events.push(createEvent(snapshot, "heal", `${agent.name} got treated at the clinic and looked steadier.`, agent.currentLocationId));
    }
    return;
  }

  if (agent.currentLocationId === "archive" || agent.currentLocationId === "shrine") {
    agent.needs.meaning = clamp(agent.needs.meaning - 10);
    agent.currentAction = "reflect";
    agent.lastThought = `${agent.name} lets the place rearrange an old thought.`;
    events.push(
      createEvent(
        snapshot,
        "reflection",
        `${agent.name} fell into reflection near the ${locationLabels[agent.currentLocationId]}.`,
        agent.currentLocationId,
      ),
    );
  }
}

function applyRestState(agent: AgentState, snapshot: WorldSnapshot, events: SimEvent[]) {
  if (
    agent.currentLocationId === "hut_reed" ||
    agent.currentLocationId === "hut_loom" ||
    agent.currentLocationId === "hut_clerk" ||
    agent.currentLocationId === "hut_witness"
  ) {
    agent.needs.fatigue = clamp(agent.needs.fatigue - 8);
    agent.energy = clamp(agent.energy + 10, 0, 100);
    agent.life = clamp(agent.life + 2, 0, 100);
    if (agent.currentAction === "wait") {
      agent.currentAction = "rest";
      events.push(createEvent(snapshot, "rest", `${agent.name} rested for a quiet moment.`, agent.currentLocationId));
    }
  }
}

function maybeHandleEconomy(agent: AgentState, snapshot: WorldSnapshot, events: SimEvent[]) {
  if (agent.inventory.food > 0 && (agent.needs.hunger > 56 || agent.energy < 40)) {
    agent.inventory.food -= 1;
    agent.needs.hunger = clamp(agent.needs.hunger - 28);
    agent.energy = clamp(agent.energy + 12);
    agent.life = clamp(agent.life + 4);
    agent.currentAction = "eat";
    events.push(createEvent(snapshot, "eat", `${agent.name} ate something and looked steadier.`, agent.currentLocationId));
    return;
  }

  if (agent.currentLocationId === "store" && agent.money >= snapshot.world.market.foodPrice && agent.inventory.food < 2 && snapshot.world.resources.food > 0) {
    agent.money -= snapshot.world.market.foodPrice;
    agent.inventory.food += 1;
    snapshot.world.resources.food = clamp(snapshot.world.resources.food - 1, 0, 99);
    agent.currentAction = "buy";
    events.push(createEvent(snapshot, "buy", `${agent.name} bought food for Rs ${snapshot.world.market.foodPrice}.`, agent.currentLocationId));
    return;
  }

  if (agent.currentLocationId === "clinic" && agent.money >= snapshot.world.market.medicinePrice && agent.inventory.medicine < 1 && snapshot.world.resources.medicine > 0) {
    agent.money -= snapshot.world.market.medicinePrice;
    agent.inventory.medicine += 1;
    snapshot.world.resources.medicine = clamp(snapshot.world.resources.medicine - 1, 0, 99);
    agent.currentAction = "buy";
    events.push(createEvent(snapshot, "buy", `${agent.name} paid Rs ${snapshot.world.market.medicinePrice} for medicine.`, agent.currentLocationId));
    return;
  }

  if ((agent.currentLocationId === "square" || agent.currentLocationId === "road") && agent.inventory.goods > 0) {
    agent.inventory.goods -= 1;
    agent.money += snapshot.world.market.goodsPrice;
    agent.currentAction = "sell";
    events.push(createEvent(snapshot, "sell", `${agent.name} sold goods for Rs ${snapshot.world.market.goodsPrice}.`, agent.currentLocationId));
    return;
  }

  if ((agent.currentLocationId === "road" || agent.currentLocationId === "well") && agent.inventory.scraps > 0) {
    const buyer = richestBuyerAround(agent, snapshot.agents);
    if (buyer && buyer.money >= snapshot.world.market.scrapsPrice) {
      agent.inventory.scraps -= 1;
      agent.money += snapshot.world.market.scrapsPrice;
      buyer.money -= snapshot.world.market.scrapsPrice;
      shiftRelationship(agent, buyer.id, 8);
      shiftRelationship(buyer, agent.id, 5);
      agent.currentAction = "sell";
      events.push(createEvent(snapshot, "sell", `${agent.name} sold scraps to ${buyer.name} for Rs ${snapshot.world.market.scrapsPrice}.`, agent.currentLocationId));
    }
  }
}

function maybeHandleFight(agent: AgentState, nearby: AgentState | undefined, snapshot: WorldSnapshot, events: SimEvent[]) {
  if (!nearby || !agent.weapon) return;
  if (relationshipValue(agent, nearby.id) > -48) return;
  if (snapshot.world.tension < 64) return;
  if (Math.random() < 0.7) return;

  const attackPower = weaponPower[agent.weapon] ?? 8;
  const damage = Math.max(4, Math.round(attackPower * (0.4 + Math.random() * 0.6)));

  agent.currentAction = "attack";
  nearby.life = clamp(nearby.life - damage, 0, 100);
  nearby.energy = clamp(nearby.energy - Math.round(damage / 2), 0, 100);
  nearby.lastAttackerId = agent.id;
  nearby.lastDamageTick = snapshot.world.tick;
  nearby.lastDamageSummary = `${agent.name} attacked ${nearby.name} with ${agent.weapon} for ${damage} damage.`;
  shiftRelationship(agent, nearby.id, -22);
  shiftRelationship(nearby, agent.id, -30);
  snapshot.world.tension = clamp(snapshot.world.tension + 8, 0, 100);
  events.push(createEvent(snapshot, "injury", `${agent.name} attacked ${nearby.name} with ${agent.weapon}.`, agent.currentLocationId));
}

function maybeDefendAlly(agent: AgentState, agents: AgentState[], snapshot: WorldSnapshot, events: SimEvent[]) {
  const ally = strongestAlly(agent, agents);
  if (!ally) return;
  if (relationshipValue(agent, ally.id) < 28) return;
  if (ally.life > 44) return;
  if (distance(agent.position, ally.position) > 4) return;

  agent.currentAction = "defend";
  shiftRelationship(agent, ally.id, 10);
  shiftRelationship(ally, agent.id, 12);
  snapshot.world.tension = clamp(snapshot.world.tension - 2, 0, 100);
  events.push(createEvent(snapshot, "group", `${agent.name} stepped in to shield ${ally.name}.`, agent.currentLocationId));
}

function maybeHandleThreat(agent: AgentState, nearby: AgentState | undefined, snapshot: WorldSnapshot, events: SimEvent[]) {
  if (!nearby || !agent.weapon) return;
  if (!nearby.alive) return;
  if (snapshot.world.tension < 54) return;
  if (Math.random() < 0.6) return;

  agent.currentAction = "threaten";
  nearby.energy = clamp(nearby.energy - 6);
  nearby.life = clamp(nearby.life - 4, 0, 100);
  nearby.lastAttackerId = agent.id;
  nearby.lastDamageTick = snapshot.world.tick;
  nearby.lastDamageSummary = `${agent.name} threatened ${nearby.name} with ${agent.weapon}.`;
  shiftRelationship(agent, nearby.id, -16);
  shiftRelationship(nearby, agent.id, -22);
  snapshot.world.tension = clamp(snapshot.world.tension + 5, 0, 100);
  events.push(createEvent(snapshot, "threat", `${agent.name} flashed ${agent.weapon} at ${nearby.name}.`, agent.currentLocationId));
  if (nearby.life < 38) {
    events.push(createEvent(snapshot, "injury", `${nearby.name} was shaken badly and may need the clinic.`, nearby.currentLocationId));
  }
}

function maybeSpreadRumor(agent: AgentState, agents: AgentState[], snapshot: WorldSnapshot, events: SimEvent[]) {
  if (agent.id !== "whisper" || !agent.alive || agent.jailedUntilTick > snapshot.world.tick) return;

  const target = agents.find((other) => other.id !== agent.id && other.alive && distance(agent.position, other.position) <= 3);
  const victim = agents
    .filter((other) => other.id !== agent.id && other.id !== target?.id && other.alive)
    .sort((left, right) => relationshipValue(target ?? agent, left.id) - relationshipValue(target ?? agent, right.id))[0];

  if (!target || !victim || Math.random() < 0.38) return;

  agent.currentAction = "spread-rumor";
  shiftRelationship(target, victim.id, -14);
  shiftRelationship(victim, target.id, -10);
  snapshot.world.tension = clamp(snapshot.world.tension + 4, 0, 100);
  events.push(createEvent(snapshot, "rumor", `${agent.name} whispered poison about ${victim.name} to ${target.name}.`, agent.currentLocationId));

  const thread = threadForAgent(agent, snapshot.chatThreads);
  postThreadMessage(snapshot.chatThreads, thread.id, {
    id: `rumor-${snapshot.world.tick}-${target.id}`,
    tick: snapshot.world.tick,
    kind: "system",
    text: `${agent.name} quietly turns ${target.name} against ${victim.name}.`,
  });
}

function maybeVoteAndJail(snapshot: WorldSnapshot, events: SimEvent[]) {
  if (snapshot.world.tick % 18 !== 0) return;

  const alive = activeAgents(snapshot.agents);
  const candidate = [...alive].sort((left, right) => {
    const leftHostility = alive.reduce((total, other) => total + Math.abs(Math.min(0, relationshipValue(other, left.id))), 0);
    const rightHostility = alive.reduce((total, other) => total + Math.abs(Math.min(0, relationshipValue(other, right.id))), 0);
    return rightHostility - leftHostility;
  })[0];

  if (!candidate) return;

  const votes = alive.filter((agent) => agent.id !== candidate.id && relationshipValue(agent, candidate.id) < -30).length;
  if (votes < Math.max(2, Math.floor(alive.length / 2))) return;

  candidate.jailedUntilTick = snapshot.world.tick + 12;
  candidate.currentLocationId = "jail";
  candidate.currentGoal = "sit in jail and wait out the heat";
  candidate.currentAction = "jailed";
  events.push(createEvent(snapshot, "vote", `${votes} people turned on ${candidate.name} in a rough village vote.`, "square"));
  events.push(createEvent(snapshot, "jail", `${candidate.name} was dragged to jail.`, "jail"));
}

function maybeEliminateAgent(snapshot: WorldSnapshot, events: SimEvent[]) {
  snapshot.agents.forEach((agent) => {
    if (!agent.alive) return;
    if (agent.life > 0) return;

    const attacker = agent.lastAttackerId ? snapshot.agents.find((other) => other.id === agent.lastAttackerId) : null;
    const deathPosition = { ...agent.position };
    const deathLocationId = agent.currentLocationId;
    agent.alive = false;
    agent.currentAction = "gone";
    agent.currentGoal = "their body burns where they fell";
    events.push(
      createEvent(
        snapshot,
        "elimination",
        attacker
          ? `${attacker.name} finished ${agent.name}. ${activeAgents(snapshot.agents).length} remain.`
          : `${agent.name} is out. ${activeAgents(snapshot.agents).length} remain.`,
        deathLocationId,
      ),
    );

    snapshot.deathAftermaths.push({
      id: `death-${snapshot.world.tick}-${agent.id}`,
      agentId: agent.id,
      agentName: agent.name,
      locationId: deathLocationId,
      position: deathPosition,
      startedTick: snapshot.world.tick,
      expiresAtTick: snapshot.world.tick + 12,
      killerId: attacker?.id ?? null,
    });

    snapshot.agents.forEach((other) => {
      if (!other.alive || other.id === agent.id) return;
      if (distance(other.position, deathPosition) > 5) return;
      other.panicUntilTick = Math.max(other.panicUntilTick, snapshot.world.tick + 6);
      other.panicSourcePosition = { ...deathPosition };
      other.currentAction = "flee";
      other.currentGoal = `run from ${agent.name}'s burning body`;
    });

    const thread = threadForAgent(attacker ?? agent, snapshot.chatThreads);
    postThreadMessage(snapshot.chatThreads, thread.id, {
      id: `elim-${snapshot.world.tick}-${agent.id}`,
      tick: snapshot.world.tick,
      kind: "system",
      text: attacker
        ? `${attacker.name} finished ${agent.name}. ${activeAgents(snapshot.agents).length} remain.`
        : `${agent.name} dropped out of the village struggle.`,
    });
  });
}

function maybeDropPickupFromAgent(agent: AgentState, snapshot: WorldSnapshot) {
  if (!agent.alive) {
    if (agent.inventory.food > 0) {
      snapshot.pickups.push({
        id: `drop-food-${snapshot.world.tick}-${agent.id}`,
        position: { ...agent.position },
        kind: "food",
        label: `${agent.name}'s ration`,
      });
      agent.inventory.food = 0;
    }

    if (agent.inventory.medicine > 0) {
      snapshot.pickups.push({
        id: `drop-med-${snapshot.world.tick}-${agent.id}`,
        position: { ...agent.position },
        kind: "medicine",
        label: `${agent.name}'s meds`,
      });
      agent.inventory.medicine = 0;
    }
  }
}

function applyDeathAftermath(snapshot: WorldSnapshot, events: SimEvent[]) {
  snapshot.deathAftermaths = snapshot.deathAftermaths.filter((aftermath) => aftermath.expiresAtTick > snapshot.world.tick);

  snapshot.agents.forEach((agent) => {
    if (!agent.alive) return;
    if (agent.panicUntilTick <= snapshot.world.tick || !agent.panicSourcePosition) {
      if (agent.panicUntilTick <= snapshot.world.tick) {
        agent.panicSourcePosition = null;
      }
      return;
    }

    agent.currentAction = "flee";
    agent.currentGoal = "run from the burning body";
  });

  snapshot.deathAftermaths.forEach((aftermath) => {
    if (snapshot.world.tick === aftermath.startedTick) {
      events.push(createEvent(snapshot, "observation", `${aftermath.agentName}'s body catches fire and people scatter.`, aftermath.locationId));
    }
  });
}

function maybeCollectPickup(agent: AgentState, snapshot: WorldSnapshot, events: SimEvent[]) {
  const pickupIndex = snapshot.pickups.findIndex((pickup) => distance(agent.position, pickup.position) <= 1);
  if (pickupIndex === -1) return;

  const pickup = snapshot.pickups[pickupIndex];

  if (pickup.kind === "food") agent.inventory.food += 1;
  if (pickup.kind === "goods") agent.inventory.goods += 1;
  if (pickup.kind === "scraps") agent.inventory.scraps += 1;
  if (pickup.kind === "medicine") agent.inventory.medicine += 1;
  if (pickup.kind === "weapon" && !agent.weapon) agent.weapon = pickup.label;

  snapshot.pickups.splice(pickupIndex, 1);
  events.push(createEvent(snapshot, "gather", `${agent.name} picked up ${pickup.label}.`, agent.currentLocationId));
}

function applyAdvancedSystems(snapshot: WorldSnapshot, events: SimEvent[]) {
  const occupied = new Set(activeAgents(snapshot.agents).map((agent) => `${agent.position.x}:${agent.position.y}`));

  for (const agentId of AGENT_ORDER) {
    const agent = snapshot.agents.find((entry) => entry.id === agentId);
    if (!agent || !agent.alive) continue;

    occupied.delete(`${agent.position.x}:${agent.position.y}`);
    agent.sceneFocus = agentSceneFocus(agent, snapshot.world);
    const destination = activeDestinationFor(agent, snapshot.agents, snapshot.world);
    const targetPosition = locationPositions[destination];
    const before = { ...agent.position };
    const newPosition = nextStepToward(agent.position, targetPosition, occupied);
    const moved = newPosition.x !== before.x || newPosition.y !== before.y;

    if (moved) {
      agent.position = newPosition;
      agent.currentAction = "walk";
      agent.currentGoal = describeGoal(destination);
       agent.destinationCommitment = Math.max(agent.destinationCommitment - 1, 0);
      occupied.add(`${newPosition.x}:${newPosition.y}`);

      const matchingLocation = (Object.entries(locationPositions).find(
        ([, position]) => distance(position, newPosition) <= 1,
      )?.[0] ?? agent.currentLocationId) as LocationId;
      agent.currentLocationId = matchingLocation;

      events.push(createEvent(snapshot, "movement", `${agent.name} walked toward the ${locationLabels[destination]}.`, agent.currentLocationId));
    } else {
      occupied.add(`${agent.position.x}:${agent.position.y}`);
      agent.destinationCommitment = Math.max(agent.destinationCommitment - 1, 0);
      agent.currentAction = destination === agent.currentLocationId ? "linger" : "wait";
      agent.currentGoal = describeGoal(destination);
    }

    applyLocationState(agent, snapshot, events);
    applyRestState(agent, snapshot, events);
    maybeCollectPickup(agent, snapshot, events);
    maybeHandleEconomy(agent, snapshot, events);

    const partners = nearbyPartners(agent, activeAgents(snapshot.agents));
    const nearby = partners[0];

    if (nearby && agent.speechCooldown === 0 && Math.random() > 0.35) {
      const line = composeSpeech(agent);
      if (!line) {
        maybeHandleThreat(agent, nearby, snapshot, events);
        maybeHandleFight(agent, nearby, snapshot, events);
        maybeDefendAlly(agent, snapshot.agents, snapshot, events);
        maybeSpreadRumor(agent, snapshot.agents, snapshot, events);
        maybeRepairRelationship(agent, nearby);
        agent.mood = pickMood(agent.needs);
        occupied.add(`${agent.position.x}:${agent.position.y}`);
        continue;
      }

      agent.currentAction = "speak";
      agent.speechCooldown = 3;
      agent.needs.social = clamp(agent.needs.social - 14);
      agent.lastThought = `This is the moment to say it before the group changes shape again.`;
      rememberLine(agent, line);
      events.push(createEvent(snapshot, "speech", `${agent.name} to ${nearby.name}: "${line}"`, agent.currentLocationId));

      const thread = threadForAgent(agent, snapshot.chatThreads);
      postThreadMessage(snapshot.chatThreads, thread.id, {
        id: `msg-${snapshot.world.tick}-${agent.id}`,
        tick: snapshot.world.tick,
        kind: "speech",
        authorId: agent.id,
        text: line,
      });

      snapshot.world.tension = clamp(snapshot.world.tension + (agent.id === "hammer" ? 6 : 2), 0, 100);
    }

    maybeHandleThreat(agent, nearby, snapshot, events);
    maybeHandleFight(agent, nearby, snapshot, events);
    maybeDefendAlly(agent, snapshot.agents, snapshot, events);
    maybeSpreadRumor(agent, snapshot.agents, snapshot, events);
    maybeRepairRelationship(agent, nearby);
    agent.mood = pickMood(agent.needs);
  }

  maybeVoteAndJail(snapshot, events);
  maybeEliminateAgent(snapshot, events);
  snapshot.agents.forEach((agent) => maybeDropPickupFromAgent(agent, snapshot));
}

function maybeRepairRelationship(agent: AgentState, nearby: AgentState | undefined) {
  if (!nearby) return;
  if (agent.currentAction !== "speak") return;
  if (Math.random() < 0.6) return;

  if (relationshipValue(agent, nearby.id) < 0) {
    shiftRelationship(agent, nearby.id, 4);
    shiftRelationship(nearby, agent.id, 3);
  } else {
    shiftRelationship(agent, nearby.id, 2);
    shiftRelationship(nearby, agent.id, 2);
  }
}

function maybeCreateSceneMoment(agent: AgentState, nearby: AgentState | undefined, snapshot: WorldSnapshot, events: SimEvent[]) {
  if (!nearby || !agent.alive) return;
  if (distance(agent.position, nearby.position) > 2) return;
  if (Math.random() < 0.72) return;

  if (agent.sceneFocus === "alliance" && relationshipValue(agent, nearby.id) > 18) {
    shiftRelationship(agent, nearby.id, 5);
    shiftRelationship(nearby, agent.id, 5);
    events.push(createEvent(snapshot, "group", `${agent.name} and ${nearby.name} quietly align near the ${locationLabels[agent.currentLocationId]}.`, agent.currentLocationId));
    return;
  }

  if (agent.sceneFocus === "trade" && agent.money > 0 && nearby.inventory.goods > 0 && Math.random() > 0.4) {
    nearby.inventory.goods -= 1;
    agent.inventory.goods += 1;
    agent.money -= 1;
    nearby.money += 1;
    shiftRelationship(agent, nearby.id, 4);
    shiftRelationship(nearby, agent.id, 4);
    events.push(createEvent(snapshot, "sell", `${agent.name} made a small roadside deal with ${nearby.name}.`, agent.currentLocationId));
    return;
  }

  if (agent.sceneFocus === "confrontation" && relationshipValue(agent, nearby.id) < -20) {
    snapshot.world.tension = clamp(snapshot.world.tension + 3, 0, 100);
    events.push(createEvent(snapshot, "group", `${agent.name} and ${nearby.name} squared up in a public confrontation.`, agent.currentLocationId));
  }
}

async function generateDecisionMap(snapshot: WorldSnapshot) {
  const payloads = liveDecisionAgents(snapshot.agents).map((agent) => {
    const thread = threadForAgent(agent, snapshot.chatThreads);
    return createAgentPromptPayload(snapshot, agent, thread ?? null);
  });

  return generateLocalFallbackDecisionMap(payloads);
}

export async function tickSimulationWithDecisions(
  snapshot: WorldSnapshot,
  resolveDecisionBatch: (payloads: AgentPromptPayload[]) => Promise<Map<AgentId, AIDecision>>,
): Promise<WorldSnapshot> {
  const nextTick = snapshot.world.tick + 1;
  const day = 1 + Math.floor(nextTick / 24);
  const timeOfDay = TIME_SEQUENCE[nextTick % TIME_SEQUENCE.length];
  const weather = nextTick % 9 === 0 ? WEATHER_SEQUENCE[(day + nextTick) % WEATHER_SEQUENCE.length] : snapshot.world.weather;
  const temperature = weather === "mist" ? 14 : weather === "rain" ? 16 : weather === "breeze" ? 17 : 21;

  const nextSnapshot: WorldSnapshot = {
    world: {
      tick: nextTick,
      day,
      timeOfDay,
      weather,
      temperature,
      tension: snapshot.world.tension,
      resources: {
        ...snapshot.world.resources,
        fireHeat: clamp(snapshot.world.resources.fireHeat - 1, 0, 10),
        medicine: snapshot.world.resources.medicine,
      },
      market: {
        foodPrice: marketPrice(ITEM_PRICES.food, snapshot.world, snapshot.world.resources.food < 5 ? 2 : 0),
        goodsPrice: marketPrice(ITEM_PRICES.goods, snapshot.world, snapshot.world.tension > 60 ? 2 : 0),
        scrapsPrice: marketPrice(ITEM_PRICES.scraps, snapshot.world, 0),
        medicinePrice: marketPrice(ITEM_PRICES.medicine, snapshot.world, snapshot.world.resources.medicine < 3 ? 2 : 0),
      },
    },
    agents: snapshot.agents.map((agent) => ({
      ...withPanicState(agent, nextTick),
      speechCooldown: Math.max(0, agent.speechCooldown - 1),
      jailedUntilTick: agent.jailedUntilTick > 0 && agent.jailedUntilTick <= nextTick ? 0 : agent.jailedUntilTick,
      destinationCommitment: Math.max(0, agent.destinationCommitment - 1),
      lastDamageSummary: agent.lastDamageTick === nextTick ? agent.lastDamageSummary : null,
      life: clamp(agent.life - (agent.needs.hunger > 82 ? 3 : 0) - (agent.energy < 12 ? 2 : 0), 0, 100),
      energy: clamp(agent.energy - 4, 0, 100),
      needs: {
        hunger: clamp(agent.needs.hunger + 2),
        fatigue: clamp(agent.needs.fatigue + 2),
        warmth: clamp(agent.needs.warmth + (weather === "rain" ? 3 : 1)),
        social: clamp(agent.needs.social + 2),
        meaning: clamp(agent.needs.meaning + 1),
      },
    })),
    recentEvents: [],
    chatThreads: assignThreads(snapshot.agents, nextTick, snapshot.chatThreads),
    pickups: snapshot.pickups.map((pickup) => ({ ...pickup })),
    deathAftermaths: snapshot.deathAftermaths.map((aftermath) => ({ ...aftermath, position: { ...aftermath.position } })),
  };

  const payloads = liveDecisionAgents(nextSnapshot.agents).map((agent) => {
    const thread = threadForAgent(agent, nextSnapshot.chatThreads);
    return createAgentPromptPayload(nextSnapshot, agent, thread ?? null);
  });

  let decisions: Map<AgentId, AIDecision>;

  try {
    decisions = await resolveDecisionBatch(payloads);
  } catch {
    decisions = await generateLocalFallbackDecisionMap(payloads);
  }

  const events: SimEvent[] = [];
  applyDeathAftermath(nextSnapshot, events);
  const occupied = new Set(nextSnapshot.agents.map((agent) => `${agent.position.x}:${agent.position.y}`));

  for (const agentId of AGENT_ORDER) {
    const agent = nextSnapshot.agents.find((entry) => entry.id === agentId);
    if (!agent) continue;
    if (!agent.alive) continue;

    const decision = decisions.get(agent.id);
    occupied.delete(`${agent.position.x}:${agent.position.y}`);

    agent.sceneFocus = agentSceneFocus(agent, nextSnapshot.world);
    const destination = activeDestinationFor(agent, nextSnapshot.agents, nextSnapshot.world, decision);
    const panicStep = agent.panicUntilTick > nextSnapshot.world.tick && agent.panicSourcePosition
      ? nextStepAwayFrom(agent.position, agent.panicSourcePosition, occupied)
      : null;
    const targetPosition = panicStep ?? locationPositions[destination];
    const before = { ...agent.position };
    const newPosition = panicStep ?? nextStepToward(agent.position, targetPosition, occupied);
    const moved = newPosition.x !== before.x || newPosition.y !== before.y;

    if (moved) {
      agent.position = newPosition;
      agent.currentAction = "walk";
      agent.currentGoal = describeGoal(destination);
      agent.destinationCommitment = Math.max(agent.destinationCommitment - 1, 0);
      occupied.add(`${newPosition.x}:${newPosition.y}`);

      const matchingLocation = (Object.entries(locationPositions).find(
        ([, position]) => distance(position, newPosition) <= 1,
      )?.[0] ?? agent.currentLocationId) as LocationId;
      agent.currentLocationId = matchingLocation;

      events.push(
        createEvent(nextSnapshot, "movement", `${agent.name} walked toward the ${locationLabels[destination]}.`, agent.currentLocationId),
      );
    } else {
      occupied.add(`${agent.position.x}:${agent.position.y}`);
      agent.destinationCommitment = Math.max(agent.destinationCommitment - 1, 0);
      agent.currentAction = destination === agent.currentLocationId ? "linger" : "wait";
      agent.currentGoal = describeGoal(destination);
    }

    if (decision?.thought) {
      agent.lastThought = decision.thought;
    }

    if (decision?.action === "rest") {
      agent.currentAction = "rest";
    } else if (decision?.action === "gather") {
      agent.currentAction = "gather";
    } else if (decision?.action === "reflect") {
      agent.currentAction = "reflect";
    }

    applyLocationState(agent, nextSnapshot, events);
    applyRestState(agent, nextSnapshot, events);
    maybeHandleEconomy(agent, nextSnapshot, events);

    const partners = nearbyPartners(agent, activeAgents(nextSnapshot.agents));
    const nearby = partners[0];
    const localThread = threadForAgent(agent, nextSnapshot.chatThreads);
    const clusterSize = localThread?.memberIds.length ?? 0;
    const canSpeak = nearby && agent.speechCooldown === 0;
    const spokenLine = typeof decision?.message === "string" ? decision.message : undefined;
    const shouldSpeak =
      !!canSpeak &&
      (decision?.action === "speak" ||
        clusterSize >= 2 ||
        agent.needs.social > 42 ||
        nextSnapshot.world.tension > 48 ||
        agent.id === "hammer" ||
        agent.sceneFocus === "gossip" ||
        agent.sceneFocus === "confrontation") &&
      Math.random() > 0.2;

    if (canSpeak && shouldSpeak) {
      const line = composeSpeech(agent, spokenLine);
      if (!line) {
        maybeHandleThreat(agent, nearby, nextSnapshot, events);
        maybeHandleFight(agent, nearby, nextSnapshot, events);
        maybeDefendAlly(agent, nextSnapshot.agents, nextSnapshot, events);
        maybeSpreadRumor(agent, nextSnapshot.agents, nextSnapshot, events);
        maybeCreateSceneMoment(agent, nearby, nextSnapshot, events);
        maybeRepairRelationship(agent, nearby);
        agent.mood = pickMood(agent.needs);
        continue;
      }

      agent.currentAction = "speak";
      agent.speechCooldown = 2;
      agent.needs.social = clamp(agent.needs.social - 14);
      agent.lastThought = decision?.thought ?? `${agent.name} decides the silence has gone on too long.`;
      rememberLine(agent, line);
      events.push(createEvent(nextSnapshot, "speech", `${agent.name} to ${nearby.name}: "${line}"`, agent.currentLocationId));

      const thread = threadForAgent(agent, nextSnapshot.chatThreads);
      postThreadMessage(nextSnapshot.chatThreads, thread.id, {
        id: `msg-${nextTick}-${agent.id}`,
        tick: nextTick,
        kind: "speech",
        authorId: agent.id,
        text: line,
      });

      nextSnapshot.world.tension = clamp(nextSnapshot.world.tension + (agent.id === "hammer" || agent.id === "clerk" ? 6 : 2), 0, 100);
    } else if (decision?.action === "reflect" || agent.needs.meaning > 54) {
      agent.currentAction = "think";
      agent.lastThought = decision?.thought ?? `${agent.name} keeps a private sentence turning over.`;
      events.push(createEvent(nextSnapshot, "reflection", `${agent.name} paused to think through an uneasy idea.`, agent.currentLocationId));
    }

    maybeHandleThreat(agent, nearby, nextSnapshot, events);
    maybeHandleFight(agent, nearby, nextSnapshot, events);
    maybeDefendAlly(agent, nextSnapshot.agents, nextSnapshot, events);
    maybeSpreadRumor(agent, nextSnapshot.agents, nextSnapshot, events);
    maybeCreateSceneMoment(agent, nearby, nextSnapshot, events);
    maybeRepairRelationship(agent, nearby);

    agent.mood = pickMood(agent.needs);
  }

  if (nextSnapshot.world.resources.fireHeat < 3) {
    events.push(createEvent(nextSnapshot, "resource_change", "The fire circle is running low and the benches feel cooler.", "fire"));
    nextSnapshot.world.tension = clamp(nextSnapshot.world.tension + 4, 0, 100);
  }

  if (nextSnapshot.world.weather !== snapshot.world.weather) {
    events.push(createEvent(nextSnapshot, "observation", `The weather turns ${nextSnapshot.world.weather} across the village.`, "square"));
  }

  maybeVoteAndJail(nextSnapshot, events);
  maybeEliminateAgent(nextSnapshot, events);

  nextSnapshot.recentEvents = [...events, ...snapshot.recentEvents].slice(0, 32);
  nextSnapshot.chatThreads = assignThreads(nextSnapshot.agents, nextTick, nextSnapshot.chatThreads)
    .sort((left, right) => right.updatedTick - left.updatedTick)
    .slice(0, 5);
  maybeCreateGroupMoment(nextSnapshot, nextSnapshot.chatThreads);

  return nextSnapshot;
}

export function createInitialSnapshot(): WorldSnapshot {
  return {
    world: {
      tick: 0,
      day: 1,
      timeOfDay: "dawn",
      weather: "clear",
      temperature: 18,
      tension: 18,
        resources: {
          food: 9,
          firewood: 6,
          fireHeat: 5,
          medicine: 4,
        },
        market: {
          foodPrice: ITEM_PRICES.food,
          goodsPrice: ITEM_PRICES.goods,
          scrapsPrice: ITEM_PRICES.scraps,
          medicinePrice: ITEM_PRICES.medicine,
        },
      },
    agents: [
      {
        id: "reed",
        name: "Narendra Modi",
        glyph: "R",
        archetype: "dominant, self-certain political heavyweight",
        position: { ...locationPositions.fire },
        currentLocationId: "fire",
        targetLocationId: "square",
        mood: "calm",
        sceneFocus: "confrontation",
        currentGoal: "take over the square conversation",
        currentAction: "wait",
        lastThought: "If I control the tone, I control the room.",
        speechCooldown: 0,
        destinationCommitment: 5,
        recentLines: [],
        lastAttackerId: null,
        lastDamageSummary: null,
        lastDamageTick: -1,
        panicUntilTick: 0,
        panicSourcePosition: null,
        alive: true,
        jailedUntilTick: 0,
        life: 92,
        energy: 76,
        money: 18,
        weapon: starterWeapons.reed,
        inventory: { food: 1, goods: 2, scraps: 0, medicine: 0 },
        relationships: { loom: -18, clerk: -5, hammer: 8, witness: -10 },
        needs: { hunger: 24, fatigue: 26, warmth: 20, social: 38, meaning: 56 },
      },
      {
        id: "loom",
        name: "Rahul Gandhi",
        glyph: "L",
        archetype: "soft-spoken rival trying to stay decent in chaos",
        position: { x: locationPositions.garden.x + 1, y: locationPositions.garden.y },
        currentLocationId: "garden",
        targetLocationId: "garden",
        mood: "calm",
        sceneFocus: "alliance",
        currentGoal: "push back without becoming the loudest voice",
        currentAction: "wait",
        lastThought: "Maybe calm words still matter, even in this circus.",
        speechCooldown: 0,
        destinationCommitment: 4,
        recentLines: [],
        lastAttackerId: null,
        lastDamageSummary: null,
        lastDamageTick: -1,
        panicUntilTick: 0,
        panicSourcePosition: null,
        alive: true,
        jailedUntilTick: 0,
        life: 88,
        energy: 70,
        money: 11,
        weapon: starterWeapons.loom,
        inventory: { food: 1, goods: 1, scraps: 0, medicine: 0 },
        relationships: { reed: -16, clerk: 10, hammer: 7, witness: 5 },
        needs: { hunger: 28, fatigue: 18, warmth: 20, social: 18, meaning: 32 },
      },
      {
        id: "clerk",
        name: "Mahesh",
        glyph: "C",
        archetype: "foul-mouthed chaos engine with zero patience",
        position: { x: locationPositions.archive.x + 1, y: locationPositions.archive.y },
        currentLocationId: "archive",
        targetLocationId: "road",
        mood: "uneasy",
        sceneFocus: "reflection",
        currentGoal: "abuse both sides and stir the pot",
        currentAction: "wait",
        lastThought: "One clean insult can do more than ten fake speeches.",
        speechCooldown: 0,
        destinationCommitment: 5,
        recentLines: [],
        lastAttackerId: null,
        lastDamageSummary: null,
        lastDamageTick: -1,
        panicUntilTick: 0,
        panicSourcePosition: null,
        alive: true,
        jailedUntilTick: 0,
        life: 84,
        energy: 67,
        money: 7,
        weapon: starterWeapons.clerk,
        inventory: { food: 2, goods: 0, scraps: 1, medicine: 0 },
        relationships: { reed: -12, loom: 14, hammer: 18, witness: 2 },
        needs: { hunger: 22, fatigue: 30, warmth: 26, social: 20, meaning: 48 },
      },
      {
        id: "hammer",
        name: "Mola",
        glyph: "H",
        archetype: "cool artist girlfriend who sees the comedy in everybody",
        position: { x: locationPositions.square.x + 1, y: locationPositions.square.y },
        currentLocationId: "square",
        targetLocationId: "fire",
        mood: "resolute",
        sceneFocus: "gossip",
        currentGoal: "keep the vibe alive while roasting the nonsense",
        currentAction: "wait",
        lastThought: "This mess is toxic, funny, and weirdly inspiring.",
        speechCooldown: 0,
        destinationCommitment: 4,
        recentLines: [],
        lastAttackerId: null,
        lastDamageSummary: null,
        lastDamageTick: -1,
        panicUntilTick: 0,
        panicSourcePosition: null,
        alive: true,
        jailedUntilTick: 0,
        life: 90,
        energy: 81,
        money: 14,
        weapon: starterWeapons.hammer,
        inventory: { food: 1, goods: 3, scraps: 0, medicine: 1 },
        relationships: { reed: 10, loom: 9, clerk: 21, witness: 6 },
        needs: { hunger: 30, fatigue: 14, warmth: 22, social: 34, meaning: 42 },
      },
      {
        id: "witness",
        name: "The Beggar",
        glyph: "W",
        archetype: "streetwise survivor who reads everyone instantly",
        position: { x: locationPositions.fire.x - 1, y: locationPositions.fire.y },
        currentLocationId: "fire",
        targetLocationId: "store",
        mood: "calm",
        sceneFocus: "survival",
        currentGoal: "stay fed, stay sharp, and watch the rich self-destruct",
        currentAction: "wait",
        lastThought: "People with power are always loudest when they are least sure.",
        speechCooldown: 0,
        destinationCommitment: 6,
        recentLines: [],
        lastAttackerId: null,
        lastDamageSummary: null,
        lastDamageTick: -1,
        panicUntilTick: 0,
        panicSourcePosition: null,
        alive: true,
        jailedUntilTick: 0,
        life: 74,
        energy: 52,
        money: 2,
        weapon: starterWeapons.witness,
        inventory: { food: 0, goods: 0, scraps: 3, medicine: 0 },
        relationships: { reed: -14, loom: 6, clerk: 5, hammer: 4 },
        needs: { hunger: 18, fatigue: 22, warmth: 18, social: 16, meaning: 26 },
      },
      {
        id: "whisper",
        name: "Whisper",
        glyph: "Q",
        archetype: "rumor broker who privately bends loyalties and starts fires between people",
        position: { x: locationPositions.well.x + 1, y: locationPositions.well.y + 1 },
        currentLocationId: "well",
        targetLocationId: "road",
        mood: "curious",
        sceneFocus: "gossip",
        currentGoal: "spread poison softly and profit from the fallout",
        currentAction: "wait",
        lastThought: "Truth is slow. Rumor runs on its own legs.",
        speechCooldown: 0,
        destinationCommitment: 5,
        recentLines: [],
        lastAttackerId: null,
        lastDamageSummary: null,
        lastDamageTick: -1,
        panicUntilTick: 0,
        panicSourcePosition: null,
        alive: true,
        jailedUntilTick: 0,
        life: 82,
        energy: 78,
        money: 9,
        weapon: null,
        inventory: { food: 1, goods: 1, scraps: 0, medicine: 0 },
        relationships: { reed: -4, loom: -2, clerk: -6, hammer: 3, witness: -8 },
        needs: { hunger: 20, fatigue: 18, warmth: 20, social: 64, meaning: 54 },
      },
    ],
    recentEvents: [
      {
        id: "initial-0",
        tick: 0,
        type: "observation",
        locationId: "square",
        summary: "The village wakes under pale morning light.",
      },
    ],
    chatThreads: createInitialThreads(),
    pickups: createInitialPickups(),
    deathAftermaths: [],
  };
}

export function tickSimulation(snapshot: WorldSnapshot): WorldSnapshot {
  const nextTick = snapshot.world.tick + 1;
  const day = 1 + Math.floor(nextTick / 24);
  const timeOfDay = TIME_SEQUENCE[nextTick % TIME_SEQUENCE.length];
  const weather = nextTick % 9 === 0 ? WEATHER_SEQUENCE[(day + nextTick) % WEATHER_SEQUENCE.length] : snapshot.world.weather;
  const temperature = weather === "mist" ? 14 : weather === "rain" ? 16 : weather === "breeze" ? 17 : 21;

  const nextSnapshot: WorldSnapshot = {
    world: {
      tick: nextTick,
      day,
      timeOfDay,
      weather,
      temperature,
      tension: snapshot.world.tension,
      resources: {
        ...snapshot.world.resources,
        fireHeat: clamp(snapshot.world.resources.fireHeat - 1, 0, 10),
      },
      market: {
        foodPrice: marketPrice(ITEM_PRICES.food, snapshot.world, snapshot.world.resources.food < 5 ? 2 : 0),
        goodsPrice: marketPrice(ITEM_PRICES.goods, snapshot.world, snapshot.world.tension > 60 ? 2 : 0),
        scrapsPrice: marketPrice(ITEM_PRICES.scraps, snapshot.world, 0),
        medicinePrice: marketPrice(ITEM_PRICES.medicine, snapshot.world, snapshot.world.resources.medicine < 3 ? 2 : 0),
      },
    },
    agents: snapshot.agents.map((agent) => ({
      ...withPanicState(agent, nextTick),
      speechCooldown: Math.max(0, agent.speechCooldown - 1),
      destinationCommitment: Math.max(0, agent.destinationCommitment - 1),
      needs: {
        hunger: clamp(agent.needs.hunger + 2),
        fatigue: clamp(agent.needs.fatigue + 2),
        warmth: clamp(agent.needs.warmth + (weather === "rain" ? 3 : 1)),
        social: clamp(agent.needs.social + 2),
        meaning: clamp(agent.needs.meaning + 1),
      },
    })),
    recentEvents: [],
    chatThreads: assignThreads(snapshot.agents, nextTick, snapshot.chatThreads),
    pickups: snapshot.pickups.map((pickup) => ({ ...pickup })),
    deathAftermaths: snapshot.deathAftermaths.map((aftermath) => ({ ...aftermath, position: { ...aftermath.position } })),
  };

  const events: SimEvent[] = [];
  applyDeathAftermath(nextSnapshot, events);
  applyAdvancedSystems(nextSnapshot, events);

  if (nextSnapshot.world.resources.fireHeat < 3) {
    events.push(createEvent(nextSnapshot, "resource_change", "The fire circle is running low and the benches feel cooler.", "fire"));
    nextSnapshot.world.tension = clamp(nextSnapshot.world.tension + 4, 0, 100);
  }

  if (nextSnapshot.world.weather !== snapshot.world.weather) {
    events.push(createEvent(nextSnapshot, "observation", `The weather turns ${nextSnapshot.world.weather} across the village.`, "square"));
  }

  nextSnapshot.recentEvents = [...events, ...snapshot.recentEvents].slice(0, 32);
  nextSnapshot.chatThreads = assignThreads(nextSnapshot.agents, nextTick, nextSnapshot.chatThreads)
    .sort((left, right) => right.updatedTick - left.updatedTick)
    .slice(0, 5);
  return nextSnapshot;
}
