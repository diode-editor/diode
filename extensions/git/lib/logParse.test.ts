import { describe, expect, it } from "vitest";

import type { ILogEntry } from "./logParse.ts";
import { parseDecorations, parseLogZ } from "./logParse.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function entry(fields: {
    sha: string;
    shortSha?: string;
    parents?: string;
    refs?: string;
    author?: string;
    timestamp?: string;
    subject?: string;
}): string {
    return [
        fields.sha,
        fields.shortSha ?? fields.sha.slice(0, 8),
        fields.parents ?? "",
        fields.refs ?? "",
        fields.author ?? "Eugene",
        fields.timestamp ?? "1700000000",
        fields.subject ?? "subject",
    ].join("\0");
}

function expected(fields: Partial<ILogEntry> & { sha: string }): ILogEntry {
    return {
        shortSha: fields.sha.slice(0, 8),
        parents: [],
        refs: [],
        author: "Eugene",
        timestamp: 1700000000,
        subject: "subject",
        ...fields,
    };
}

describe("parseLogZ", () => {
    it("parses NUL-separated records of seven fields", () => {
        const stdout = [
            entry({ sha: SHA_A, parents: SHA_B, subject: "feat: panel" }),
            entry({ sha: SHA_B, subject: "fix: sash" }),
        ].join("\0");
        expect(parseLogZ(stdout)).toEqual([
            expected({ sha: SHA_A, parents: [SHA_B], subject: "feat: panel" }),
            expected({ sha: SHA_B, subject: "fix: sash" }),
        ]);
    });

    it("merge commit parents are space-separated", () => {
        const stdout = entry({ sha: SHA_A, parents: `${SHA_B} ${SHA_C}` });
        expect(parseLogZ(stdout)[0].parents).toEqual([SHA_B, SHA_C]);
    });

    it("root commit has an empty parent list", () => {
        expect(parseLogZ(entry({ sha: SHA_A }))[0].parents).toEqual([]);
    });

    it("commit author and time land in the record", () => {
        const stdout = entry({ sha: SHA_A, author: "Ada Lovelace", timestamp: "1234567890" });
        expect(parseLogZ(stdout)[0]).toMatchObject({ author: "Ada Lovelace", timestamp: 1234567890 });
    });

    it("non-numeric time degrades to 0, not NaN", () => {
        expect(parseLogZ(entry({ sha: SHA_A, timestamp: "hmm" }))[0].timestamp).toBe(0);
    });

    it("drops the empty tail from the trailing NUL", () => {
        expect(parseLogZ(`${entry({ sha: SHA_A })}\0`)).toEqual([expected({ sha: SHA_A })]);
    });

    it("an empty subject is a valid record, not a tail", () => {
        expect(parseLogZ(entry({ sha: SHA_A, subject: "" }))).toEqual([expected({ sha: SHA_A, subject: "" })]);
    });

    it("drops an incomplete chunk (truncated output)", () => {
        const stdout = `${entry({ sha: SHA_A })}\0${SHA_B}\0bbbbbbbb`;
        expect(parseLogZ(stdout)).toEqual([expected({ sha: SHA_A })]);
    });

    it("empty output gives an empty list", () => {
        expect(parseLogZ("")).toEqual([]);
    });

    it("skips a record with an empty sha", () => {
        const stdout = `${entry({ sha: "", shortSha: "short" })}\0${entry({ sha: SHA_A, subject: "ok" })}`;
        expect(parseLogZ(stdout)).toEqual([expected({ sha: SHA_A, subject: "ok" })]);
    });
});

describe("parseDecorations", () => {
    it("marks the current branch as current", () => {
        expect(parseDecorations("HEAD -> main")).toEqual([{ name: "main", kind: "head", current: true }]);
    });

    it("parses the full set: branch, remote, tag", () => {
        expect(parseDecorations("HEAD -> main, origin/main, tag: v1.0")).toEqual([
            { name: "main", kind: "head", current: true },
            { name: "origin/main", kind: "remote", current: false },
            { name: "v1.0", kind: "tag", current: false },
        ]);
    });

    it("a local branch without HEAD is a plain head", () => {
        expect(parseDecorations("feature")).toEqual([{ name: "feature", kind: "head", current: false }]);
    });

    it("a bare HEAD (detached) is not a ref", () => {
        expect(parseDecorations("HEAD")).toEqual([]);
        expect(parseDecorations("HEAD, tag: v2")).toEqual([{ name: "v2", kind: "tag", current: false }]);
    });

    it("drops origin/HEAD: it is a symbolic pointer", () => {
        expect(parseDecorations("origin/HEAD, origin/main")).toEqual([
            { name: "origin/main", kind: "remote", current: false },
        ]);
    });

    it("an empty decoration string gives an empty list", () => {
        expect(parseDecorations("")).toEqual([]);
    });

    it("skips garbage empty tokens", () => {
        expect(parseDecorations("tag: , , main")).toEqual([{ name: "main", kind: "head", current: false }]);
    });
});
