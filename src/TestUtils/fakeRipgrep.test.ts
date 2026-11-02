import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type IFakeRipgrep, isProcessAlive, writeFakeRipgrep } from "./fakeRipgrep.ts";

describe.skipIf(process.platform === "win32")("writeFakeRipgrep", () => {
    let fake: IFakeRipgrep | null = null;

    afterEach(() => {
        fake?.dispose();
        fake = null;
    });

    function run(rg: IFakeRipgrep, args: string[]): string {
        return execFileSync(rg.path, args, { cwd: path.dirname(rg.path), encoding: "utf8" });
    }

    it("prints the canned lines and records the pid, cwd and args of the run", () => {
        const rg = writeFakeRipgrep({ stdoutLines: ["a.ts", "b.ts"] });
        fake = rg;
        expect(run(rg, ["--files", "--hidden"])).toBe("a.ts\nb.ts\n");
        expect(rg.lastArgs()).toEqual(["--files", "--hidden"]);
        expect(rg.lastCwd()).toBe(realpathSync(path.dirname(rg.path)));
        expect(rg.pids()).toEqual([rg.onlyPid()]);
        // The run is over: its pid no longer answers.
        expect(isProcessAlive(rg.onlyPid())).toBe(false);
    });

    it("onlyPid refuses before the first run and after a second one", () => {
        const rg = writeFakeRipgrep();
        fake = rg;
        expect(() => rg.onlyPid()).toThrow("expected one fake rg run, got []");
        run(rg, []);
        run(rg, []);
        expect(rg.pids()).toHaveLength(2);
        expect(() => rg.onlyPid()).toThrow(/^expected one fake rg run, got \[\d+, \d+\]$/);
    });
});
