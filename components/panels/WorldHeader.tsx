import type { WorldSnapshot } from "@/lib/types";

function describeSky(snapshot: WorldSnapshot) {
  if (snapshot.world.weather === "rain") return "soft rain over the roofs";
  if (snapshot.world.weather === "mist") return "mist around the hills";
  if (snapshot.world.weather === "breeze") return "a light breeze through the trees";
  return `${snapshot.world.timeOfDay} with clear light`;
}

function describeFire(snapshot: WorldSnapshot) {
  if (snapshot.world.resources.fireHeat <= 2) return "fire circle fading";
  if (snapshot.world.resources.fireHeat <= 5) return "fire circle needs wood";
  return "fire circle still warm";
}

function describeTown(snapshot: WorldSnapshot, hungerAverage: number) {
  if (snapshot.world.tension > 60) return "conversation turning sharp";
  if (snapshot.world.tension > 40) return "arguments flaring in pockets";
  if (hungerAverage > 55) return "hunger under the surface";
  return "village open and watchful";
}

export function WorldHeader({ snapshot }: { snapshot: WorldSnapshot }) {
  const hungerAverage = Math.round(
    snapshot.agents.reduce((total, agent) => total + agent.needs.hunger, 0) / snapshot.agents.length,
  );
  const totalCash = snapshot.agents.reduce((total, agent) => total + agent.money, 0);
  const weaponsInPlay = snapshot.agents.filter((agent) => agent.weapon).length;
  const medicineStock = snapshot.world.resources.medicine;
  const aliveCount = snapshot.agents.filter((agent) => agent.alive).length;
  const { foodPrice, goodsPrice, scrapsPrice, medicinePrice } = snapshot.world.market;

  return (
    <div className="world-header hud-card light-header">
      <div className="metric-pill">
        <div className="metric-label">Cycle</div>
        <div className="metric-value">day {snapshot.world.day} / {snapshot.world.timeOfDay}</div>
      </div>
      <div className="metric-pill">
        <div className="metric-label">Sky</div>
        <div className="metric-value">{describeSky(snapshot)}</div>
      </div>
      <div className="metric-pill">
        <div className="metric-label">Fire</div>
        <div className="metric-value">{describeFire(snapshot)}</div>
      </div>
      <div className="metric-pill">
        <div className="metric-label">Stores</div>
        <div className="metric-value">food {snapshot.world.resources.food} / meds {medicineStock} / cash Rs {totalCash}</div>
      </div>
      <div className="metric-pill">
        <div className="metric-label">Mood</div>
        <div className="metric-value">{describeTown(snapshot, hungerAverage)} / weapons {weaponsInPlay} / alive {aliveCount}</div>
      </div>
      <div className="metric-pill">
        <div className="metric-label">Market</div>
        <div className="metric-value">food {foodPrice} / goods {goodsPrice} / scraps {scrapsPrice} / med {medicinePrice}</div>
      </div>
      <div className="metric-pill metric-pill-compact">
        <div className="metric-label">Mode</div>
        <div className="metric-value">observer / live sim</div>
      </div>
    </div>
  );
}
