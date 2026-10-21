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

describe("TokenizationRegistry — hold", () => {
    it("while held get() returns undefined, after release — the support", () => {
        const reg = new TokenizationRegistry();
        const css = makeStubSupport();
        reg.register("css", css);

        const held = reg.hold();
        expect(reg.get("css")).toBeUndefined();

        held.dispose();
        expect(reg.get("css")).toBe(css);
    });

    it("loading while held proceeds but stays silent; release fires per language", async () => {
        const reg = new TokenizationRegistry();
        const ts = makeStubSupport();
        reg.register("css", makeStubSupport());
        reg.registerLazy("typescript", () => Promise.resolve(ts));
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        const held = reg.hold();
        expect(await reg.load("typescript")).toBe(ts);
        expect(seen).toEqual([]);

        held.dispose();
        expect(seen).toEqual(["css", "typescript"]);
        expect(reg.get("typescript")).toBe(ts);
    });

    it("a language removed while held also gets an event on release", () => {
        const reg = new TokenizationRegistry();
        const registration = reg.register("css", makeStubSupport());
        const held = reg.hold();
        registration.dispose();
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        held.dispose();

        expect(seen).toEqual(["css"]);
        expect(reg.get("css")).toBeUndefined();
    });

    it("a colorMap change while held stays silent, release fires once per language", () => {
        const reg = new TokenizationRegistry();
        reg.register("css", makeStubSupport());
        reg.register("html", makeStubSupport());
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        const held = reg.hold();
        reg.setColorMap(["", "#000000"]);
        reg.setColorMap(["", "#111111"]);
        expect(seen).toEqual([]);
        expect(reg.getColorMap()).toEqual(["", "#111111"]);

        held.dispose();
        expect(seen).toEqual(["css", "html"]);
    });

    it("a second release is a no-op, a second hold while the first is live throws", () => {
        const reg = new TokenizationRegistry();
        reg.register("css", makeStubSupport());
        const held = reg.hold();
        expect(() => reg.hold()).toThrow("already held");
        held.dispose();
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        held.dispose();

        expect(seen).toEqual([]);
        const again = reg.hold();
        expect(reg.get("css")).toBeUndefined();
        again.dispose();
    });
});
