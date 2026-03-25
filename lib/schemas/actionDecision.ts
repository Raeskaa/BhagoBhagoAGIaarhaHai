import { z } from "zod";

export const agentIdSchema = z.enum(["reed", "loom", "clerk", "hammer", "witness"]);

export const locationIdSchema = z.enum([
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

export const directionSchema = z.enum(["north", "south", "east", "west"]);

export const actionTypeSchema = z.enum([
  "move",
  "speak",
  "gather",
  "tend_fire",
  "eat",
  "rest",
  "observe",
  "approach",
  "avoid",
  "inspect",
  "give",
  "wait",
  "reflect",
]);

export const emotionToneSchema = z.enum([
  "calm",
  "tender",
  "joyful",
  "grieved",
  "irritated",
  "fearful",
  "ashamed",
  "curious",
  "cold",
  "hungry",
  "resolute",
  "contemptuous",
  "uneasy",
]);

export const actionDecisionSchema = z
  .object({
    action: actionTypeSchema,
    targetAgentId: agentIdSchema.optional(),
    targetObjectId: z.string().min(1).max(80).optional(),
    targetLocationId: locationIdSchema.optional(),
    direction: directionSchema.optional(),
    message: z.string().min(1).max(240).optional(),
    reason: z.string().min(1).max(180),
    emotion: emotionToneSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "move" && !value.direction && !value.targetLocationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "move requires direction or targetLocationId",
        path: ["action"],
      });
    }

    if (value.action === "speak" && !value.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "speak requires message",
        path: ["message"],
      });
    }

    if ((value.action === "approach" || value.action === "avoid" || value.action === "give") && !value.targetAgentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} requires targetAgentId`,
        path: ["targetAgentId"],
      });
    }
  });

export type ActionDecision = z.infer<typeof actionDecisionSchema>;
