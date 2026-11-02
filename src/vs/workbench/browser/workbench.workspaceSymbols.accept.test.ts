import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { SymbolKind } from "../../editor/common/languages/symbolKinds.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { ExternalOpenerDIToken } from "../services/externalOpener/common/iExternalOpener.ts";

describe("Workbench — workspace symbols, accept and races", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const lines = Array.from({ length: 60 }, (_, index) => `line ${String(index)}`);
        ws = createTempWorkspace({
            prefix: "diode-workspacesymbols-accept-",
            files: {
                "open.txt": "startWord here\n",
                "src/deep.txt": lines.join("\n"),
                "dir with space/αρχείο.txt": lines.join("\n"),
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30), openFile: ws.path("open.txt") });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    const registry = () => h.container.get(LanguageFeaturesServiceDIToken).workspaceSymbolProvider;

    function symbol(name: string, line?: number, file = "src/deep.txt") {
        return {
            name,
            kind: SymbolKind.Function,
            tags: [],
            location: {
                uri: Uri.file(ws.path(file)).toString(),
                ...(line === undefined ? {} : { range: createRange(line, 2, line, 6) }),
            },
        };
    }

    async function settle(): Promise<string> {
        await vi.advanceTimersByTimeAsync(250);
        await flushMicrotasks();
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    async function pick(query: string): Promise<string> {
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        for (const key of query) h.testApp.sendKey(key);
        return settle();
    }

    it("resolve answers nothing: the location of the row is used", async () => {
        registry().register({
            provideWorkspaceSymbols: () => Promise.resolve([symbol("noAnswer", 12)]),
            resolveWorkspaceSymbol: () => Promise.resolve(null),
        });
        await pick("noAnswer");
        h.testApp.sendKey("Enter");
        await settle();
        expect(h.activeEditor().viewState.primaryCursorLine).toBe(12);
    });

    it("no range and no resolve: the file opens at the top", async () => {
        registry().register({ provideWorkspaceSymbols: () => Promise.resolve([symbol("rangeless")]) });
        await pick("rangeless");
        h.testApp.sendKey("Enter");
        await settle();
        expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/deep.txt"));
        expect(h.activeEditor().viewState.primaryCursorLine).toBe(0);
    });

    it("an http symbol goes to the external opener, the editor stays", async () => {
        const open = vi.spyOn(h.container.get(ExternalOpenerDIToken), "open").mockResolvedValue(true);
        registry().register({
            provideWorkspaceSymbols: () =>
                Promise.resolve([
                    {
                        name: "webSym",
                        kind: SymbolKind.Function,
                        tags: [],
                        location: { uri: "https://example.com/a.ts" },
                    },
                ]),
        });
        await pick("webSym");
        h.testApp.sendKey("Enter");
        await settle();
        expect(open).toHaveBeenCalledTimes(1);
        expect(h.activeEditor().uri.fsPath).toBe(ws.path("open.txt"));
    });

    it("a path with spaces and non-ASCII letters is readable and opens", async () => {
        registry().register({
            provideWorkspaceSymbols: () => Promise.resolve([symbol("cyr", 3, "dir with space/αρχείο.txt")]),
        });
        expect(await pick("cyr")).toContain("dir with space/αρχείο.txt");
        h.testApp.sendKey("Enter");
        await settle();
        expect(h.activeEditor().uri.fsPath).toBe(ws.path("dir with space/αρχείο.txt"));
    });

    it("a slow answer to an old query does not replace the answer to the new one", async () => {
        const pending = new Map<string, (v: ReturnType<typeof symbol>[]) => void>();
        registry().register({
            provideWorkspaceSymbols: (query: string) =>
                new Promise((resolve) => {
                    pending.set(query, resolve);
                }),
        });
        await pick("aa");
        h.testApp.sendKey("b");
        await settle();
        pending.get("aab")?.([symbol("aabNew", 1)]);
        await settle();
        pending.get("aa")?.([symbol("aaOld", 2)]);
        const screen = await settle();
        expect(screen).toContain("aabNew");
        expect(screen).not.toContain("aaOld");
    });

    it("the previous request is cancelled when the query changes", async () => {
        const tokens: { isCancellationRequested: boolean }[] = [];
        registry().register({
            provideWorkspaceSymbols: (_query: string, token: { isCancellationRequested: boolean }) => {
                tokens.push(token);
                return new Promise(() => undefined);
            },
        });
        await pick("aa");
        h.testApp.sendKey("b");
        await settle();
        expect(tokens.length).toBeGreaterThanOrEqual(2);
        expect(tokens.slice(0, -1).every((t) => t.isCancellationRequested)).toBe(true);
    });

    it("closing the picker cancels the running request", async () => {
        const tokens: { isCancellationRequested: boolean }[] = [];
        registry().register({
            provideWorkspaceSymbols: (_query: string, token: { isCancellationRequested: boolean }) => {
                tokens.push(token);
                return new Promise(() => undefined);
            },
        });
        await pick("aa");
        h.testApp.sendKey("Escape");
        await settle();
        expect(tokens.at(-1)?.isCancellationRequested).toBe(true);
    });

    it("a server answer the query does not match is filtered out", async () => {
        registry().register({ provideWorkspaceSymbols: () => Promise.resolve([symbol("completelyOther", 1)]) });
        const screen = await pick("zzz");
        expect(screen).not.toContain("completelyOther");
        expect(screen).toContain("No matching workspace symbols");
    });

    it("a provider registered while `#` is open is asked", async () => {
        await pick("lateSym");
        registry().register({ provideWorkspaceSymbols: () => Promise.resolve([symbol("lateSym", 1)]) });
        expect(await settle()).toContain("lateSym");
    });

    it("a provider unregistered while `#` is open: the last provider gone leaves no stale error", async () => {
        const reg = registry().register({ provideWorkspaceSymbols: () => Promise.resolve([symbol("gone", 1)]) });
        await pick("gone");
        reg.dispose();
        h.testApp.sendKey("x");
        expect(await settle()).toContain("No workspace symbol providers");
    });

    it("a large answer renders and Enter takes the first row", async () => {
        const many = Array.from({ length: 20000 }, (_, i) => symbol(`sym${String(i).padStart(5, "0")}`, i % 50));
        registry().register({ provideWorkspaceSymbols: () => Promise.resolve(many) });
        const screen = await pick("sym");
        expect(screen).toContain("sym00000");
        h.testApp.sendKey("Enter");
        await settle();
        expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/deep.txt"));
    });
});
