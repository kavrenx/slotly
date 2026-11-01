import type { MatchExtended, ZxcvbnFactory } from "@zxcvbn-ts/core";
import { identity } from "../../i18n/messages/ru/identity";
import { hasAllowedPasswordCharacters } from "./validation";

let scorer: Promise<ZxcvbnFactory> | undefined;
function loadScorer() {
  scorer ??= Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
    import("@zxcvbn-ts/language-ru"),
  ]).then(([core, common, en, ru]) => new core.ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...en.dictionary, ...ru.dictionary },
    graphs: common.adjacencyGraphs,
    translations: ru.translations,
  })).catch((error: unknown) => { scorer = undefined; throw error; });
  return scorer;
}

// The base estimator can overrate concatenations of simple patterns. Count their
// union, including overlaps its optimal match sequence may have discarded.
// This only lowers the advisory score; it is not a password composition rule.
function predictablePositions(password: string, matches: MatchExtended[]) {
  const covered = new Array<boolean>(password.length).fill(false);
  const mark = (start: number, end: number) => covered.fill(true, start, end);
  for (const match of matches) {
    const cheap = typeof match.guesses === "number" && match.guesses <= 1_000;
    if (match.pattern === "sequence"
      || (match.pattern === "repeat" && typeof match.baseGuesses === "number" && match.baseGuesses <= 1_000)
      || (match.pattern === "spatial" && cheap)
      || (match.pattern === "dictionary" && match.dictionaryName === "passwords-common" && cheap)) {
      mark(match.i, match.j + 1);
    }
  }

  const input = password.toLowerCase();
  const rows = ["01234567890123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  for (let start = 0; start < input.length; start++) {
    // Include descending runs and 7890 wraparound. Three-character runs count,
    // but only a high total coverage can lower the final score.
    for (const row of rows) {
      for (const direction of [row, [...row].reverse().join("")]) {
        for (let end = start + 3; end <= input.length; end++) {
          if (!direction.includes(input.slice(start, end))) break;
          mark(start, end);
        }
      }
    }
    // Short repeated units, including runs of one character. Do not penalize a
    // repeated long random block as though the block itself were easy to guess.
    for (let size = 1; size <= 4; size++) {
      const unit = input.slice(start, start + size);
      let end = start + size;
      while (end + size <= input.length && input.slice(end, end + size) === unit) end += size;
      if (end - start >= Math.max(4, size * 2)) mark(start, end);
    }
  }
  return covered;
}

// Conservative UI bands for the estimator's guess count, not crack-time claims.
// In particular, 10–12 arbitrary digits must not fill all four segments.
function scoreForGuesses(guessesLog10: number) {
  if (guessesLog10 < 6) return 0;
  if (guessesLog10 < 8) return 1;
  if (guessesLog10 < 12) return 2;
  if (guessesLog10 < 16) return 3;
  return 4;
}

// Advisory only. Never sends or stores passwords; dictionaries load on demand.
export async function assessPassword(password: string) {
  if (password.length < 10 || password.length > 128 || !hasAllowedPasswordCharacters(password)) return { score: 0, warning: "" };
  const estimator = await loadScorer();
  const inputs = ["slotly", "слотли"];
  const result = estimator.check(password, inputs);
  const baseScore = Math.min(result.score, scoreForGuesses(result.guessesLog10));
  const covered = predictablePositions(password, result.sequence);
  const dominated = covered.filter(Boolean).length >= password.length / 2;
  let limit = 4;
  if (dominated) {
    // Reassess the remaining material instead of rewarding a predictable prefix,
    // suffix or middle section. Its length must not multiply the guess estimate.
    const remainder = [...password].filter((_, index) => !covered[index]).join("");
    const residual = estimator.check(remainder, inputs);
    limit = Math.max(1, Math.min(residual.score, scoreForGuesses(residual.guessesLog10)));
  }
  const score = Math.min(baseScore, limit);
  const warning = dominated && score < result.score ? identity.passwordFeedback.predictable
    : result.feedback.warning ?? (score <= 1 ? identity.passwordFeedback.weak : "");
  return { score, warning };
}
