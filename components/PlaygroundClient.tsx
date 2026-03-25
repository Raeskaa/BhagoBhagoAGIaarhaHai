"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AgentPanel } from "@/components/panels/AgentPanel";
import { EventFeed } from "@/components/panels/EventFeed";
import { WorldHeader } from "@/components/panels/WorldHeader";
import { createInitialSnapshot, tickSimulation, tickSimulationWithDecisions } from "@/lib/sim";
import type { AgentPromptPayload } from "@/lib/ai";
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
  const [leftPanelWidth, setLeftPanelWidth] = useState(460);
  const [isResizing, setIsResizing] = useState(false);
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

    async function requestDecision(payload: AgentPromptPayload) {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("AI decision request failed.");
      }

      const json = await response.json();
      if (!json?.decision) {
        throw new Error("AI decision missing in response.");
      }
      return json.decision;
    }

    let aiFailureCount = 0;

    async function step() {
      if (cancelled) return;

      try {
        const nextSnapshot = await tickSimulationWithDecisions(snapshotRef.current, requestDecision);
        aiFailureCount = 0;
        if (!cancelled) {
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
        }
      } catch {
        aiFailureCount += 1;
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

  useEffect(() => {
    if (!isResizing) return;

    function handlePointerMove(event: PointerEvent) {
      const nextWidth = Math.min(Math.max(event.clientX - 18, 360), 760);
      setLeftPanelWidth(nextWidth);
    }

    function handlePointerUp() {
      setIsResizing(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizing]);

  const selectedAgent = useMemo(
    () => (selectedAgentId ? snapshot.agents.find((agent) => agent.id === selectedAgentId) ?? null : null),
    [selectedAgentId, snapshot.agents],
  );
  const focusedAgentId = selectedAgentId ?? snapshot.agents[0]?.id;
  const shellStyle = {
    "--left-panel-width": `${leftPanelWidth}px`,
  } as CSSProperties;

  return (
    <main className={`app-shell ${isResizing ? "is-resizing" : ""}`} style={shellStyle}>
      <aside className="sidebar sidebar-left">
        <div className="sidebar-header">
          <div>
            <div className="eyebrow">Autonomous Chaos Sandbox</div>
            <h1>Five at the Fire</h1>
          </div>
          <div className="topline-note">{simulationMode} / live rooms / observer view</div>
        </div>

        <EventFeed threads={snapshot.chatThreads} />
      </aside>

      <div
        aria-label="Resize chat panel"
        className="panel-resizer"
        onPointerDown={() => setIsResizing(true)}
        role="separator"
      />

      <section className="main-stage">
        <div className="stage-topbar">
          <WorldHeader snapshot={snapshot} />
        </div>

        <div className="stage-canvas-wrap">
          <GameCanvas
            snapshot={snapshot}
            selectedAgentId={focusedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
        </div>
      </section>

      <aside className="sidebar sidebar-right">
        <AgentPanel
          agents={snapshot.agents}
          threads={snapshot.chatThreads}
          recentEvents={snapshot.recentEvents}
          villageSummary={villageSummary}
          selectedAgentId={selectedAgent?.id ?? null}
          onSelectAgent={setSelectedAgentId}
          selectedAgent={selectedAgent}
        />
      </aside>
    </main>
  );
}
