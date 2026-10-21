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
    it("registerLazy() не зовёт фабрику и не фаерит onDidChange", () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        reg.registerLazy("css", factory);

        expect(factory).not.toHaveBeenCalled();
        expect(reg.get("css")).toBeUndefined();
        expect(seen).toEqual([]);
    });

    it("load() создаёт support, кладёт в реестр и фаерит onDidChange один раз", async () => {
        const reg = new TokenizationRegistry();
        const support = makeStubSupport();
        const seen: string[] = [];
        reg.registerLazy("css", async () => support);
        reg.onDidChange((id) => seen.push(id));

        expect(await reg.load("css")).toBe(support);

        expect(reg.get("css")).toBe(support);
        expect(seen).toEqual(["css"]);
    });

    it("слушатель onDidChange уже видит support через get()", async () => {
        const reg = new TokenizationRegistry();
        const support = makeStubSupport();
        reg.registerLazy("css", async () => support);
        let seenInListener: ITokenizationSupport | undefined;
        reg.onDidChange(() => (seenInListener = reg.get("css")));

        await reg.load("css");

        expect(seenInListener).toBe(support);
    });

    it("повторный load() не перезапускает фабрику и не фаерит снова", async () => {
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

    it("параллельные load() дёргают фабрику один раз", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        reg.registerLazy("css", factory);

        const [a, b, c] = await Promise.all([reg.load("css"), reg.load("css"), reg.load("css")]);

        expect(factory).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
        expect(b).toBe(c);
    });

    it("ре-ентрантный load() из onDidChange-слушателя не зацикливается", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        reg.registerLazy("css", factory);
        // Ровно то, что делает EditorComponent: onDidChange → applyTokenizer →
        // ensureTokenizerForLanguage → load().
        reg.onDidChange((id) => void reg.load(id));

        await reg.load("css");

        expect(factory).toHaveBeenCalledTimes(1);
    });

    it("load() неизвестного языка отдаёт undefined", async () => {
        const reg = new TokenizationRegistry();
        expect(await reg.load("nope")).toBeUndefined();
    });

    it("load() не ленивого, но eager-зарегистрированного языка отдаёт его support", async () => {
        const reg = new TokenizationRegistry();
        const support = makeStubSupport();
        reg.register("css", support);

        expect(await reg.load("css")).toBe(support);
    });

    it("eager-регистрация не перекрывает ленивую фабрику того же языка", async () => {
        const reg = new TokenizationRegistry();
        const lazySupport = makeStubSupport();
        reg.register("css", makeStubSupport());
        reg.registerLazy("css", async () => lazySupport);

        expect(await reg.load("css")).toBe(lazySupport);
        expect(reg.get("css")).toBe(lazySupport);
    });

    it("фабрика вернула null → ничего не регистрируется и не фаерится", async () => {
        const reg = new TokenizationRegistry();
        const seen: string[] = [];
        reg.registerLazy("css", async () => null);
        reg.onDidChange((id) => seen.push(id));

        expect(await reg.load("css")).toBeUndefined();
        expect(reg.get("css")).toBeUndefined();
        expect(seen).toEqual([]);
    });

    it("фабрика бросила → load() резолвится в undefined, а не реджектится", async () => {
        const reg = new TokenizationRegistry();
        reg.registerLazy("css", () => Promise.reject(new Error("boom")));

        await expect(reg.load("css")).resolves.toBeUndefined();
        expect(reg.get("css")).toBeUndefined();
    });

    it("неудача фабрики кешируется — ретрая нет", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(() => Promise.reject(new Error("boom")));
        reg.registerLazy("css", factory);

        await reg.load("css");
        await reg.load("css");

        expect(factory).toHaveBeenCalledTimes(1);
    });

    it("dispose() до load() — фабрика не вызывается", async () => {
        const reg = new TokenizationRegistry();
        const factory = vi.fn(async () => makeStubSupport());
        const handle = reg.registerLazy("css", factory);

        handle.dispose();

        expect(await reg.load("css")).toBeUndefined();
        expect(factory).not.toHaveBeenCalled();
    });

    it("dispose() после load() снимает support и фаерит onDidChange", async () => {
        const reg = new TokenizationRegistry();
        const handle = reg.registerLazy("css", async () => makeStubSupport());
        await reg.load("css");
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        handle.dispose();

        expect(reg.get("css")).toBeUndefined();
        expect(seen).toEqual(["css"]);
    });

    it("dispose() во время in-flight load() не регистрирует приехавший support", async () => {
        const reg = new TokenizationRegistry();
        const gate = deferred<ITokenizationSupport>();
        const handle = reg.registerLazy("css", () => gate.promise);

        const loading = reg.load("css");
        handle.dispose(); // запись снята, пока фабрика ещё в полёте
        gate.resolve(makeStubSupport());

        expect(await loading).toBeUndefined();
        expect(reg.get("css")).toBeUndefined();
    });

    it("две registerLazy на один язык — побеждает последняя", async () => {
        const reg = new TokenizationRegistry();
        const first = vi.fn(async () => makeStubSupport());
        const second = makeStubSupport();
        reg.registerLazy("css", first);
        reg.registerLazy("css", async () => second);

        expect(await reg.load("css")).toBe(second);
        expect(first).not.toHaveBeenCalled();
    });

    it("dispose() перекрытой lazy-записи — no-op", async () => {
        const reg = new TokenizationRegistry();
        const stale = reg.registerLazy("css", async () => makeStubSupport());
        const winner = makeStubSupport();
        reg.registerLazy("css", async () => winner);

        stale.dispose();

        expect(await reg.load("css")).toBe(winner);
    });

    it("lazyLanguageIds() перечисляет только ленивые регистрации", () => {
        const reg = new TokenizationRegistry();
        reg.register("html", makeStubSupport());
        reg.registerLazy("css", async () => makeStubSupport());
        reg.registerLazy("typescript", async () => makeStubSupport());

        expect(reg.lazyLanguageIds().sort()).toEqual(["css", "typescript"]);
    });
});
