import { describe, expect, it } from "vitest";

import { encodedResult, tokenMetadata } from "../../../../TestUtils/encodedTokens.ts";
import type { ITokenizationSupport } from "../languages.ts";

import { NULL_STATE } from "./iState.ts";
import { TokenizationRegistry } from "./tokenizationRegistry.ts";

function makeStubSupport(): ITokenizationSupport {
    return {
        getInitialState: () => NULL_STATE,
        tokenizeEncoded: () => encodedResult([[0, tokenMetadata()]], NULL_STATE),
    };
}

describe("TokenizationRegistry — change notifications", () => {
    it("does not fire onDidChange on subscription, only on register()", () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));
        expect(seen).toEqual([]);
    });

    it("fires onDidChange again when an existing languageId is overwritten", () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        reg.register("css", makeStubSupport());
        reg.register("css", makeStubSupport());

        expect(seen).toEqual(["css", "css"]);
    });

    it("dispose() of a registration fires onDidChange for that languageId", () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        const handle = reg.register("css", makeStubSupport());
        reg.onDidChange((id) => seen.push(id));

        handle.dispose();

        expect(seen).toEqual(["css"]);
    });

    it("stale dispose() does not fire onDidChange", () => {
        const reg = new TokenizationRegistry();
        const handleA = reg.register("css", makeStubSupport());
        reg.register("css", makeStubSupport()); // overwrites — handleA is now stale

        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));
        handleA.dispose();

        expect(seen).toEqual([]);
    });

    it("re-registering after dispose() works and notifies again", () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        const handle = reg.register("css", makeStubSupport());
        handle.dispose();
        const fresh = makeStubSupport();
        reg.register("css", fresh);

        expect(reg.get("css")).toBe(fresh);
        expect(seen).toEqual(["css", "css", "css"]);
    });

    it("notifies every active listener, in subscription order", () => {
        const reg = new TokenizationRegistry();
        const order: string[] = [];
        reg.onDidChange(() => order.push("first"));
        reg.onDidChange(() => order.push("second"));

        reg.register("css", makeStubSupport());

        expect(order).toEqual(["first", "second"]);
    });

    it("the same listener subscribed twice is invoked twice and removed one slot per dispose", () => {
        const reg = new TokenizationRegistry();
        let calls = 0;
        const listener = () => {
            calls++;
        };
        const handle1 = reg.onDidChange(listener);
        reg.onDidChange(listener);

        reg.register("css", makeStubSupport());
        expect(calls).toBe(2);

        handle1.dispose();
        reg.register("html", makeStubSupport());
        expect(calls).toBe(3);
    });
});

describe("TokenizationRegistry — colorMap", () => {
    it("getColorMap() — null until a theme is set", () => {
        expect(new TokenizationRegistry().getColorMap()).toBeNull();
    });

    it("setColorMap() stores the colorMap and fires onDidChange once per language with a support", async () => {
        const reg = new TokenizationRegistry();
        reg.register("css", makeStubSupport());
        reg.registerLazy("typescript", () => Promise.resolve(makeStubSupport()));
        reg.registerLazy("rust", () => Promise.resolve(makeStubSupport()));
        await reg.load("typescript");
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        const colorMap = ["", "#000000", "#ffffff", "#ff0000"];
        reg.setColorMap(colorMap);

        expect(reg.getColorMap()).toBe(colorMap);
        expect([...seen].sort()).toEqual(["css", "typescript"]);
    });

    it("setColorMap() with no languages silently changes the colorMap", () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));
        reg.setColorMap(["", "#000000"]);
        expect(seen).toEqual([]);
        expect(reg.getColorMap()).toEqual(["", "#000000"]);
    });
});
