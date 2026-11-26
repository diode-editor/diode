import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { SymbolKind } from "../../editor/common/languages/symbolKinds.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";

interface ISym {
    name: string;
    kind?: (typeof SymbolKind)[keyof typeof SymbolKind];
    containerName?: string;
    file?: string;
    line?: number;
    uri?: string;
    tags?: number[];
}

describe("Workbench — workspace symbols, edges", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const lines = Array.from({ length: 60 }, (_, index) => `line ${String(index)}`);
        ws = createTempWorkspace({
            prefix: "diode-workspacesymbols-edges-",
            files: {
                "open.txt": "startWord here\nsecond line\n",
                "src/deep.txt": lines.join("\n"),
                "src/other.txt": "x\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30), openFile: ws.path("open.txt") });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    function toSymbol(s: ISym) {
        return {
            name: s.name,
            kind: s.kind ?? SymbolKind.Function,
            tags: s.tags ?? [],
            containerName: s.containerName,
            location: {
                uri: s.uri ?? Uri.file(ws.path(s.file ?? "src/deep.txt")).toString(),
                range: createRange(s.line ?? 40, 2, s.line ?? 40, 6),
            },
        };
    }

    function register(symbols: ISym[] | ((query: string) => ISym[])) {
        const queries: string[] = [];
        h.container.get(LanguageFeaturesServiceDIToken).workspaceSymbolProvider.register({
            provideWorkspaceSymbols: (query: string) => {
                queries.push(query);
                const list = typeof symbols === "function" ? symbols(query) : symbols;
                return Promise.resolve(list.map(toSymbol));
            },
        });
        return queries;
    }

    async function settle(): Promise<string> {
        await vi.advanceTimersByTimeAsync(250);
        await flushMicrotasks();
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    async function openWith(query: string): Promise<string> {
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        for (const key of query) h.testApp.sendKey(key);
        return settle();
    }

    it("no providers: the row says so", async () => {
        expect(await openWith("abc")).toContain("No workspace symbol providers");
    });

    it("an empty query asks the providers and does not claim no match", async () => {
        const queries = register([]);
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        h.testApp.sendKey("Backspace");
        const screen = await settle();
        expect(queries).toContain("");
        expect(screen).not.toContain("No matching workspace symbols");
    });

    it("fast typing sends one query for the final text", async () => {
        const queries = register([]);
        await openWith("abcdef");
        expect(queries.filter((q) => q !== "startWord")).toEqual(["abcdef"]);
    });

    it("two words: the symbol and its container", async () => {
        register([
            { name: "render", containerName: "Alpha" },
            { name: "render", containerName: "Beta", line: 41 },
        ]);
        const screen = await openWith("render Beta");
        expect(screen).toContain("Beta • src/deep.txt");
        expect(screen).not.toContain("Alpha • src/deep.txt");
    });

    it("a failing provider leaves the answer of another", async () => {
        h.container.get(LanguageFeaturesServiceDIToken).workspaceSymbolProvider.register({
            provideWorkspaceSymbols: () => Promise.reject(new Error("boom")),
        });
        register([{ name: "survivor" }]);
        expect(await openWith("survivor")).toContain("survivor");
    });

    it("duplicates of two providers collapse into one row", async () => {
        register([{ name: "twin" }]);
        register([{ name: "twin" }]);
        const screen = await openWith("twin");
        expect(screen.split("\n").filter((l) => l.includes("src/deep.txt"))).toHaveLength(1);
    });

    it("sorts by score, then by name", async () => {
        register([{ name: "xxfoo" }, { name: "foob" }, { name: "fooa" }]);
        const lines = (await openWith("foo")).split("\n");
        const row = (name: string) => lines.findIndex((l) => l.includes(` ${name} `));
        expect(row("fooa")).toBeLessThan(row("foob"));
        expect(row("foob")).toBeLessThan(row("xxfoo"));
    });

    it("deprecated symbols are marked", async () => {
        register([{ name: "oldThing", tags: [1] }]);
        expect(await openWith("oldThing")).toContain("(deprecated)");
    });

    it("unicode names are found", async () => {
        register([{ name: "γειάΚόσμε" }]);
        expect(await openWith("γειά")).toContain("γειάΚόσμε");
    });

    it("a symbol in a file outside the workspace shows a path and opens", async () => {
        const outside = createTempWorkspace({ prefix: "diode-outside-", files: { "far.txt": "a\nb\nc\n" } });
        try {
            register([{ name: "farAway", uri: Uri.file(outside.path("far.txt")).toString(), line: 2 }]);
            const screen = await openWith("farAway");
            expect(screen).toContain("far.txt");
            h.testApp.sendKey("Enter");
            await settle();
            expect(h.activeEditor().uri.fsPath).toBe(outside.path("far.txt"));
        } finally {
            outside.dispose();
        }
    });

    it("a symbol in a missing file does not crash the picker", async () => {
        register([{ name: "ghost", file: "src/missing.txt" }]);
        await openWith("ghost");
        h.testApp.sendKey("Enter");
        await settle();
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        expect(await settle()).toContain("#");
    });

    it("Enter before the answer does not open anything and keeps the editor", async () => {
        register([{ name: "late" }]);
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        for (const key of "late") h.testApp.sendKey(key);
        h.testApp.sendKey("Enter");
        await settle();
        expect(h.activeEditor().uri.fsPath).toBe(ws.path("open.txt"));
    });

    it("the picker context follows the prefix when the next key is dispatched", async () => {
        register([]);
        const keys = h.container.get(ContextKeyServiceDIToken);
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();
        h.testApp.sendKey("#");
        h.testApp.sendKey("a");
        await settle();
        expect(keys.get("inWorkspaceSymbolsPicker")).toBe(true);

        h.testApp.sendKey("Ctrl+A");
        h.testApp.sendKey("@");
        h.testApp.sendKey("a");
        await settle();
        expect(keys.get("inWorkspaceSymbolsPicker")).toBe(false);
    });

    it("Escape in the debounce window drops the query", async () => {
        const queries = register([]);
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        h.testApp.sendKey("q");
        h.testApp.sendKey("Escape");
        await settle();
        expect(queries).not.toContain("q");
    });

    describe("includeSymbols", () => {
        beforeEach(async () => {
            await h.container.get(IConfigurationServiceDIToken).updateValue("search.quickOpen.includeSymbols", true);
        });

        async function ctrlP(query: string): Promise<string> {
            h.testApp.sendKey("Ctrl+P");
            h.testApp.render();
            for (const key of query) h.testApp.sendKey(key);
            return settle();
        }

        it("skipLocal: a local variable inside a container is left out, a class stays", async () => {
            register([
                { name: "aaLocal", kind: SymbolKind.Variable, containerName: "fn" },
                { name: "aaClass", kind: SymbolKind.Class, containerName: "mod" },
                { name: "aaFree", kind: SymbolKind.Function },
            ]);
            const screen = await ctrlP("aa");
            expect(screen).not.toContain("aaLocal");
            expect(screen).toContain("aaClass");
            expect(screen).toContain("aaFree");
        });

        it("no symbols for an empty query or :line", async () => {
            const queries = register([{ name: "deep" }]);
            await ctrlP("");
            h.testApp.sendKey("Escape");
            await ctrlP("deep:3");
            expect(queries.filter((q) => q.length === 0 || q.includes(":") || q === "deep")).toEqual([]);
        });

        it("Enter on a symbol row opens the file on the symbol", async () => {
            register([{ name: "uniqueSym", line: 40 }]);
            await ctrlP("uniqueSym");
            h.testApp.sendKey("Enter");
            await settle();
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/deep.txt"));
            expect(h.activeEditor().viewState.primaryCursorLine).toBe(40);
        });
    });

    it("seed: a selection wins over the word; a multi-line selection seeds nothing", async () => {
        register([]);
        h.testApp.sendKey("Shift+ArrowRight");
        h.testApp.sendKey("Shift+ArrowRight");
        h.testApp.render();
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        expect(await settle()).toContain("#st ");
        h.testApp.sendKey("Escape");
        h.testApp.render();
        h.testApp.sendKey("Shift+ArrowDown");
        h.testApp.render();
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        const screen = await settle();
        expect(screen).not.toContain("#st");
        expect(screen).not.toContain("#startWord");
    });
});
