import { expect, it } from "vitest";
import { assessPassword } from "./password-strength";

it.each(["Password123!", "aaaaaaaaaaaaaaaaaaaa", "qwertyuiop12345"])("does not reward common patterns with mixed characters", async (password) => {
  expect((await assessPassword(password)).score).toBeLessThanOrEqual(1);
});
it("does not mark a password below the minimum length as strong", async () => {
  expect((await assessPassword("7x@Q9!bV2")).score).toBe(0);
});
it("recognizes a long unpredictable password", async () => {
  expect((await assessPassword("K7!vL2@rQ8#xM5$zN9")).score).toBeGreaterThanOrEqual(3);
});

it.each([
  "12345678900000012123123", // Regression: previously received the maximum score.
  "12345678900000012123123!",
  "!12345678900000012123123",
  "987654321000000321321321",
  "12345678900000012123123Aa!",
  "qwertyuiopasdfghjklzxcvbnm",
  "QWERTYUIOPasdfghjkl123456!",
  "abcdefffff1234567890",
  "abcdabcd0000001234567890",
  "!@#$%^&*()!@#$%^&*()",
])("keeps concatenated predictable patterns weak: %s", async (password) => {
  const result = await assessPassword(password);
  expect(result.score).toBeLessThanOrEqual(1);
  expect(result.warning).toBeTruthy();
});

it.each(["61803792548201639475", "velvet orchard lantern marble", "K7!vL2@rQ8#xM5$zN9"]) (
  "does not require mixed character classes for a high score: %s", async (password) => {
    expect((await assessPassword(password)).score).toBeGreaterThanOrEqual(3);
  },
);

it.each(["200020002000", "01.01.2000", "P@ssw0rd123!", "Slotly2026!"])("recognizes dates and predictable substitutions: %s", async (password) => {
  expect((await assessPassword(password)).score).toBeLessThanOrEqual(2);
});

it("does not score an invalid overlong password", async () => {
  expect((await assessPassword("K7!vL2@rQ8#xM5$zN9".repeat(8))).score).toBe(0);
});

it.each([16, 32, 64, 100])("does not reward padding with %i repeated digits", async (count) => {
  const padding = "1".repeat(count);
  const suffix = "4535436536456";
  for (const password of [padding + suffix, suffix + padding, "453543" + padding + "6536456"]) {
    const result = await assessPassword(password);
    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.warning).toBeTruthy();
  }
}, 15_000); // Three long dictionary analyses can exceed 5 s on a loaded runner.

it.each(["4535436536456", "618037925482", "7925482016"])("does not promote a numeric remainder to strong: %s", async (suffix) => {
  const original = await assessPassword(suffix);
  const padded = await assessPassword("1".repeat(40) + suffix);
  expect(original.score).toBeLessThanOrEqual(3);
  expect(padded.score).toBeLessThanOrEqual(original.score);
});

it.each(["abcd".repeat(12), "qwertyuiop".repeat(4), "1234567890".repeat(4)])(
  "discounts other predictable padding: %s", async (padding) => {
    expect((await assessPassword(padding + "4535436536456")).score).toBeLessThanOrEqual(2);
  },
);

it("preserves strength when the remainder itself is long and unpredictable", async () => {
  expect((await assessPassword("1".repeat(40) + "K7!vL2@rQ8#xM5$zN9")).score).toBe(4);
});
