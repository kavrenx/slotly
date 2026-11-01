import { z } from "zod";

const minuteRule = (min: number, max: number, step = 1) => z.number().int().min(min).max(max).multipleOf(step);
export const pageState = z.enum(["draft", "published", "paused", "archived"]);
export type PageState = z.infer<typeof pageState>;
export const pageInput = z.strictObject({
  title: z.string().trim().min(1).max(120), description: z.string().trim().max(4000), location: z.string().trim().max(1000),
  durationMinutes: minuteRule(5, 480, 5), stepMinutes: minuteRule(5, 120, 5),
  bufferBeforeMinutes: minuteRule(0, 240, 5), bufferAfterMinutes: minuteRule(0, 240, 5),
  minNoticeMinutes: minuteRule(0, 43200), horizonDays: minuteRule(1, 365),
  cancelCutoffMinutes: minuteRule(0, 43200), rescheduleCutoffMinutes: minuteRule(0, 43200),
});
export const pageUpdate = pageInput.extend({ version: z.number().int().min(1).max(2_147_483_646) });
export const pageStateUpdate = z.strictObject({ version: z.number().int().min(1).max(2_147_483_646), state: pageState });
export const pageDefaults: z.infer<typeof pageInput> = {
  title: "", description: "", location: "", durationMinutes: 30, stepMinutes: 15,
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minNoticeMinutes: 120, horizonDays: 60,
  cancelCutoffMinutes: 120, rescheduleCutoffMinutes: 120,
};
export const stateTransitions: Record<PageState, readonly PageState[]> = {
  draft: ["published", "archived"], published: ["paused", "archived"], paused: ["published", "archived"], archived: [],
};
