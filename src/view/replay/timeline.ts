import type {
  Commit,
  HistoryEntry,
  VerdictRecord,
} from "../../../shared/types";

export type Step = {
  key: string;
  at: number;
  kind: "commit" | "code" | "contract";
  files: string[];
  components: string[];
  title: string;
  session?: string;
};

const FILE = "codefile:";

function idsOf(entry: HistoryEntry): string[] {
  return [...entry.added, ...entry.changed, ...entry.removed];
}

function fromCommit(commit: Commit): Step {
  return {
    key: `c:${commit.sha}`,
    at: commit.at,
    kind: "commit",
    files: commit.files,
    components: [],
    title: commit.subject,
  };
}

function fromEntry(entry: HistoryEntry): Step {
  const ids = idsOf(entry);
  const files =
    entry.source === "code"
      ? ids
          .filter((id) => id.startsWith(FILE))
          .map((id) => id.slice(FILE.length))
      : [];
  const components =
    entry.source === "contract"
      ? [...new Set(ids.flatMap((id) => id.split("->")))]
      : [];
  return {
    key: `h:${entry.id}`,
    at: entry.at,
    kind: entry.source,
    files: [...new Set(files)],
    components,
    title: "",
    ...(entry.session === undefined ? {} : { session: entry.session }),
  };
}

export function stepsOf(
  commits: Commit[],
  history: HistoryEntry[],
  since: number,
): Step[] {
  const made = [
    ...[...commits].reverse().map(fromCommit),
    ...[...history].reverse().map(fromEntry),
  ];
  return made
    .filter(
      (step) =>
        step.at >= since &&
        (step.files.length > 0 || step.components.length > 0),
    )
    .sort((a, b) => a.at - b.at);
}

export function isRejected(record: VerdictRecord): boolean {
  return (
    record.verdict.status !== "allowed" && record.verdict.status !== "unknown"
  );
}

export function stepAt(steps: Step[], at: number): number {
  let low = 0;
  let high = steps.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((steps[mid]?.at ?? 0) <= at) low = mid + 1;
    else high = mid;
  }
  return Math.max(0, low - 1);
}

export function verdictsAt(
  steps: Step[],
  records: VerdictRecord[],
  since: number,
): VerdictRecord[][] {
  const held: VerdictRecord[][] = steps.map(() => []);
  for (const record of records) {
    if (record.at < since || steps.length === 0) continue;
    held[stepAt(steps, record.at)]?.push(record);
  }
  for (const list of held) list.sort((a, b) => a.at - b.at);
  return held;
}

export function touchedBefore(steps: Step[], at: number): Set<string> {
  return new Set(steps.slice(0, Math.max(0, at)).flatMap((step) => step.files));
}
