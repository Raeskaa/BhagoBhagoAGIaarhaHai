import { NextResponse } from "next/server";
import { aiDecisionSchema, generateLocalFallbackDecision, type AgentPromptPayload } from "@/lib/ai";

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

async function requestGeminiDecision(payload: AgentPromptPayload) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY for ai mode.");
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const system = [
    "You are controlling one autonomous character in a chaotic social village sim.",
    "Choose one grounded action.",
    "Return strict JSON only.",
    "Do not invent locations outside the allowed schema.",
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

export async function POST(request: Request) {
  const payload = (await request.json()) as AgentPromptPayload;

  const mode = process.env.AGENT_MODE ?? "local";

  if (mode !== "ai") {
    const decision = await generateLocalFallbackDecision(payload);
    return NextResponse.json({ mode: "local", decision });
  }

  try {
    const provider = process.env.AI_PROVIDER ?? "mistral";
    const content = provider === "gemini" ? await requestGeminiDecision(payload) : await requestMistralDecision(payload);
    const parsedContent = normalizeDecisionShape(typeof content === "string" ? JSON.parse(extractJsonObject(content)) : content);
    const parsed = aiDecisionSchema.safeParse(parsedContent);

    if (!parsed.success) {
      const decision = await generateLocalFallbackDecision(payload);
      return NextResponse.json({ mode: "fallback", provider, error: "Invalid AI decision shape", decision });
    }

    return NextResponse.json({ mode: "ai", provider, decision: parsed.data });
  } catch (error) {
    const decision = await generateLocalFallbackDecision(payload);
    return NextResponse.json({ mode: "fallback", error: error instanceof Error ? error.message : "AI decision request failed.", decision });
  }
}
