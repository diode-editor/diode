import { describe, expect, it } from "vitest";

import { parseGitOpResult } from "./gitProtocol.ts";

describe("parseGitOpResult", () => {
    it("accepts valid envelopes of both outcomes", () => {
        expect(parseGitOpResult({ ok: true })).toEqual({ ok: true });
        expect(parseGitOpResult({ ok: true, data: { message: "m" } })).toEqual({ ok: true, data: { message: "m" } });
        expect(parseGitOpResult({ ok: false, kind: "git-error", message: "boom" })).toEqual({
            ok: false,
            kind: "git-error",
            message: "boom",
        });
    });

    it("garbage from across the process boundary gives null", () => {
        expect(parseGitOpResult(null)).toBeNull();
        expect(parseGitOpResult("ok")).toBeNull();
        expect(parseGitOpResult({})).toBeNull();
        expect(parseGitOpResult({ ok: "true" })).toBeNull();
        expect(parseGitOpResult({ ok: false })).toBeNull(); // no kind/message
        expect(parseGitOpResult({ ok: false, kind: 1, message: "x" })).toBeNull();
        expect(parseGitOpResult({ ok: true, data: "not-an-object" })).toBeNull();
    });
});
