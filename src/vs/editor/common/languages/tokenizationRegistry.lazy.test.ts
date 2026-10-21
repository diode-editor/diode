import { describe, expect, it, vi } from "vitest";

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

describe("TokenizationRegistry — lazy registration", () => {
    it("registerLazy() neither calls the factory nor fires onDidChange", () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        reg.registerLazy("css", factory);

        expect(factory).not.toHaveBeenCalled();
        expect(reg.get("css")).toBeUndefined();
        expect(seen).toEqual([]);
    });

    it("load() creates the support, puts it in the registry and fires onDidChange once", async () => {
        const reg = new TokenizationRegistry();
        const support = makeStubSupport();
        const seen: string[] = [];
        reg.registerLazy("css", async () => support);
        reg.onDidChange((id) => seen.push(id));

        expect(await reg.load("css")).toBe(support);

        expect(reg.get("css")).toBe(support);
        expect(seen).toEqual(["css"]);
    });

    it("an onDidChange listener already sees the support via get()", async () => {
        const reg = new TokenizationRegistry();
        const support = makeStubSupport();
        reg.registerLazy("css", async () => support);
        let seenInListener: ITokenizationSupport | undefined;
        reg.onDidChange(() => (seenInListener = reg.get("css")));

        await reg.load("css");

        expect(seenInListener).toBe(support);
    });

    it("a repeated load() neither reruns the factory nor fires again", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        reg.registerLazy("css", factory);
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        await reg.load("css");
        await reg.load("css");

        expect(factory).toHaveBeenCalledTimes(1);
        expect(seen).toEqual(["css"]);
    });

    it("parallel load() calls invoke the factory once", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        reg.registerLazy("css", factory);

        const [a, b, c] = await Promise.all([reg.load("css"), reg.load("css"), reg.load("css")]);

        expect(factory).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
        expect(b).toBe(c);
    });

    it("a reentrant load() from an onDidChange listener does not loop", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        reg.registerLazy("css", factory);
        // Exactly what EditorComponent does: onDidChange → applyTokenizer →
        // ensureTokenizerForLanguage → load().
        reg.onDidChange((id) => void reg.load(id));

        await reg.load("css");

        expect(factory).toHaveBeenCalledTimes(1);
    });

    it("load() of an unknown language returns undefined", async () => {
        const reg = new TokenizationRegistry();
        expect(await reg.load("nope")).toBeUndefined();
    });

    it("load() of a non-lazy, eagerly registered language returns its support", async () => {
        const reg = new TokenizationRegistry();
        const support = makeStubSupport();
        reg.register("css", support);

        expect(await reg.load("css")).toBe(support);
    });

    it("an eager registration does not override a lazy factory for the same language", async () => {
        const reg = new TokenizationRegistry();
        const lazySupport = makeStubSupport();
        reg.register("css", makeStubSupport());
        reg.registerLazy("css", async () => lazySupport);

        expect(await reg.load("css")).toBe(lazySupport);
        expect(reg.get("css")).toBe(lazySupport);
    });

    it("factory returned null → nothing is registered or fired", async () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        reg.registerLazy("css", async () => null);
        reg.onDidChange((id) => seen.push(id));

        expect(await reg.load("css")).toBeUndefined();
        expect(reg.get("css")).toBeUndefined();
        expect(seen).toEqual([]);
    });

    it("factory threw → load() resolves to undefined instead of rejecting", async () => {
        const reg = new TokenizationRegistry();
        reg.registerLazy("css", () => Promise.reject(new Error("boom")));

        await expect(reg.load("css")).resolves.toBeUndefined();
        expect(reg.get("css")).toBeUndefined();
    });

    it("a factory failure is cached — no retry", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(() => Promise.reject(new Error("boom")));
        reg.registerLazy("css", factory);

        await reg.load("css");
        await reg.load("css");

        expect(factory).toHaveBeenCalledTimes(1);
    });

    it("dispose() before load() — the factory is not called", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        const handle = reg.registerLazy("css", factory);

        handle.dispose();

        expect(await reg.load("css")).toBeUndefined();
        expect(factory).not.toHaveBeenCalled();
    });

    it("dispose() after load() removes the support and fires onDidChange", async () => {
        const reg = new TokenizationRegistry();
        const handle = reg.registerLazy("css", async () => makeStubSupport());
        await reg.load("css");
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        handle.dispose();

        expect(reg.get("css")).toBeUndefined();
        expect(seen).toEqual(["css"]);
    });

    it("dispose() during an in-flight load() does not register the arriving support", async () => {
        const reg = new TokenizationRegistry();
        const gate = deferred<ITokenizationSupport>();
        const handle = reg.registerLazy("css", () => gate.promise);

        const loading = reg.load("css");
        handle.dispose(); // entry removed while the factory is still in flight
        gate.resolve(makeStubSupport());

        expect(await loading).toBeUndefined();
        expect(reg.get("css")).toBeUndefined();
    });

    it("two registerLazy calls for one language — the last one wins", async () => {
        const reg = new TokenizationRegistry();
        const first = vi.fn(async () => makeStubSupport());
        const second = makeStubSupport();
        reg.registerLazy("css", first);
        reg.registerLazy("css", async () => second);

        expect(await reg.load("css")).toBe(second);
        expect(first).not.toHaveBeenCalled();
    });

    it("dispose() of a superseded lazy entry is a no-op", async () => {
        const reg = new TokenizationRegistry();
        const stale = reg.registerLazy("css", async () => makeStubSupport());
        const winner = makeStubSupport();
        reg.registerLazy("css", async () => winner);

        stale.dispose();

        expect(await reg.load("css")).toBe(winner);
    });

    it("lazyLanguageIds() lists only lazy registrations", () => {
        const reg = new TokenizationRegistry();
        reg.register("html", makeStubSupport());
        reg.registerLazy("css", async () => makeStubSupport());
        reg.registerLazy("typescript", async () => makeStubSupport());

        expect(reg.lazyLanguageIds().sort()).toEqual(["css", "typescript"]);
    });
});
