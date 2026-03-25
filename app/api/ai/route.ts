import { NextResponse } from "next/server";
import { aiDecisionMapSchema, aiDecisionSchema, generateLocalFallbackDecision, generateLocalFallbackDecisionMap, type AgentPromptPayload, type BatchAgentPromptPayload } from "@/lib/ai";

const ALLOWED_LOCATIONS = new Set([
  "shrine",
  "garden",
  "archive",
  "square",
  "clinic",
  "jail",
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

function extractJsonObject(input: string) {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain a JSON object.");
  }

  return input.slice(start, end + 1);
}

function normalizeDecisionShape(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw;

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.action === "string") {
    return candidate;
  }

  if (candidate.action && typeof candidate.action === "object") {
    const nested = candidate.action as Record<string, unknown>;
    const nestedType = typeof nested.type === "string" ? nested.type : undefined;
    const fromLocationId = typeof nested.fromLocationId === "string" ? nested.fromLocationId : undefined;
    const toLocationId = typeof nested.toLocationId === "string" ? nested.toLocationId : undefined;
    const details = typeof nested.details === "string" ? nested.details : undefined;

    const mappedAction =
      nestedType === "move"
        ? "walk"
        : nestedType === "talk"
          ? "speak"
          : nestedType === "think"
            ? "reflect"
            : nestedType === "rest"
              ? "rest"
              : nestedType === "gather"
                ? "gather"
                : nestedType === "wait"
                  ? "wait"
                  : undefined;

    const targetLocationId = [toLocationId, fromLocationId].find(
      (locationId): locationId is string => typeof locationId === "string" && ALLOWED_LOCATIONS.has(locationId),
    );

    return {
      action: mappedAction ?? "wait",
      targetLocationId,
      message: mappedAction === "speak" ? details : undefined,
      thought: details ?? "The village keeps moving even when the words fail.",
    };
  }

  return candidate;
}

function normalizeDecisionMapShape(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw;

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([agentId, decision]) => [agentId, normalizeDecisionShape(decision)]),
  );
}

async function requestMistralDecision(payload: AgentPromptPayload) {
  const apiKey = process.env.MISTRAL_API_KEY;

  if (!apiKey) {
    throw new Error("Missing MISTRAL_API_KEY for ai mode.");
  }

  const system = [
    "You are controlling one autonomous character in a chaotic social village sim.",
    "Choose one grounded action.",
    "Return strict JSON only.",
    "Do not invent locations outside the allowed schema.",
    "If action is speak, write a fresh in-character line for this exact moment instead of a generic or repeated line.",
    "Do not repeat recent lines already present in the payload unless absolutely necessary.",
    "Keep messages short and in-character.",
    "Use Hinglish or English.",
    "Conflict, friendship, insults, gossip, and alliances are welcome, but avoid slurs about protected traits.",
    'Return exactly this shape: {"action":"walk|speak|gather|reflect|rest|wait","targetLocationId":"optional_allowed_location","message":"optional_short_line","thought":"required_short_thought"}.',
  ].join(" ");

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL ?? "mistral-small-latest",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Mistral request failed.");
  }

  const json = await response.json();
  return json?.choices?.[0]?.message?.content;
}

async function requestMistralDecisionBatch(payload: BatchAgentPromptPayload) {
  const apiKey = process.env.MISTRAL_API_KEY;

  if (!apiKey) {
    throw new Error("Missing MISTRAL_API_KEY for ai mode.");
  }

  const system = [
    "You are controlling multiple autonomous characters in a chaotic social village sim.",
    "Return one grounded decision per character.",
    "Return strict JSON only as an object keyed by agent id.",
    "Do not invent locations outside the allowed schema.",
    "If an action is speak, write a fresh in-character line for that exact moment instead of a generic or repeated line.",
    "Do not repeat recent lines already present in the payload unless absolutely necessary.",
    "Keep messages short and in-character.",
    "Use Hinglish or English.",
    "Conflict, friendship, insults, gossip, and alliances are welcome, but avoid slurs about protected traits.",
    'Each value must match this shape: {"action":"walk|speak|gather|reflect|rest|wait","targetLocationId":"optional_allowed_location","message":"optional_short_line","thought":"required_short_thought"}.',
  ].join(" ");

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL ?? "mistral-small-latest",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Mistral batch request failed.");
  }

  const json = await response.json();
  return json?.choices?.[0]?.message?.content;
}

async function requestGeminiDecision(payload: AgentPromptPayload) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY for ai mode.");
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview";
  const system = [
    "You are controlling one autonomous character in a chaotic social village sim.",
    "Choose one grounded action.",
    "Return strict JSON only.",
    "Do not invent locations outside the allowed schema.",
    "If action is speak, write a fresh in-character line for this exact moment instead of a generic or repeated line.",
    "Do not repeat recent lines already present in the payload unless absolutely necessary.",
    "Keep messages short and in-character.",
    "Use Hinglish or English.",
    "Conflict, friendship, insults, gossip, and alliances are welcome, but avoid slurs about protected traits.",
    'Return exactly this shape: {"action":"walk|speak|gather|reflect|rest|wait","targetLocationId":"optional_allowed_location","message":"optional_short_line","thought":"required_short_thought"}.',
  ].join(" ");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.8,
          responseMimeType: "application/json",
        },
        systemInstruction: {
          parts: [{ text: system }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(payload) }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Gemini request failed.");
  }

  const json = await response.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function requestGeminiDecisionBatch(payload: BatchAgentPromptPayload) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY for ai mode.");
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview";
  const system = [
    "You are controlling multiple autonomous characters in a chaotic social village sim.",
    "Return one grounded decision per character.",
    "Return strict JSON only as an object keyed by agent id.",
    "Do not invent locations outside the allowed schema.",
    "If an action is speak, write a fresh in-character line for that exact moment instead of a generic or repeated line.",
    "Do not repeat recent lines already present in the payload unless absolutely necessary.",
    "Keep messages short and in-character.",
    "Use Hinglish or English.",
    "Conflict, friendship, insults, gossip, and alliances are welcome, but avoid slurs about protected traits.",
    'Each value must match this shape: {"action":"walk|speak|gather|reflect|rest|wait","targetLocationId":"optional_allowed_location","message":"optional_short_line","thought":"required_short_thought"}.',
  ].join(" ");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.8,
          responseMimeType: "application/json",
        },
        systemInstruction: {
          parts: [{ text: system }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(payload) }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Gemini batch request failed.");
  }

  const json = await response.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as AgentPromptPayload | BatchAgentPromptPayload;

  const hasAiProviderKey = Boolean(process.env.MISTRAL_API_KEY || process.env.GEMINI_API_KEY);
  const mode = process.env.AGENT_MODE ?? (hasAiProviderKey ? "ai" : "local");

  const isBatch = Array.isArray((payload as BatchAgentPromptPayload).agents);

  if (mode !== "ai") {
    if (isBatch) {
      const decisions = await generateLocalFallbackDecisionMap((payload as BatchAgentPromptPayload).agents);
      return NextResponse.json({ mode: "local", decisions: Object.fromEntries(decisions) });
    }

    const decision = await generateLocalFallbackDecision(payload as AgentPromptPayload);
    return NextResponse.json({ mode: "local", decision });
  }

  try {
    const provider = process.env.AI_PROVIDER ?? (process.env.GEMINI_API_KEY ? "gemini" : "mistral");
    if (isBatch) {
      const batchPayload = payload as BatchAgentPromptPayload;
      const content = provider === "gemini" ? await requestGeminiDecisionBatch(batchPayload) : await requestMistralDecisionBatch(batchPayload);
      const parsedContent = normalizeDecisionMapShape(typeof content === "string" ? JSON.parse(extractJsonObject(content)) : content);
      const parsed = aiDecisionMapSchema.safeParse(parsedContent);

      if (!parsed.success) {
        const decisions = await generateLocalFallbackDecisionMap(batchPayload.agents);
        return NextResponse.json({ mode: "fallback", provider, error: "Invalid AI decision map shape", decisions: Object.fromEntries(decisions) });
      }

      return NextResponse.json({ mode: "ai", provider, decisions: parsed.data });
    }

    const content = provider === "gemini" ? await requestGeminiDecision(payload as AgentPromptPayload) : await requestMistralDecision(payload as AgentPromptPayload);
    const parsedContent = normalizeDecisionShape(typeof content === "string" ? JSON.parse(extractJsonObject(content)) : content);
    const parsed = aiDecisionSchema.safeParse(parsedContent);

    if (!parsed.success) {
      const decision = await generateLocalFallbackDecision(payload as AgentPromptPayload);
      return NextResponse.json({ mode: "fallback", provider, error: "Invalid AI decision shape", decision });
    }

    return NextResponse.json({ mode: "ai", provider, decision: parsed.data });
  } catch (error) {
    if (isBatch) {
      const decisions = await generateLocalFallbackDecisionMap((payload as BatchAgentPromptPayload).agents);
      return NextResponse.json({ mode: "fallback", error: error instanceof Error ? error.message : "AI batch decision request failed.", decisions: Object.fromEntries(decisions) });
    }

    const decision = await generateLocalFallbackDecision(payload as AgentPromptPayload);
    return NextResponse.json({ mode: "fallback", error: error instanceof Error ? error.message : "AI decision request failed.", decision });
  }
}
