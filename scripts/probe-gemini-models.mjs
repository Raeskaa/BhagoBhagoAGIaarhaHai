import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const cwd = process.cwd();
loadEnvFile(path.join(cwd, ".env.local"));
loadEnvFile(path.join(cwd, ".env.example"));

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("Missing GEMINI_API_KEY in .env.local or environment.");
  process.exit(1);
}

const shortlist = [
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

const allowedActions = new Set(["walk", "speak", "gather", "reflect", "rest", "wait"]);
const allowedLocations = new Set([
  "shrine",
  "garden",
  "archive",
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
]);

function extractJsonCandidate(input) {
  const firstObject = input.indexOf("{");
  const firstArray = input.indexOf("[");
  const start =
    firstObject === -1 ? firstArray : firstArray === -1 ? firstObject : Math.min(firstObject, firstArray);
  const lastObject = input.lastIndexOf("}");
  const lastArray = input.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON payload in model response.");
  }

  return JSON.parse(input.slice(start, end + 1));
}

function validateDecision(decision) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return { ok: false, reason: "decision is not an object" };
  }

  if (!allowedActions.has(decision.action)) {
    return { ok: false, reason: `invalid action: ${String(decision.action)}` };
  }

  if (decision.targetLocationId != null && !allowedLocations.has(decision.targetLocationId)) {
    return { ok: false, reason: `invalid targetLocationId: ${String(decision.targetLocationId)}` };
  }

  if (typeof decision.thought !== "string" || !decision.thought.trim()) {
    return { ok: false, reason: "missing thought" };
  }

  if (decision.message != null && typeof decision.message !== "string") {
    return { ok: false, reason: "message is not a string" };
  }

  return { ok: true };
}

function validateDecisionMap(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "batch payload is not an object" };
  }

  for (const [agentId, decision] of Object.entries(payload)) {
    const validation = validateDecision(decision);
    if (!validation.ok) {
      return { ok: false, reason: `${agentId}: ${validation.reason}` };
    }
  }

  return { ok: true };
}

const singlePayload = {
  snapshot: {
    world: {
      tick: 12,
      day: 1,
      timeOfDay: "dusk",
      weather: "clear",
      temperature: 21,
      tension: 61,
      resources: { food: 8, firewood: 5, fireHeat: 4, medicine: 3 },
      market: { foodPrice: 3, goodsPrice: 5, scrapsPrice: 2, medicinePrice: 6 },
    },
  },
  self: {
    id: "whisper",
    name: "Whisper",
    archetype: "rumor broker",
    mood: "curious",
    currentLocationId: "square",
    currentGoal: "bend loyalties softly",
    lastThought: "Now is the time to tilt the room.",
    sceneFocus: "gossip",
    life: 82,
    energy: 73,
    money: 9,
    weapon: null,
    inventory: { food: 1, goods: 1, scraps: 0, medicine: 0 },
    relationships: { reed: -8, loom: -4, clerk: -12, hammer: 3, witness: -10 },
    needs: { hunger: 24, fatigue: 18, warmth: 20, social: 64, meaning: 55 },
    recentLines: ["I never lie directly. I just place doubt in the right ear."],
  },
  recentEvents: [{ type: "group", summary: "Narendra Modi and Rahul Gandhi squared up in public.", locationId: "square" }],
  thread: {
    title: "Power Adda",
    locationId: "square",
    memberIds: ["reed", "loom", "whisper"],
    messages: [{ tick: 11, kind: "speech", authorId: "reed", text: "Say it clearly if you have a problem." }],
  },
};

const batchPayload = {
  snapshot: singlePayload.snapshot,
  agents: [
    singlePayload,
    {
      ...singlePayload,
      self: {
        ...singlePayload.self,
        id: "reed",
        name: "Narendra Modi",
        archetype: "power broker",
        mood: "provoked",
        currentGoal: "hold the square",
        sceneFocus: "confrontation",
        recentLines: ["If you have numbers, bring them. If not, sit down."],
      },
    },
    {
      ...singlePayload,
      self: {
        ...singlePayload.self,
        id: "loom",
        name: "Rahul Gandhi",
        archetype: "opposition drifter",
        mood: "restless",
        currentGoal: "flip the crowd before night",
        currentLocationId: "fire",
        sceneFocus: "alliance",
        recentLines: ["You keep acting certain because the truth is thin."],
      },
    },
  ],
};

async function fetchModelList() {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const json = await response.json();
  return Array.isArray(json.models) ? json.models : [];
}

async function testModel(model, body, validator) {
  const startedAt = Date.now();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
      },
      systemInstruction: {
        parts: [
          {
              text: Array.isArray(body.agents)
                ? 'Return strict JSON only as an object keyed by agent id. Each value must match this shape: {"action":"walk|speak|gather|reflect|rest|wait","targetLocationId":"optional_allowed_location","message":"optional_short_line","thought":"required_short_thought"}.'
                : 'Return strict JSON only in this shape: {"action":"walk|speak|gather|reflect|rest|wait","targetLocationId":"optional_allowed_location","message":"optional_short_line","thought":"required_short_thought"}.',
            },
          ],
        },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify(body),
            },
          ],
        },
      ],
    }),
  });

  const elapsed = Date.now() - startedAt;
  const text = await response.text();

  if (!response.ok) {
    return { model, ok: false, status: response.status, elapsed, preview: text.slice(0, 180) };
  }

  try {
    const json = JSON.parse(text);
    const candidateText = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJsonCandidate(candidateText);
    const validation = validator(parsed);

    return {
      model,
      ok: true,
      status: response.status,
      elapsed,
      valid: validation.ok,
      reason: validation.ok ? undefined : validation.reason,
      preview: candidateText.slice(0, 180),
    };
  } catch (error) {
    return {
      model,
      ok: true,
      status: response.status,
      elapsed,
      valid: false,
      reason: error instanceof Error ? error.message : "Failed to parse candidate text.",
      preview: text.slice(0, 180),
    };
  }
}

const models = await fetchModelList();
const availableNames = models.map((model) => model.name.replace(/^models\//, ""));
const candidates = shortlist.filter((model) => availableNames.includes(model));

console.log("Available shortlisted Gemini models:");
for (const model of candidates) {
  console.log(`- ${model}`);
}

console.log("\nTesting responses:\n");

for (const model of candidates) {
  const singleResult = await testModel(model, singlePayload, validateDecision);
  console.log(JSON.stringify({ kind: "single", ...singleResult }));

  const batchResultA = await testModel(model, batchPayload, validateDecisionMap);
  console.log(JSON.stringify({ kind: "batch-a", ...batchResultA }));

  const batchResultB = await testModel(model, batchPayload, validateDecisionMap);
  console.log(JSON.stringify({ kind: "batch-b", ...batchResultB }));
}
