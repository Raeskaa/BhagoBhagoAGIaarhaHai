import { z } from "zod";
import type { AgentId, AgentState, ChatThread, LocationId, SimEvent, WorldSnapshot } from "@/lib/types";

export const aiDecisionSchema = z.object({
  action: z.enum(["walk", "speak", "gather", "reflect", "rest", "wait"]),
  targetLocationId: z.preprocess(
    (value) => (value == null ? undefined : value),
    z
      .enum([
        "shrine",
        "garden",
        "archive",
        "clinic",
        "jail",
        "square",
        "fire",
        "well",
        "store",
        "road",
        "gate",
        "shed",
        "hut_reed",
        "hut_loom",
        "hut_clerk",
        "hut_witness",
      ])
      .optional(),
  ),
  message: z.string().max(220).optional(),
  thought: z.string().max(220),
});

export type AIDecision = z.infer<typeof aiDecisionSchema>;

export const aiDecisionMapSchema = z.record(z.string(), aiDecisionSchema);

export interface AgentPromptPayload {
  snapshot: Pick<WorldSnapshot, "world">;
  self: {
    id: AgentId;
    name: string;
    archetype: string;
    mood: string;
    currentLocationId: LocationId;
    currentGoal: string;
    lastThought: string;
    sceneFocus: string;
    life: number;
    energy: number;
    money: number;
    weapon: string | null;
    inventory: Record<string, number>;
    relationships: Record<string, number>;
    needs: Record<string, number>;
    recentLines: string[];
  };
  recentEvents: Array<Pick<SimEvent, "type" | "summary" | "locationId">>;
  thread: Pick<ChatThread, "title" | "locationId" | "memberIds" | "messages"> | null;
}

export interface BatchAgentPromptPayload {
  snapshot: Pick<WorldSnapshot, "world">;
  agents: AgentPromptPayload[];
}

export function createAgentPromptPayload(snapshot: WorldSnapshot, agent: AgentState, thread: ChatThread | null): AgentPromptPayload {
  return {
    snapshot: {
      world: snapshot.world,
    },
    self: {
      id: agent.id,
      name: agent.name,
      archetype: agent.archetype,
      mood: agent.mood,
      currentLocationId: agent.currentLocationId,
      currentGoal: agent.currentGoal,
      lastThought: agent.lastThought,
      sceneFocus: agent.sceneFocus,
      life: agent.life,
      energy: agent.energy,
      money: agent.money,
      weapon: agent.weapon,
      inventory: { ...agent.inventory },
      relationships: { ...agent.relationships },
      needs: { ...agent.needs },
      recentLines: [...agent.recentLines],
    },
    recentEvents: snapshot.recentEvents.slice(0, 4).map((event) => ({
      type: event.type,
      summary: event.summary,
      locationId: event.locationId,
    })),
    thread: thread
      ? {
          title: thread.title,
          locationId: thread.locationId,
          memberIds: thread.memberIds,
          messages: thread.messages.slice(0, 6),
        }
      : null,
  };
}

export async function generateLocalFallbackDecision(payload: AgentPromptPayload): Promise<AIDecision> {
  const topNeed = Object.entries(payload.self.needs).sort((left, right) => right[1] - left[1])[0]?.[0];

  if (topNeed === "hunger") {
    return {
      action: "gather",
      targetLocationId: payload.self.id === "loom" ? "garden" : "store",
      thought: `${payload.self.name} is done with speeches for a minute and wants something useful done.`,
    };
  }

  if (topNeed === "social" && payload.thread && payload.thread.memberIds.length > 1) {
    return {
      action: "speak",
      message: undefined,
      thought: `${payload.self.name} wants to grab the thread before someone else hijacks it.`,
    };
  }

  return {
    action: "walk",
    targetLocationId: "square",
    thought: `${payload.self.name} keeps moving, scanning for drama, allies, and weak spots.`,
  };
}

export async function generateLocalFallbackDecisionMap(payloads: AgentPromptPayload[]) {
  const entries = await Promise.all(payloads.map(async (payload) => [payload.self.id, await generateLocalFallbackDecision(payload)] as const));
  return new Map(entries);
}
