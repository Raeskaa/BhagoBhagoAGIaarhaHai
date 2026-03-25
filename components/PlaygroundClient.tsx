"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AgentPanel } from "@/components/panels/AgentPanel";
import { EventFeed } from "@/components/panels/EventFeed";
import { WorldHeader } from "@/components/panels/WorldHeader";
import { createInitialSnapshot, tickSimulation, tickSimulationWithDecisions } from "@/lib/sim";
import type { AIDecision, AgentPromptPayload } from "@/lib/ai";
import type { AgentId, VillageSummary, WorldSnapshot } from "@/lib/types";

const GameCanvas = dynamic(() => import("@/components/game/GameCanvas").then((mod) => mod.GameCanvas), {
  ssr: false,
});

function buildVillageSummary(snapshot: WorldSnapshot): VillageSummary {
  const aliveAgents = snapshot.agents.filter((agent) => agent.alive);
  const jailedAgents = snapshot.agents.filter((agent) => agent.jailedUntilTick > snapshot.world.tick);
  const latestSpeechThread = [...snapshot.chatThreads]
    .sort((left, right) => right.updatedTick - left.updatedTick)
    .find((thread) => thread.messages.some((message) => message.kind === "speech"));

  const hottestThread = [...snapshot.chatThreads].sort((left, right) => right.memberIds.length - left.memberIds.length)[0];
  const restlessAgent = [...snapshot.agents].sort((left, right) => right.needs.social - left.needs.social)[0];
  const hungriestAgent = [...snapshot.agents].sort((left, right) => right.needs.hunger - left.needs.hunger)[0];
  const richestAgent = [...snapshot.agents].sort((left, right) => right.money - left.money)[0];
  const armedAgent = snapshot.agents.find((agent) => agent.weapon);
  const weakestAgent = [...snapshot.agents].sort((left, right) => left.life - right.life)[0];
  const marketPressure = snapshot.world.market.medicinePrice + snapshot.world.market.foodPrice;
  const healingEvent = snapshot.recentEvents.find((event) => event.type === "heal" || event.type === "injury");
  const sharpEvent = snapshot.recentEvents.find(
    (event) => event.type === "speech" || event.type === "group" || event.type === "reflection" || event.type === "rumor" || event.type === "jail",
  );

  const headline =
    snapshot.world.tension > 60
      ? "The village is running hot: egos are colliding and nobody is backing down."
      : snapshot.world.tension > 38
        ? "Small groups are forming, taking sides, and trading barbs across the map."
        : "The village is alive with loose chatter, movement, and simmering alliances.";

  const bullets = [
    latestSpeechThread
      ? `${latestSpeechThread.title} is the loudest room right now, with ${latestSpeechThread.memberIds.length} people circling it.`
      : "No one thread dominates yet; the energy is still scattered.",
    hottestThread
      ? `${hottestThread.title} is attracting the biggest crowd.`
      : "The crowd has not settled around a single hotspot yet.",
    sharpEvent?.summary ?? "There is motion everywhere, but nothing has boiled over in the last few moments.",
    restlessAgent
      ? `${restlessAgent.name} looks most likely to start the next scene.`
      : "Nobody stands out as the next spark yet.",
    hungriestAgent ? `${hungriestAgent.name} is closest to snapping over food or energy.` : "Nobody looks desperate yet.",
    richestAgent ? `${richestAgent.name} is holding the most cash in the village right now.` : "Nobody has built an advantage in money yet.",
    armedAgent ? `${armedAgent.name} is visibly armed, which changes the room.` : "Nobody is openly armed right now.",
    healingEvent?.summary ?? (weakestAgent ? `${weakestAgent.name} looks most at risk if the village gets rougher.` : "Nobody looks physically vulnerable right now."),
    marketPressure > 7 ? `The market is tightening; food and medicine are getting expensive.` : `Trade is still moving without a full squeeze on the village.`,
    jailedAgents.length ? `${jailedAgents.map((agent) => agent.name).join(", ")} ${jailedAgents.length === 1 ? "is" : "are"} in jail.` : `${aliveAgents.length} players are still alive in the village.`,
  ].slice(0, 4);

  return {
    updatedAt: Date.now(),
    headline,
    bullets,
  };
}

export function PlaygroundClient() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(() => createInitialSnapshot());
  const [villageSummary, setVillageSummary] = useState<VillageSummary>(() => {
    const initialSnapshot = createInitialSnapshot();
    return buildVillageSummary(initialSnapshot);
  });
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);
  const [simulationMode] = useState<"local" | "ai-ready">("ai-ready");
  const [aiStatus, setAiStatus] = useState<{ mode: "ai" | "fallback" | "local" | "unknown"; note: string }>({
    mode: "unknown",
    note: "checking",
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);
  const snapshotRef = useRef(snapshot);

  snapshotRef.current = snapshot;

  useEffect(() => {
    setVillageSummary(buildVillageSummary(snapshot));
  }, [snapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setVillageSummary(buildVillageSummary(snapshotRef.current));
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function requestDecisionBatch(payloads: AgentPromptPayload[]) {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snapshot: payloads[0]?.snapshot,
          agents: payloads,
        }),
      });

      if (!response.ok) {
        throw new Error("AI decision batch request failed.");
      }

      const json = await response.json();
      if (!json?.decisions || typeof json.decisions !== "object") {
        throw new Error("AI decision map missing in response.");
      }

      const mode = json?.mode === "ai" || json?.mode === "fallback" || json?.mode === "local" ? json.mode : "unknown";
      const note =
        mode === "ai"
          ? json?.provider ? `${json.provider} live` : "live"
          : mode === "fallback"
            ? json?.error ? `fallback: ${String(json.error).slice(0, 48)}` : "fallback active"
            : mode === "local"
              ? "local mode"
              : "unknown";

      setAiStatus({ mode, note });

      return new Map<AgentId, AIDecision>(Object.entries(json.decisions) as Array<[AgentId, AIDecision]>);
    }

    let aiFailureCount = 0;

    async function step() {
      if (cancelled) return;

      try {
          const nextSnapshot = await tickSimulationWithDecisions(snapshotRef.current, requestDecisionBatch);
        aiFailureCount = 0;
        if (!cancelled) {
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
        }
      } catch (error) {
        aiFailureCount += 1;
        setAiStatus({
          mode: "fallback",
          note: error instanceof Error ? `request failed: ${error.message.slice(0, 40)}` : "request failed",
        });
        const nextSnapshot = tickSimulation(snapshotRef.current);
        if (!cancelled) {
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(step, aiFailureCount > 2 ? 2200 : 1300);
      }
    }

    timer = window.setTimeout(step, 900);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const selectedAgent = useMemo(
    () => (selectedAgentId ? snapshot.agents.find((agent) => agent.id === selectedAgentId) ?? null : null),
    [selectedAgentId, snapshot.agents],
  );
  const focusedAgentId = selectedAgentId ?? snapshot.agents[0]?.id;
  const shellStyle = {} as CSSProperties;

  function handleSelectAgent(agentId: AgentId | null) {
    setSelectedAgentId(agentId);
    if (agentId) {
      setPeopleOpen(true);
    }
  }

  return (
    <main className="game-shell-fullscreen" style={shellStyle}>
      <section className="main-stage full-stage">
        <div className="floating-hud bottom-left-hud">
          <div className="overlay-toggle-row">
            <div className={`ai-status-badge ${aiStatus.mode}`} title={aiStatus.note}>
              <span className="ai-status-dot" />
              <span>{aiStatus.mode === "ai" ? "AI Live" : aiStatus.mode === "fallback" ? "AI Fallback" : aiStatus.mode === "local" ? "Local" : "Checking"}</span>
            </div>
            <button className={`overlay-toggle ${hudOpen ? "active" : ""}`} onClick={() => setHudOpen((open) => !open)} type="button">
              Stats
            </button>
            <button className={`overlay-toggle ${chatOpen ? "active" : ""}`} onClick={() => setChatOpen((open) => !open)} type="button">
              Chat
            </button>
            <button className={`overlay-toggle ${peopleOpen ? "active" : ""}`} onClick={() => setPeopleOpen((open) => !open)} type="button">
              People
            </button>
          </div>
        </div>

        <div className="stage-canvas-wrap full-canvas-wrap">
          <GameCanvas snapshot={snapshot} selectedAgentId={focusedAgentId} onSelectAgent={handleSelectAgent} />
        </div>
      </section>

      <aside className={`overlay-panel overlay-top ${hudOpen ? "open" : ""}`}>
        <div className="overlay-panel-header">
          <div>
            <div className="hud-label">Village Stats</div>
            <div className="overlay-title">Cycle, mood, market, and survival state</div>
          </div>
          <button className="close-button" onClick={() => setHudOpen(false)} type="button">
            close
          </button>
        </div>

        <WorldHeader snapshot={snapshot} />
      </aside>

      <aside className={`overlay-panel overlay-left ${chatOpen ? "open" : ""}`}>
        <div className="overlay-panel-header">
          <div>
            <div className="hud-label">Village Chat</div>
            <div className="overlay-title">Live rooms and scene log</div>
          </div>
          <button className="close-button" onClick={() => setChatOpen(false)} type="button">
            close
          </button>
        </div>

        <EventFeed threads={snapshot.chatThreads} />
      </aside>

      <aside className={`overlay-panel overlay-right ${peopleOpen ? "open" : ""}`}>
        <div className="overlay-panel-header">
          <div>
            <div className="hud-label">People</div>
            <div className="overlay-title">Status, factions, and survival watch</div>
          </div>
          <button className="close-button" onClick={() => setPeopleOpen(false)} type="button">
            close
          </button>
        </div>

        <AgentPanel
          agents={snapshot.agents}
          threads={snapshot.chatThreads}
          recentEvents={snapshot.recentEvents}
          villageSummary={villageSummary}
          selectedAgentId={selectedAgent?.id ?? null}
          onSelectAgent={handleSelectAgent}
          selectedAgent={selectedAgent}
        />
      </aside>
    </main>
  );
}
