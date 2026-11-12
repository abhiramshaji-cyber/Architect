import { describe, expect, it } from "vitest";
import type {
  Commit,
  HistoryEntry,
  VerdictRecord,
} from "../../../shared/types";
import {
  isRejected,
  stepAt,
  stepsOf,
  touchedBefore,
  verdictsAt,
} from "./timeline";

const commit = (sha: string, at: number, files: string[]): Commit => ({
  sha,
  short: sha,
  at,
  subject: `s ${sha}`,
  files,
});

const entry = (
  id: string,
  at: number,
  source: "code" | "contract",
  changed: string[],
  session?: string,
): HistoryEntry => ({
  id,
  root: "/r",
  at,
  source,
  added: [],
  changed,
  removed: [],
  ...(session === undefined ? {} : { session }),
});

const verdict = (
  id: string,
  at: number,
  status: "allowed" | "forbidden" | "unknown",
): VerdictRecord => ({
  id,
  root: "/r",
  at,
  from: "a",
  to: "b",
  verdict: status === "forbidden" ? { status, reason: "no" } : { status },
});

describe("replay timeline", () => {
  it("merges commits and history entries oldest first", () => {
    const steps = stepsOf(
      [commit("c2", 300, ["b.ts"]), commit("c1", 100, ["a.ts"])],
      [
        entry("h2", 400, "contract", ["ui->core"]),
        entry("h1", 200, "code", ["codefile:a.ts", "folder:src"], "s1"),
      ],
      0,
    );
    expect(
      steps.map((step) => [step.key, step.files, step.components]),
    ).toEqual([
      ["c:c1", ["a.ts"], []],
      ["h:h1", ["a.ts"], []],
      ["c:c2", ["b.ts"], []],
      ["h:h2", [], ["ui", "core"]],
    ]);
    expect(steps[1]?.session).toBe("s1");
  });

  it("keeps a commit before a history entry at the same moment", () => {
    const steps = stepsOf(
      [commit("c", 100, ["a.ts"])],
      [entry("h", 100, "code", ["codefile:a.ts"])],
      0,
    );
    expect(steps.map((step) => step.kind)).toEqual(["commit", "code"]);
  });

  it("drops steps before the window and steps with nothing to light", () => {
    const steps = stepsOf(
      [commit("old", 50, ["a.ts"]), commit("merge", 150, [])],
      [entry("folders", 160, "code", ["folder:src"])],
      100,
    );
    expect(steps).toEqual([]);
  });

  it("treats every verdict but allowed and unknown as rejected", () => {
    expect(
      [
        verdict("a", 1, "allowed"),
        verdict("u", 1, "unknown"),
        verdict("f", 1, "forbidden"),
      ].map(isRejected),
    ).toEqual([false, false, true]);
  });

  it("files each verdict under the last step at or before it", () => {
    const steps = stepsOf(
      [
        commit("c3", 300, ["c.ts"]),
        commit("c2", 200, ["b.ts"]),
        commit("c1", 100, ["a.ts"]),
      ],
      [],
      0,
    );
    expect([
      stepAt(steps, 50),
      stepAt(steps, 100),
      stepAt(steps, 250),
      stepAt(steps, 900),
    ]).toEqual([0, 0, 1, 2]);
    const held = verdictsAt(
      steps,
      [
        verdict("late", 900, "forbidden"),
        verdict("early", 10, "allowed"),
        verdict("gone", -5, "forbidden"),
      ],
      0,
    );
    expect(held.map((list) => list.map((record) => record.id))).toEqual([
      ["early"],
      [],
      ["late"],
    ]);
  });

  it("holds no verdicts when there are no steps", () => {
    expect(verdictsAt([], [verdict("v", 1, "forbidden")], 0)).toEqual([]);
  });

  it("collects the files changed before a step", () => {
    const steps = stepsOf(
      [commit("c2", 200, ["b.ts"]), commit("c1", 100, ["a.ts"])],
      [],
      0,
    );
    expect([...touchedBefore(steps, 0)]).toEqual([]);
    expect([...touchedBefore(steps, 1)]).toEqual(["a.ts"]);
    expect([...touchedBefore(steps, 2)].sort()).toEqual(["a.ts", "b.ts"]);
  });
});
