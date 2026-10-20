import { describe, expect, it } from "vitest";

import { encodedResult, tokenMetadata } from "../../../../TestUtils/encodedTokens.ts";
import type { ITokenizationSupport } from "../languages.ts";

import { PlainTextTokenizer } from "./builtin/plainTextTokenizer.ts";
import { NULL_STATE } from "./iState.ts";
import { TokenizationRegistry } from "./tokenizationRegistry.ts";

function makeStubSupport(): ITokenizationSupport {
    return {
        getInitialState: () => NULL_STATE,
        tokenizeEncoded: () => encodedResult([[0, tokenMetadata()]], NULL_STATE),
    };
}

describe("TokenizationRegistry", () => {
    it("returns undefined for unknown languageId", () => {
        const reg = new TokenizationRegistry();
        expect(reg.get("nonexistent")).toBeUndefined();
    });

    it("registers and retrieves a tokenizer", () => {
        const reg = new TokenizationRegistry();
        const support = new PlainTextTokenizer();
        reg.register("plaintext", support);
        expect(reg.get("plaintext")).toBe(support);
    });

    it("overwrites an existing registration", () => {
        const reg = new TokenizationRegistry();
        const a = makeStubSupport();
        const b = makeStubSupport();
        reg.register("javascript", a);
        reg.register("javascript", b);
        expect(reg.get("javascript")).toBe(b);
    });

    it("dispose() returned from register() unregisters", () => {
        const reg = new TokenizationRegistry();
        const support = new PlainTextTokenizer();
        const handle = reg.register("plaintext", support);
        handle.dispose();
        expect(reg.get("plaintext")).toBeUndefined();
    });

    it("fires onDidChange when a tokenizer is registered", () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        reg.onDidChange((langId) => seen.push(langId));
        reg.register("javascript", makeStubSupport());
        reg.register("typescript", makeStubSupport());
        expect(seen).toEqual(["javascript", "typescript"]);
    });

    it("disposing an onDidChange listener stops further notifications", () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        const handle = reg.onDidChange((langId) => seen.push(langId));

        reg.register("javascript", makeStubSupport());
        handle.dispose();
        reg.register("typescript", makeStubSupport());

        expect(seen).toEqual(["javascript"]);
    });

    it("stale dispose() does not remove a newer registration for the same languageId", () => {
        const reg = new TokenizationRegistry();
        const a = makeStubSupport();
        const b = makeStubSupport();
        const handleA = reg.register("javascript", a);
        reg.register("javascript", b);

        handleA.dispose();

        expect(reg.get("javascript")).toBe(b);
    });

    it("disposing the same register() handle twice is a no-op", () => {
        const reg = new TokenizationRegistry();
        const a = makeStubSupport();
        const handle = reg.register("javascript", a);

        handle.dispose();
        reg.register("javascript", makeStubSupport());
        // Second dispose must not touch the re-registered support.
        expect(() => {
            handle.dispose();
        }).not.toThrow();
        expect(reg.get("javascript")).toBeDefined();
    });

    it("disposing an onDidChange listener twice is a no-op", () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        const handle = reg.onDidChange((id) => seen.push(id));

        handle.dispose();
        expect(() => {
            handle.dispose();
        }).not.toThrow();

        reg.register("css", makeStubSupport());
        expect(seen).toEqual([]);
    });

    it("disposing one listener leaves other listeners active", () => {
        const reg = new TokenizationRegistry();
        const a: string[] = [];
        const b: string[] = [];
        const handleA = reg.onDidChange((id) => a.push(id));
        reg.onDidChange((id) => b.push(id));

        handleA.dispose();
        reg.register("css", makeStubSupport());

        expect(a).toEqual([]);
        expect(b).toEqual(["css"]);
    });
});
