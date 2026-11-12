import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchContract } from "./contract";

let dir: string;
let file: string;
let close: () => void = () => {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "architect-watch-"));
  file = path.join(dir, "architect.md");
  fs.writeFileSync(file, "one\n");
});

afterEach(() => {
  close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function watch() {
  const changed = vi.fn();
  close = watchContract(file, changed).close;
  return changed;
}

describe("watchContract", () => {
  it("sees a save made the moment watching starts", async () => {
    const changed = watch();
    fs.writeFileSync(file, "two two\n");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
  });

  it("sees a same size rewrite with its mtime put back", async () => {
    const changed = watch();
    const { atime, mtime } = fs.statSync(file);
    fs.writeFileSync(file, "two\n");
    fs.utimesSync(file, atime, mtime);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
  });

  it("sees a delete and a recreate", async () => {
    const changed = watch();
    fs.rmSync(file);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    fs.writeFileSync(file, "back\n");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
  });

  it("stays quiet while nothing changes", async () => {
    const changed = watch();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(changed).not.toHaveBeenCalled();
  });
});
