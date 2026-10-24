import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    applyTestFlake,
    FLAKE_RETRY,
    flakeRetriedLine,
    type IFlakeTarget,
    parseTestFlakes,
    readTestFlakes,
    TestFlakeIndex,
} from "./testFlakes.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

const entry = { file: "src/a.test.ts", test: "suite > case", action: "retry", note: "why" };

const BAD_PLATFORMS = 'flakes[1]: "platforms" must be a non-empty array of non-empty strings';

function list(...flakes: unknown[]): string {
    return JSON.stringify({ flakes });
}

describe("parseTestFlakes", () => {
    it("reads platforms when present and leaves the field out otherwise", () => {
        const [everywhere, windows] = parseTestFlakes(list(entry, { ...entry, platforms: ["win32", "darwin"] }));
        expect(everywhere).not.toHaveProperty("platforms");
        expect(windows.platforms).toEqual(["win32", "darwin"]);
    });

    it("reads valid entries", () => {
        expect(parseTestFlakes(list(entry, { ...entry, action: "skip" }))).toEqual([
            entry,
            { ...entry, action: "skip" },
        ]);
    });

    it.each([
        ["no flakes array", "{}", 'expected an object with a "flakes" array'],
        ["null", "null", 'expected an object with a "flakes" array'],
        ["an entry that is not an object", list(1), "flakes[0]: expected an object"],
        ["an empty file", list({ ...entry, file: "" }), 'flakes[0]: "file" must be a non-empty string'],
        ["a missing test", list({ ...entry, test: undefined }), 'flakes[0]: "test" must be a non-empty string'],
        [
            "an unknown action",
            list(entry, { ...entry, action: "quarantine" }),
            'flakes[1]: "action" must be "retry" or "skip"',
        ],
        ["an empty note", list({ ...entry, note: "" }), 'flakes[0]: "note" must be a non-empty string'],
        ["platforms that are not an array", list(entry, { ...entry, platforms: "win32" }), BAD_PLATFORMS],
        ["empty platforms", list(entry, { ...entry, platforms: [] }), BAD_PLATFORMS],
        ["a platform that is not a string", list(entry, { ...entry, platforms: ["linux", 1] }), BAD_PLATFORMS],
        ["an empty platform", list(entry, { ...entry, platforms: ["linux", ""] }), BAD_PLATFORMS],
    ])("rejects %s", (_, text, message) => {
        expect(() => parseTestFlakes(text)).toThrow(`test-flakes.json: ${message}`);
    });
});

describe("TestFlakeIndex", () => {
    const index = new TestFlakeIndex("/repo", parseTestFlakes(list(entry)), "linux");

    it("finds an entry by the absolute file path and the full test name", () => {
        expect(index.find(path.join("/repo", "src", "a.test.ts"), "suite > case")).toEqual(entry);
    });

    it("does not match another test in the same file or the same name in another file", () => {
        expect(index.find("/repo/src/a.test.ts", "suite > other")).toBeUndefined();
        expect(index.find("/repo/src/b.test.ts", "suite > case")).toBeUndefined();
    });

    it("finds an entry with platforms only on a listed platform", () => {
        const windowsOnly = parseTestFlakes(list({ ...entry, platforms: ["win32", "darwin"] }));
        expect(new TestFlakeIndex("/repo", windowsOnly, "win32").find("/repo/src/a.test.ts", "suite > case")).toEqual(
            windowsOnly[0],
        );
        expect(new TestFlakeIndex("/repo", windowsOnly, "darwin").find("/repo/src/a.test.ts", "suite > case")).toEqual(
            windowsOnly[0],
        );
        expect(
            new TestFlakeIndex("/repo", windowsOnly, "linux").find("/repo/src/a.test.ts", "suite > case"),
        ).toBeUndefined();
    });

    it("keys a screenshot scenario by its scenario file and name", () => {
        const scenario = { ...entry, file: "e2e/scenarios/regionFolding.scenario.ts", test: "region-folding" };
        const scenarios = new TestFlakeIndex("/repo", parseTestFlakes(list(scenario)), "linux");
        expect(scenarios.find("/repo/e2e/scenarios/regionFolding.scenario.ts", "region-folding")).toEqual(scenario);
    });
});

describe("applyTestFlake", () => {
    it("retry raises the attempts to FLAKE_RETRY and keeps a larger own retry", () => {
        const plain: IFlakeTarget = { mode: "run" };
        applyTestFlake(plain, parseTestFlakes(list(entry))[0]);
        expect(plain).toEqual({ mode: "run", retry: FLAKE_RETRY });

        const own: IFlakeTarget = { mode: "run", retry: 5 };
        applyTestFlake(own, parseTestFlakes(list(entry))[0]);
        expect(own.retry).toBe(5);
    });

    it("skip turns the test off and leaves retry alone", () => {
        const target: IFlakeTarget = { mode: "run" };
        applyTestFlake(target, parseTestFlakes(list({ ...entry, action: "skip" }))[0]);
        expect(target).toEqual({ mode: "skip" });
    });
});

describe("flakeRetriedLine", () => {
    it("is a GitHub warning annotation naming the file, the test and the retries", () => {
        expect(flakeRetriedLine("src/a.test.ts", "suite > case", 1)).toBe(
            "::warning file=src/a.test.ts,title=Known flake retried::suite > case passed after 1 retry (test-flakes.json)",
        );
        expect(flakeRetriedLine("src/a.test.ts", "suite > case", 2)).toContain("passed after 2 retries");
    });
});

describe("test-flakes.json in the repo", () => {
    // A renamed or fixed-and-deleted test must leave the list: a stale entry silently stops working.
    it.each(readTestFlakes(ROOT).map((flake) => [flake.test, flake] as const))(
        "%s — the file and every name segment exist",
        (_, flake) => {
            const source = fs.readFileSync(path.join(ROOT, flake.file), "utf8");
            for (const segment of flake.test.split(" > ")) expect(source).toContain(segment);
        },
    );
});
