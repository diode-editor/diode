import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    ICoreWorkspaceSymbol,
    WorkspaceSymbolProvider,
} from "../../../../editor/common/languages/iWorkspaceSymbolSource.ts";
import { SymbolKind, SymbolTagDeprecated } from "../../../../editor/common/languages/symbolKinds.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import type { QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import {
    compareItems,
    getWorkspaceSymbols,
    WorkspaceSymbolsQuickAccessProvider,
} from "./workspaceSymbolsQuickAccessProvider.ts";

const DELAY = 200;

function symbol(name: string, extra: Partial<ICoreWorkspaceSymbol> = {}): ICoreWorkspaceSymbol {
    return {
        name,
        kind: SymbolKind.Function,
        tags: [],
        location: { uri: "file:///w/src/a.ts", range: createRange(3, 2, 3, 8) },
        ...extra,
    };
}

function answering(answer: readonly ICoreWorkspaceSymbol[]): WorkspaceSymbolProvider {
    return { provideWorkspaceSymbols: vi.fn(() => Promise.resolve(answer)) };
}

interface IEditorOptions {
    readonly selected?: string;
    readonly line?: string;
    readonly column?: number;
}

function setup(editorOptions: IEditorOptions | null = {}) {
    const features = new LanguageFeaturesService();
    const editor =
        editorOptions === null
            ? null
            : {
                  uri: Uri.file("/w/src/a.ts"),
                  viewState: {
                      getSelectedText: () => editorOptions.selected ?? "",
                      primaryCursorLine: 0,
                      primaryCursorColumn: editorOptions.column ?? 0,
                  },
                  model: { document: { getLineContent: () => editorOptions.line ?? "" } },
                  goToPosition: vi.fn(),
                  revealRange: vi.fn(),
              };
    const openUri = vi.fn((_uri: Uri) => Promise.resolve());
    const jumps = { count: 0 };
    const open = vi.fn((_url: string) => Promise.resolve(true));
    const provider = new WorkspaceSymbolsQuickAccessProvider(
        features,
        { getActiveEditor: () => editor, openUri } as never,
        {
            jump: (navigate) => navigate(),
            jumpAsync: (navigate) => {
                jumps.count++;
                return navigate();
            },
        },
        {
            getWorkspaceFolder: (uri: Uri) =>
                uri.fsPath.startsWith("/w/") ? ({ uri: Uri.file("/w") } as never) : null,
        },
        { open },
        NERD_FONT_ICONS,
    );
    const refresh = vi.fn<(preserveSelection: boolean) => void>();
    provider.onShow(refresh);
    return { provider, features, editor, openUri, jumps, open, refresh };
}

async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(DELAY);
    await flushMicrotasks();
}

const labels = (items: readonly QuickAccessItem[]): string[] => items.map((item) => item.label);

describe("WorkspaceSymbolsQuickAccessProvider", () => {
    it("says what to type and asks the picker to debounce the input", () => {
        const { provider } = setup();
        expect(provider.getPlaceholder()).toBe("Type the name of a symbol to open.");
        expect(provider.debounceQuery).toBe(true);
    });

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("the starting filter", () => {
        it("is the selection on one line, the word under the cursor otherwise", () => {
            expect(setup({ selected: "two words" }).provider.getDefaultFilterValue()).toBe("two words");
            expect(setup({ line: "const reply = 1", column: 7 }).provider.getDefaultFilterValue()).toBe("reply");
        });

        it("is absent for a multi-line selection, outside a word and without an editor", () => {
            expect(setup({ selected: "a\nb", line: "word" }).provider.getDefaultFilterValue()).toBeUndefined();
            expect(setup({ line: "  =  ", column: 2 }).provider.getDefaultFilterValue()).toBeUndefined();
            expect(setup(null).provider.getDefaultFilterValue()).toBeUndefined();
        });
    });

    describe("the request", () => {
        it("goes out 200 ms after typing, not before", async () => {
            const { provider, features } = setup();
            const source = answering([]);
            features.workspaceSymbolProvider.register(source);

            provider.getItems("#foo");
            await vi.advanceTimersByTimeAsync(DELAY - 1);
            expect(source.provideWorkspaceSymbols).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(source.provideWorkspaceSymbols).toHaveBeenCalledTimes(1);
            expect(vi.mocked(source.provideWorkspaceSymbols).mock.calls[0][0]).toBe("foo");
        });

        it("typing again restarts the delay: only the last query reaches the provider", async () => {
            const { provider, features } = setup();
            const source = answering([]);
            features.workspaceSymbolProvider.register(source);

            provider.getItems("#f");
            await vi.advanceTimersByTimeAsync(DELAY - 1);
            provider.getItems("#fo");
            await settle();

            expect(vi.mocked(source.provideWorkspaceSymbols).mock.calls.map((call) => call[0])).toEqual(["fo"]);
        });

        it("a request in flight is cancelled by the next query, its late answer is ignored", async () => {
            const { provider, features, refresh } = setup();
            const tokens: ICancellationToken[] = [];
            let answerFirst: (value: readonly ICoreWorkspaceSymbol[]) => void = () => undefined;
            features.workspaceSymbolProvider.register({
                provideWorkspaceSymbols: (query, cancellation) => {
                    tokens.push(cancellation);
                    if (query === "first") {
                        return new Promise((resolve) => {
                            answerFirst = resolve;
                        });
                    }
                    return Promise.resolve([symbol("second")]);
                },
            });

            provider.getItems("#first");
            await settle();
            provider.getItems("#second");
            expect(tokens[0].isCancellationRequested).toBe(true);
            await settle();
            expect(labels(provider.getItems("#second"))).toEqual(["second"]);

            refresh.mockClear();
            answerFirst([symbol("first")]);
            await flushMicrotasks();
            expect(refresh).not.toHaveBeenCalled();
            expect(labels(provider.getItems("#second"))).toEqual(["second"]);
        });

        it("the same query does not ask again: a refresh only re-reads the rows", async () => {
            const { provider, features, refresh } = setup();
            const source = answering([symbol("foo")]);
            features.workspaceSymbolProvider.register(source);
            refresh.mockClear();

            expect(provider.getItems("#foo")).toEqual([]);
            await settle();
            expect(refresh).toHaveBeenCalledExactlyOnceWith(false);
            expect(labels(provider.getItems("#foo"))).toEqual(["foo"]);
            await settle();

            expect(source.provideWorkspaceSymbols).toHaveBeenCalledTimes(1);
        });

        it("trailing spaces are the same filter: no new request", async () => {
            const { provider, features } = setup();
            const source = answering([symbol("foo")]);
            features.workspaceSymbolProvider.register(source);

            provider.getItems("#foo");
            await settle();
            provider.getItems("#foo ");
            await settle();

            expect(source.provideWorkspaceSymbols).toHaveBeenCalledTimes(1);
        });

        it("the previous rows stay until the new answer", async () => {
            const { provider, features } = setup();
            features.workspaceSymbolProvider.register({
                provideWorkspaceSymbols: (query) => Promise.resolve([symbol(`${query}Result`)]),
            });

            provider.getItems("#a");
            await settle();
            expect(labels(provider.getItems("#ab"))).toEqual(["aResult"]);
            await settle();
            expect(labels(provider.getItems("#ab"))).toEqual(["abResult"]);
        });

        it("closing cancels what is pending and forgets the rows", async () => {
            const { provider, features, refresh } = setup();
            const source = answering([symbol("foo")]);
            features.workspaceSymbolProvider.register(source);
            refresh.mockClear();

            provider.getItems("#foo");
            provider.onHide();
            await settle();
            expect(source.provideWorkspaceSymbols).not.toHaveBeenCalled();
            expect(refresh).not.toHaveBeenCalled();

            provider.onShow(refresh);
            provider.getItems("#foo");
            await settle();
            expect(labels(provider.getItems("#foo"))).toEqual(["foo"]);
            provider.onHide();
            provider.onShow(refresh);
            expect(provider.getItems("#foo")).toEqual([]);
        });

        it("only the first word goes to the server, the rest narrows by container and path", async () => {
            const { provider, features } = setup();
            const source = answering([
                symbol("foo", { containerName: "Klass" }),
                symbol("foo", { location: { uri: "file:///w/src/other.ts" } }),
            ]);
            features.workspaceSymbolProvider.register(source);

            provider.getItems("#foo klass");
            await settle();

            expect(vi.mocked(source.provideWorkspaceSymbols).mock.calls[0][0]).toBe("foo");
            expect(provider.getItems("#foo klass").map((item) => item.description)).toEqual(["Klass • src/a.ts"]);
        });

        it("an empty query asks the providers too", async () => {
            const { provider, features } = setup();
            const source = answering([symbol("foo")]);
            features.workspaceSymbolProvider.register(source);

            provider.getItems("#");
            await settle();

            expect(vi.mocked(source.provideWorkspaceSymbols).mock.calls[0][0]).toBe("");
            expect(labels(provider.getItems("#"))).toEqual(["foo"]);
        });
    });

    describe("the rows", () => {
        async function rowsFor(symbols: readonly ICoreWorkspaceSymbol[], query = "#"): Promise<QuickAccessItem[]> {
            const { provider, features } = setup();
            features.workspaceSymbolProvider.register(answering(symbols));
            provider.getItems(query);
            await settle();
            return provider.getItems(query);
        }

        it("icon of the kind, the name, `container • path` relative to the workspace", async () => {
            const [row] = await rowsFor([symbol("Foo", { kind: SymbolKind.Class, containerName: "ns" })]);
            expect(row.icon).toBe(NERD_FONT_ICONS.codicon("symbol-class"));
            expect(row.label).toBe("Foo");
            expect(row.description).toBe("ns • src/a.ts");
        });

        it("no container: just the path; outside the workspace: absolute; not a file: the whole uri", async () => {
            const rows = await rowsFor([
                symbol("a"),
                symbol("b", { location: { uri: "file:///elsewhere/b.ts" } }),
                symbol("c", { location: { uri: "jdt://contents/C.class" } }),
            ]);
            expect(rows.map((row) => row.description)).toEqual([
                "src/a.ts",
                "/elsewhere/b.ts",
                "jdt://contents/C.class",
            ]);
        });

        it("match ranges on the name; a deprecated symbol is labelled and has none", async () => {
            const rows = await rowsFor([symbol("foo"), symbol("fob", { tags: [SymbolTagDeprecated] })], "#fo");
            const plain = rows.find((row) => row.label === "foo");
            const deprecated = rows.find((row) => row.label === "fob (deprecated)");
            expect(plain?.labelMatchRanges).toEqual([[0, 2]]);
            expect(deprecated).toBeDefined();
            expect(deprecated?.labelMatchRanges).toBeUndefined();
        });

        it("what does not match the query is out, whatever the server said", async () => {
            expect(labels(await rowsFor([symbol("foo"), symbol("bar")], "#foo"))).toEqual(["foo"]);
        });

        it("sorted by score, then name ignoring case, then the kind's icon", async () => {
            const rows = await rowsFor([
                symbol("zeta"),
                symbol("alpha", { kind: SymbolKind.Variable }),
                symbol("Alpha", { kind: SymbolKind.Class }),
                symbol("beta"),
            ]);
            expect(rows.map((row) => row.label)).toEqual(["Alpha", "alpha", "beta", "zeta"]);

            const tied = await rowsFor([
                symbol("alpha", { kind: SymbolKind.Class }),
                symbol("Alpha", { kind: SymbolKind.Variable }),
            ]);
            expect(tied.map((row) => row.icon)).toEqual([
                NERD_FONT_ICONS.codicon("symbol-class"),
                NERD_FONT_ICONS.codicon("symbol-variable"),
            ]);

            // By name `afoo` would go first: the score decides, whichever way the answer came.
            const scored = ["foo", "afoo"].map((name) => symbol(name));
            expect(labels(await rowsFor(scored, "#foo"))).toEqual(["foo", "afoo"]);
            expect(labels(await rowsFor([...scored].reverse(), "#foo"))).toEqual(["foo", "afoo"]);
        });
    });

    describe("nothing to show", () => {
        it("no providers: a row says so, and a late registration asks again", async () => {
            const { provider, features, refresh } = setup();
            expect(labels(provider.getItems("#foo"))).toEqual(["No workspace symbol providers"]);

            features.workspaceSymbolProvider.register(answering([symbol("foo")]));
            expect(refresh).toHaveBeenCalledWith(false);
            provider.getItems("#foo");
            await settle();
            expect(labels(provider.getItems("#foo"))).toEqual(["foo"]);
        });

        it("after closing a registration is no longer listened to", () => {
            const { provider, features, refresh } = setup();
            provider.onHide();
            features.workspaceSymbolProvider.register(answering([]));
            expect(refresh).not.toHaveBeenCalled();
        });

        it("an empty answer: a row for a non-empty query, an empty list for an empty one", async () => {
            const { provider, features } = setup();
            features.workspaceSymbolProvider.register(answering([]));

            provider.getItems("#foo");
            await settle();
            const [row] = provider.getItems("#foo");
            expect(row.label).toBe("No matching workspace symbols");
            expect(row.accept).toBeUndefined();

            provider.getItems("#");
            await settle();
            expect(provider.getItems("#")).toEqual([]);
        });

        it("a failing provider counts as empty, the others still answer", async () => {
            const { provider, features } = setup();
            features.workspaceSymbolProvider.register({
                provideWorkspaceSymbols: () => Promise.reject(new Error("boom")),
            });
            features.workspaceSymbolProvider.register(answering([symbol("foo")]));

            provider.getItems("#foo");
            await settle();
            expect(labels(provider.getItems("#foo"))).toEqual(["foo"]);
        });
    });

    describe("accept", () => {
        // A failure of the open goes here: nothing but the failing case below may reach it.
        const unexpected = vi.fn<(error: unknown) => void>();

        beforeEach(() => {
            unexpected.mockClear();
            setUnexpectedErrorHandler(unexpected);
        });

        afterEach(() => {
            setUnexpectedErrorHandler((error) => {
                console.error(error);
            });
            expect(unexpected).not.toHaveBeenCalled();
        });

        it("a failing open is reported, not left as an unhandled rejection", async () => {
            const { provider, features, openUri } = setup({});
            openUri.mockImplementation(() => Promise.reject(new Error("boom")));
            features.workspaceSymbolProvider.register(answering([symbol("foo")]));
            provider.getItems("#");
            await settle();
            provider.getItems("#")[0].accept?.();
            await flushMicrotasks();

            expect(unexpected).toHaveBeenCalledTimes(1);
            unexpected.mockClear();
        });

        async function accept(source: WorkspaceSymbolProvider, editorUri = "/w/src/a.ts") {
            const fixture = setup({});
            fixture.features.workspaceSymbolProvider.register(source);
            fixture.provider.getItems("#");
            await settle();
            const [row] = fixture.provider.getItems("#");
            if (fixture.editor !== null) fixture.editor.uri = Uri.file(editorUri);
            row.accept?.();
            await flushMicrotasks();
            return fixture;
        }

        it("without resolve: opens the file on the start of the range, one jump", async () => {
            const { openUri, editor, jumps } = await accept(answering([symbol("foo")]));
            expect(openUri.mock.calls[0][0].toString()).toBe("file:///w/src/a.ts");
            expect(editor?.goToPosition).toHaveBeenCalledWith(3, 2);
            expect(editor?.revealRange).toHaveBeenCalledWith(createRange(3, 2, 3, 8));
            expect(jumps.count).toBe(1);
        });

        it("with resolve: the resolved location wins", async () => {
            const original = symbol("foo", { location: { uri: "file:///w/src/partial.ts" } });
            const resolveWorkspaceSymbol = vi.fn(() =>
                Promise.resolve({ uri: "file:///w/src/a.ts", range: createRange(9, 1, 9, 4) }),
            );
            const { openUri, editor } = await accept({
                provideWorkspaceSymbols: () => Promise.resolve([original]),
                resolveWorkspaceSymbol,
            });
            expect(vi.mocked(resolveWorkspaceSymbol).mock.calls[0]).toContain(original);
            expect(openUri.mock.calls[0][0].toString()).toBe("file:///w/src/a.ts");
            expect(editor?.goToPosition).toHaveBeenCalledWith(9, 1);
        });

        it("resolve gives nothing: the symbol's own location stands", async () => {
            const { editor } = await accept({
                provideWorkspaceSymbols: () => Promise.resolve([symbol("foo")]),
                resolveWorkspaceSymbol: () => Promise.resolve(null),
            });
            expect(editor?.goToPosition).toHaveBeenCalledWith(3, 2);
        });

        it("no range: the file opens, the cursor stays", async () => {
            const { openUri, editor } = await accept(
                answering([symbol("foo", { location: { uri: "file:///w/src/a.ts" } })]),
            );
            expect(openUri).toHaveBeenCalledTimes(1);
            expect(editor?.goToPosition).not.toHaveBeenCalled();
        });

        it("nothing is active after the open: no failure", async () => {
            const { provider, features, openUri } = setup(null);
            features.workspaceSymbolProvider.register(answering([symbol("foo")]));
            provider.getItems("#");
            await settle();
            provider.getItems("#")[0].accept?.();
            await flushMicrotasks();
            expect(openUri).toHaveBeenCalledTimes(1);
        });

        it("the file failed to open: the editor that stayed active is not moved", async () => {
            const { editor } = await accept(answering([symbol("foo")]), "/w/src/other.ts");
            expect(editor?.goToPosition).not.toHaveBeenCalled();
        });

        it.each(["http", "https"])("%s goes to the external opener, not to an editor", async (scheme) => {
            const url = `${scheme}://example.com/doc`;
            const { open, openUri, jumps } = await accept(answering([symbol("foo", { location: { uri: url } })]));
            expect(open).toHaveBeenCalledWith(url);
            expect(openUri).not.toHaveBeenCalled();
            expect(jumps.count).toBe(0);
        });
    });
});

describe("getWorkspaceSymbols", () => {
    const token = { isCancellationRequested: false } as ICancellationToken;
    const range = (line: number) => createRange(line, 0, line, 5);
    const at = (line: number) => ({ uri: "file:///a.ts", range: range(line) });

    async function run(...answers: readonly (readonly ICoreWorkspaceSymbol[])[]) {
        const features = new LanguageFeaturesService();
        for (const answer of answers) features.workspaceSymbolProvider.register(answering(answer));
        return getWorkspaceSymbols(features.workspaceSymbolProvider, "q", token);
    }

    it("the same name, kind, uri and an intersecting range from two providers is one symbol", async () => {
        const items = await run([symbol("a", { location: at(1) })], [symbol("a", { location: at(1) })]);
        expect(items).toHaveLength(1);
    });

    it("two partial symbols of the same kind of provider are one", async () => {
        const partial = symbol("a", { location: { uri: "file:///a.ts" } });
        expect(await run([partial], [partial])).toHaveLength(1);
    });

    it("another name, kind, uri, a separate range or another container is another symbol", async () => {
        const items = await run(
            [symbol("a", { location: at(1) })],
            [
                symbol("b", { location: at(1) }),
                symbol("a", { location: at(1), kind: SymbolKind.Class }),
                symbol("a", { location: { uri: "file:///b.ts", range: range(1) } }),
                symbol("a", { location: at(2) }),
                symbol("a", { location: at(1), containerName: "c" }),
            ],
        );
        expect(items).toHaveLength(6);
    });

    /** Whichever way the sort happens to compare them. */
    async function bothWays(a: ICoreWorkspaceSymbol, b: ICoreWorkspaceSymbol): Promise<ICoreWorkspaceSymbol[][]> {
        const forward = await run([a], [b]);
        const backward = await run([b], [a]);
        return [forward, backward].map((items) => items.map((item) => item.symbol));
    }

    const located = (range: ReturnType<typeof createRange>) =>
        symbol("a", { location: { uri: "file:///a.ts", range } });

    it("ranges that only touch do not intersect", async () => {
        const answers = await bothWays(located(createRange(1, 0, 1, 5)), located(createRange(1, 5, 1, 9)));
        for (const answer of answers) expect(answer).toHaveLength(2);
    });

    it("overlapping ranges that differ are the same symbol", async () => {
        const answers = await bothWays(located(createRange(1, 0, 1, 5)), located(createRange(1, 2, 1, 7)));
        for (const answer of answers) expect(answer).toHaveLength(1);
    });

    it("an empty range at the start of another is another symbol", async () => {
        const answers = await bothWays(located(createRange(1, 0, 1, 0)), located(createRange(1, 0, 1, 5)));
        for (const answer of answers) expect(answer).toHaveLength(2);
    });

    it("with a range and without one, from the same kind of provider, is one symbol", async () => {
        const partial = symbol("a", { location: { uri: "file:///a.ts" } });
        const answers = await bothWays(partial, located(createRange(1, 0, 1, 5)));
        for (const answer of answers) expect(answer).toHaveLength(1);
    });

    describe("compareItems is antisymmetric, which the sort alone does not show", () => {
        const plain = answering([]);
        const item = (range: ReturnType<typeof createRange>) => ({ symbol: located(range), provider: plain });

        it.each([
            ["separate", createRange(1, 0, 1, 5), createRange(2, 0, 2, 5)],
            ["touching", createRange(1, 0, 1, 5), createRange(1, 5, 1, 9)],
        ])("%s ranges: the earlier goes first, asked either way", (_name, earlier, later) => {
            expect(compareItems(item(earlier), item(later))).toBeLessThan(0);
            expect(compareItems(item(later), item(earlier))).toBeGreaterThan(0);
        });

        it("no range: the one that can resolve goes first, asked either way", () => {
            const partial = symbol("a", { location: { uri: "file:///a.ts" } });
            const resolving: WorkspaceSymbolProvider = { ...plain, resolveWorkspaceSymbol: vi.fn() };
            const withResolve = { symbol: partial, provider: resolving };
            const withoutResolve = { symbol: partial, provider: plain };
            expect(compareItems(withResolve, withoutResolve)).toBeLessThan(0);
            expect(compareItems(withoutResolve, withResolve)).toBeGreaterThan(0);
        });
    });

    it("the order is by name, kind, uri, then range, whichever way they came", async () => {
        const ordered = [
            symbol("a", { kind: SymbolKind.Class, location: at(1) }),
            symbol("a", { kind: SymbolKind.Class, location: at(2) }),
            symbol("a", { kind: SymbolKind.Class, location: { uri: "file:///b.ts", range: range(1) } }),
            symbol("a", { kind: SymbolKind.Function, location: at(1) }),
            symbol("b", { location: at(1) }),
        ];
        const names = async (input: readonly ICoreWorkspaceSymbol[]) => (await run(input)).map((item) => item.symbol);
        expect(await names(ordered)).toEqual(ordered);
        expect(await names([...ordered].reverse())).toEqual(ordered);
    });

    it("without a range, with and without resolve stay two symbols, the one that can resolve first", async () => {
        const features = new LanguageFeaturesService();
        const partial = symbol("a", { location: { uri: "file:///a.ts" } });
        const plain = answering([partial]);
        const resolving: WorkspaceSymbolProvider = { ...answering([partial]), resolveWorkspaceSymbol: vi.fn() };
        features.workspaceSymbolProvider.register(plain);
        features.workspaceSymbolProvider.register(resolving);

        const items = await getWorkspaceSymbols(features.workspaceSymbolProvider, "q", token);
        expect(items.map((item) => item.provider)).toEqual([resolving, plain]);

        const reversed = new LanguageFeaturesService();
        reversed.workspaceSymbolProvider.register(resolving);
        reversed.workspaceSymbolProvider.register(plain);
        const other = await getWorkspaceSymbols(reversed.workspaceSymbolProvider, "q", token);
        expect(other.map((item) => item.provider)).toEqual([resolving, plain]);
    });
});
