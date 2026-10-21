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

function list(...flakes: unknown[]): string {
    return JSON.stringify({ flakes });
}

describe("parseTestFlakes", () => {
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
    ])("rejects %s", (_, text, message) => {
        expect(() => parseTestFlakes(text)).toThrow(`test-flakes.json: ${message}`);
    });
});

describe("TestFlakeIndex", () => {
    const index = new TestFlakeIndex("/repo", parseTestFlakes(list(entry)));

    it("finds an entry by the absolute file path and the full test name", () => {
        expect(index.find(path.join("/repo", "src", "a.test.ts"), "suite > case")).toEqual(entry);
    });

    it("does not match another test in the same file or the same name in another file", () => {
        expect(index.find("/repo/src/a.test.ts", "suite > other")).toBeUndefined();
        expect(index.find("/repo/src/b.test.ts", "suite > case")).toBeUndefined();
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
