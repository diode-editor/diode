import { describe, expect, it } from "vitest";

import { parseGitOpResult } from "./gitProtocol.ts";

describe("parseGitOpResult", () => {
    it("пропускает валидные envelope обоих исходов", () => {
        expect(parseGitOpResult({ ok: true })).toEqual({ ok: true });
        expect(parseGitOpResult({ ok: true, data: { message: "m" } })).toEqual({ ok: true, data: { message: "m" } });
        expect(parseGitOpResult({ ok: false, kind: "git-error", message: "boom" })).toEqual({
            ok: false,
            kind: "git-error",
            message: "boom",
        });
    });

    it("мусор из-за границы процесса — null", () => {
        expect(parseGitOpResult(null)).toBeNull();
        expect(parseGitOpResult("ok")).toBeNull();
        expect(parseGitOpResult({})).toBeNull();
        expect(parseGitOpResult({ ok: "true" })).toBeNull();
        expect(parseGitOpResult({ ok: false })).toBeNull(); // без kind/message
        expect(parseGitOpResult({ ok: false, kind: 1, message: "x" })).toBeNull();
        expect(parseGitOpResult({ ok: true, data: "not-an-object" })).toBeNull();
    });
});
