import type { AgentId, AgentState, ChatThread, SimEvent, VillageSummary } from "@/lib/types";

interface AgentPanelProps {
  agents: AgentState[];
  threads: ChatThread[];
  recentEvents: SimEvent[];
  villageSummary: VillageSummary;
  selectedAgentId: AgentId | null;
  selectedAgent: AgentState | null;
  onSelectAgent: (agentId: AgentId | null) => void;
}

function Meter({ value }: { value: number }) {
  return (
    <div className="meter light-meter">
      <span style={{ width: `${Math.max(6, Math.min(100, value))}%` }} />
    </div>
  );
}

function describePresence(agent: AgentState) {
  if (!agent.alive) return "gone from the game";
  if (agent.jailedUntilTick > 0) return "locked in jail";
  if (agent.currentAction === "speak") return "in a live conversation";
  if (agent.currentAction === "attack") return "in a violent clash";
  if (agent.currentAction === "defend") return "shielding an ally";
  if (agent.currentAction === "threaten") return "making a threat";
  if (agent.currentAction === "heal") return "recovering at the clinic";
  if (agent.currentAction === "buy") return "buying supplies";
  if (agent.currentAction === "sell") return "cutting a deal";
  if (agent.currentAction === "eat") return "trying to recover strength";
  if (agent.currentAction === "spread-rumor") return "poisoning the room quietly";
  if (agent.currentAction === "gather") return "busy with provisions";
  if (agent.currentAction === "reflect") return "turned inward";
  if (agent.currentAction === "rest") return "taking quiet shelter";
  if (agent.currentAction === "walk") return `moving toward ${agent.currentLocationId.replace("_", " ")}`;
  return `lingering near ${agent.currentLocationId.replace("_", " ")}`;
}

function portraitTone(agent: AgentState) {
  const tones: Record<AgentId, string> = {
    reed: "portrait-reed",
    loom: "portrait-loom",
    clerk: "portrait-clerk",
    hammer: "portrait-hammer",
    witness: "portrait-witness",
    whisper: "portrait-clerk",
  };

  return tones[agent.id];
}

function recentLineForAgent(agent: AgentState, threads: ChatThread[]) {
  for (const thread of threads) {
    const message = thread.messages.find((entry) => entry.authorId === agent.id);
    if (message) {
      return { threadTitle: thread.title, text: message.text, tick: message.tick };
    }
  }

  return null;
}

function circleForAgent(agent: AgentState, agents: AgentState[], threads: ChatThread[]) {
  const activeThread = threads.find((thread) => thread.memberIds.includes(agent.id));
  if (!activeThread) return "alone for the moment";

  const others = activeThread.memberIds
    .filter((memberId) => memberId !== agent.id)
    .map((memberId) => agents.find((entry) => entry.id === memberId)?.name.replace("The ", "") ?? memberId);

  if (!others.length) return `holding ${activeThread.title} alone`;
  return `with ${others.join(", ")} in ${activeThread.title}`;
}

function latestMoment(agent: AgentState, events: SimEvent[]) {
  return events.find((event) => event.summary.includes(agent.name));
}

function latestElimination(events: SimEvent[]) {
  return events.find((event) => event.type === "elimination");
}

function relationshipSummary(agent: AgentState, agents: AgentState[]) {
  const entries = Object.entries(agent.relationships)
    .map(([agentId, score]) => ({
      name: agents.find((entry) => entry.id === agentId)?.name ?? agentId,
      score,
    }))
    .sort((left, right) => right.score - left.score);

  const ally = entries[0];
  const enemy = [...entries].sort((left, right) => left.score - right.score)[0];

  return {
    ally: ally ? `${ally.name} (${ally.score > 0 ? "+" : ""}${ally.score})` : "none",
    enemy: enemy ? `${enemy.name} (${enemy.score})` : "none",
  };
}

function aliveCount(agents: AgentState[]) {
  return agents.filter((agent) => agent.alive).length;
}

function jailedCount(agents: AgentState[], tick: number) {
  return agents.filter((agent) => agent.jailedUntilTick > tick).length;
}

function standingLabel(agent: AgentState, tick: number) {
  if (!agent.alive) return "out";
  if (agent.jailedUntilTick > tick) return "jailed";
  return "alive";
}

function currentLeader(agents: AgentState[]) {
  return [...agents]
    .filter((agent) => agent.alive)
    .sort((left, right) => right.money + right.life + right.energy - (left.money + left.life + left.energy))[0];
}

function relationshipMatrix(agents: AgentState[]) {
  const rows = agents.map((agent) => ({
    agent,
    cells: agents.filter((other) => other.id !== agent.id).map((other) => ({
      other,
      score: agent.relationships[other.id] ?? 0,
    })),
  }));

  return rows;
}

export function AgentPanel({ agents, threads, recentEvents, villageSummary, selectedAgentId, selectedAgent, onSelectAgent }: AgentPanelProps) {
  const recentLine = selectedAgent ? recentLineForAgent(selectedAgent, threads) : null;
  const latestEvent = selectedAgent ? latestMoment(selectedAgent, recentEvents) : null;
  const relationshipState = selectedAgent ? relationshipSummary(selectedAgent, agents) : null;
  const latestVote = recentEvents.find((event) => event.type === "vote" || event.type === "jail" || event.type === "elimination");
  const latestKill = latestElimination(recentEvents);
  const leader = currentLeader(agents);
  const matrix = relationshipMatrix(agents);
  const currentTick = recentEvents[0]?.tick ?? 0;

  return (
    <section className="people-shell">
      <div className="hud-label">People</div>

      <div className="village-summary-card">
        <div className="village-summary-head">
          <div>
            <div className="mini-label">What Is Happening</div>
            <div className="summary-headline">{villageSummary.headline}</div>
          </div>
          <div className="summary-stamp">live / 30s</div>
        </div>

        <div className="summary-line strong-line">
          alive {aliveCount(agents)} / jailed {jailedCount(agents, recentEvents[0]?.tick ?? 0)}
        </div>

        {latestKill ? <div className="summary-line critical-line">{latestKill.summary}</div> : null}

        {latestVote ? <div className="summary-line">{latestVote.summary}</div> : null}

        <div className="summary-list">
          {villageSummary.bullets.map((bullet) => (
            <div className="summary-line" key={bullet}>
              {bullet}
            </div>
          ))}
        </div>
      </div>

      <div className="village-summary-card standings-card">
        <div className="village-summary-head">
          <div>
            <div className="mini-label">Endgame Watch</div>
            <div className="summary-headline">{leader ? `${leader.name} is leading right now.` : "Nobody is clearly ahead."}</div>
          </div>
        </div>

        <div className="summary-list">
          {agents.map((agent) => (
            <div className="summary-line standings-line" key={agent.id}>
              <span>{agent.name}</span>
              <span>{standingLabel(agent, currentTick)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="village-summary-card matrix-card">
        <div className="village-summary-head">
          <div>
            <div className="mini-label">Relationship Heatmap</div>
            <div className="summary-headline">Who backs whom, who wants who gone.</div>
          </div>
        </div>

        <div className="matrix-grid">
          {matrix.map((row) => (
            <div className="matrix-row" key={row.agent.id}>
              <div className="matrix-name">{row.agent.name}</div>
              <div className="matrix-cells">
                {row.cells.map((cell) => (
                  <div
                    className={`matrix-cell ${cell.score > 15 ? "ally" : cell.score < -15 ? "enemy" : "neutral"}`}
                    key={`${row.agent.id}-${cell.other.id}`}
                    title={`${row.agent.name} -> ${cell.other.name}: ${cell.score}`}
                  >
                    {cell.other.glyph}
                    <span>{cell.score}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="people-list">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={`person-row ${agent.id === selectedAgentId ? "selected" : ""}`}
            onClick={() => onSelectAgent(agent.id === selectedAgentId ? null : agent.id)}
          >
            <div className="person-left">
              <span className="person-glyph">{agent.glyph}</span>
              <div>
                <div className="person-name">{agent.name.replace("The ", "")}</div>
                <div className="person-meta">{describePresence(agent)}</div>
              </div>
            </div>
            <div className="person-mood">{agent.mood}</div>
          </button>
        ))}
      </div>

      {selectedAgent ? (
        <div className="selected-drawer">
          <div className="selected-drawer-head">
            <div className="selected-intro">
              <div className={`portrait-disc ${portraitTone(selectedAgent)}`}>{selectedAgent.glyph}</div>
              <div>
              <div className="hud-label">Open Card</div>
              <h2>{selectedAgent.name}</h2>
              <p className="subtle">{selectedAgent.archetype}</p>
              </div>
            </div>
            <button className="close-button" onClick={() => onSelectAgent(null)} type="button">
              close
            </button>
          </div>

          <div className="selected-grid">
            <div>
              <div className="mini-label">Presence</div>
              <div className="mini-value">{describePresence(selectedAgent)}</div>
            </div>
            <div>
              <div className="mini-label">Intention</div>
              <div className="mini-value">{selectedAgent.currentGoal}</div>
            </div>
            <div>
              <div className="mini-label">Scene</div>
              <div className="mini-value">near {selectedAgent.currentLocationId.replace("_", " ")}</div>
            </div>
            <div>
              <div className="mini-label">Inner Line</div>
              <div className="mini-value">{selectedAgent.lastThought}</div>
            </div>
            <div>
              <div className="mini-label">Life / Energy</div>
              <div className="mini-value">{selectedAgent.life} / {selectedAgent.energy}</div>
            </div>
            <div>
              <div className="mini-label">Money / Weapon</div>
              <div className="mini-value">Rs {selectedAgent.money} / {selectedAgent.weapon ?? "bare hands"}</div>
            </div>
          </div>

          <div className="agent-context-card">
            <div>
              <div className="mini-label">Circle</div>
              <div className="mini-value">{circleForAgent(selectedAgent, agents, threads)}</div>
            </div>
            <div>
              <div className="mini-label">Latest Spoken Line</div>
              <div className="mini-value emphasized-copy">
                {recentLine
                  ? `"${recentLine.text}" in ${recentLine.threadTitle.toLowerCase()}`
                  : "No one has heard from them yet."}
              </div>
            </div>
            <div>
              <div className="mini-label">Latest Moment</div>
              <div className="mini-value">
                {latestEvent?.summary ?? "No notable movement yet in this cycle."}
              </div>
            </div>
            <div>
              <div className="mini-label">Last Hit</div>
              <div className="mini-value">
                {selectedAgent.lastDamageSummary ?? "No recent violence landed on them."}
              </div>
            </div>
            <div>
              <div className="mini-label">Inventory</div>
              <div className="mini-value">
                food {selectedAgent.inventory.food} / goods {selectedAgent.inventory.goods} / scraps {selectedAgent.inventory.scraps} /
                med {selectedAgent.inventory.medicine}
              </div>
            </div>
            <div>
              <div className="mini-label">Alliance / Enemy</div>
              <div className="mini-value">
                {relationshipState?.ally ?? "none"} / {relationshipState?.enemy ?? "none"}
              </div>
            </div>
          </div>

          <div className="need-stack compact-needs">
            {Object.entries(selectedAgent.needs).map(([key, value]) => (
              <div className="need-row" key={key}>
                <div className="need-head">
                  <span className="mini-label">{key}</span>
                  <span className="mini-value">{value}</span>
                </div>
                <Meter value={value} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="people-placeholder">Click any person to open their card.</div>
      )}
    </section>
  );
}
