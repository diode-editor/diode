import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import type {
    FileSearchResult,
    IFileSearchResults,
    IFileSearchService,
    IFileSearchSession,
} from "../../../services/search/common/fileSearch.ts";
import type { QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import { FilesQuickAccessProvider } from "./filesQuickAccessProvider.ts";
import type { IGotoLineEditor } from "./gotoLineQuickAccessProvider.ts";
import type { ISymbolPickOptions, WorkspaceSymbolsQuickAccessProvider } from "./workspaceSymbolsQuickAccessProvider.ts";

function searchResult(relativePath: string, matchedIndices: number[] = []): FileSearchResult {
    const basename = relativePath.split("/").pop() ?? relativePath;
    return { relativePath, absolutePath: `/root/${relativePath}`, basename, score: 1, matchedIndices };
}

/** Sessions answer on the next microtask with `results`; the test can hold an answer back or fire a change. */
class FakeFileSearch {
    public readonly sessions: { disposed: boolean; change: Emitter<void> }[] = [];
    public readonly search = vi.fn<(query: string, max: number) => Promise<IFileSearchResults>>();

    public constructor(public results: readonly FileSearchResult[]) {
        this.search.mockImplementation(() =>
            Promise.resolve({ results: [...this.results], limitHit: false, complete: true }),
        );
    }

    public createSession(): IFileSearchSession {
        const state = { disposed: false, change: new Emitter<void>() };
        this.sessions.push(state);
        return {
            onDidChange: state.change.event,
            ready: Promise.resolve(),
            search: (query, max) => this.search(query, max),
            dispose: () => {
                state.disposed = true;
            },
        };
    }
}

interface Setup {
    readonly provider: FilesQuickAccessProvider;
    readonly search: FakeFileSearch["search"];
    readonly fileSearch: FakeFileSearch;
    readonly refresh: ReturnType<typeof vi.fn<(preserveSelection: boolean) => void>>;
    readonly opened: string[];
    readonly editor: IGotoLineEditor & { goToPosition: ReturnType<typeof vi.fn> };
    readonly removeMissing: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
    readonly jumps: string[];
}

function setup(
    options: {
        history?: readonly string[];
        results?: readonly FileSearchResult[];
        settings?: Readonly<Record<string, unknown>>;
        icons?: IProductIconService;
        symbols?: Pick<WorkspaceSymbolsQuickAccessProvider, "search" | "cancelSearch">;
        shown?: boolean;
    } = {},
): Setup {
    const fileSearch = new FakeFileSearch(options.results ?? []);
    const commands = new CommandRegistry();
    const opened: string[] = [];
    commands.register("workbench.openFile", (absolutePath: unknown) => {
        opened.push(String(absolutePath));
    });
    const editor = {
        lineCount: 100,
        primaryCursorLine: 0,
        primaryCursorColumn: 0,
        goToPosition: vi.fn(),
        focusEditor: vi.fn(),
    };
    const jumps: string[] = [];
    const recorder: IJumpRecorder = {
        jump: (navigate) => {
            jumps.push("jump");
            return navigate();
        },
        jumpAsync: (navigate) => navigate(),
    };
    const removeMissing = vi.fn(() => Promise.resolve(false));
    const workspace = new WorkspaceContextService();
    workspace.setWorkspaceFolder("/root");
    const symbols = options.symbols ?? { search: () => undefined, cancelSearch: () => undefined };
    const provider = new FilesQuickAccessProvider(
        fileSearch as unknown as IFileSearchService,
        commands,
        { getActiveEditor: () => editor },
        recorder,
        { getHistory: () => (options.history ?? []).map((p) => Uri.file(p)), removeMissing },
        createTestConfigurationService(options.settings),
        workspace,
        symbols,
        options.icons ?? NERD_FONT_ICONS,
    );
    const refresh = vi.fn<(preserveSelection: boolean) => void>();
    // Shown, as Quick Open does before the first `getItems`: the file search session lives between show and hide.
    if (options.shown !== false) provider.onShow(refresh);
    return { provider, search: fileSearch.search, fileSearch, refresh, opened, editor, removeMissing, jumps };
}

/** File rows arrive asynchronously: ask, let the answer land, ask again — as the refresh callback would. */
async function settled(provider: FilesQuickAccessProvider, query: string): Promise<QuickAccessItem[]> {
    provider.getItems(query);
    await flushMicrotasks();
    return provider.getItems(query);
}

const rowsOf = (items: readonly QuickAccessItem[]): string[] =>
    items.map((item) => (item.description ? `${item.description}/${item.label}` : item.label));

const rows = (provider: FilesQuickAccessProvider, query: string): string[] => rowsOf(provider.getItems(query));

const settledRows = async (provider: FilesQuickAccessProvider, query: string): Promise<string[]> =>
    rowsOf(await settled(provider, query));

describe("FilesQuickAccessProvider — editor history", () => {
    it("an empty query lists the whole history in MRU order and does not search", () => {
        const { provider, search } = setup({
            history: ["/root/src/deep/c.ts", "/root/a.ts", "/elsewhere/notes.md"],
            results: [searchResult("src/other.ts")],
        });

        expect(rows(provider, "")).toEqual(["src/deep/c.ts", "a.ts", "/elsewhere/notes.md"]);
        // Spaces only are still an empty query.
        expect(rows(provider, "   ")).toEqual(["src/deep/c.ts", "a.ts", "/elsewhere/notes.md"]);
        expect(search).not.toHaveBeenCalled();
        // Nothing typed, nothing highlighted.
        for (const item of provider.getItems("")) {
            expect(item.labelMatchRanges).toEqual([]);
            expect(item.descriptionMatchRanges).toEqual([]);
        }
    });

    it("an empty history with an empty query is an empty list", () => {
        const { provider } = setup({ results: [searchResult("src/other.ts")] });

        expect(provider.getItems("")).toEqual([]);
    });

    it("history rows carry the file icon, like the search rows", async () => {
        const { provider } = setup({ history: ["/root/a.ts"], results: [searchResult("b.md")] });

        const [history, file] = await settled(provider, "a");
        expect(history.icon).toBe(NERD_FONT_ICONS.fileIcon("a.ts")?.icon);
        expect(history.icon).toBeDefined();
        expect(file.icon).toBe(NERD_FONT_ICONS.fileIcon("b.md")?.icon);
    });

    it("a query puts the matching history above the search results, without repeating them", async () => {
        const { provider, search } = setup({
            history: ["/root/src/main.ts", "/root/readme.md", "/root/lib/domain.ts"],
            results: [searchResult("src/main.ts"), searchResult("src/maintenance.ts")],
        });

        expect(await settledRows(provider, "main")).toEqual(["src/main.ts", "lib/domain.ts", "src/maintenance.ts"]);
        expect(search).toHaveBeenCalledWith("main", 50);
    });

    it("without a path separator only the file name is matched, with highlights in the label", () => {
        const { provider } = setup({ history: ["/root/src/a.ts", "/root/src/b.ts"] });

        expect(rows(provider, "src")).toEqual([]);
        const [item] = provider.getItems("b.t");
        expect(item.label).toBe("b.ts");
        expect(item.labelMatchRanges).toEqual([[0, 3]]);
        expect(item.descriptionMatchRanges).toEqual([]);
    });

    it("without an icon for the file type the rows simply have none", async () => {
        const { provider } = setup({
            history: ["/root/a.ts"],
            results: [searchResult("b.md")],
            icons: { ...NERD_FONT_ICONS, fileIcon: () => undefined },
        });

        expect((await settled(provider, "a")).map((item) => item.icon)).toEqual([undefined, undefined]);
    });

    it("a path query does not match a root-level file by a separator it does not have", () => {
        const { provider } = setup({ history: ["/root/ab.ts", "/root/src/ab.ts"] });

        expect(rows(provider, "/ab")).toEqual(["src/ab.ts"]);
    });

    it("a query with a path separator matches the folder path too", () => {
        const { provider } = setup({ history: ["/root/src/a.ts", "/root/lib/b.ts"] });

        const items = provider.getItems("src/a");
        expect(items.map((item) => item.label)).toEqual(["a.ts"]);
        // The separator itself counts toward the folder part, as on the search rows.
        expect(items[0].descriptionMatchRanges).toEqual([[0, 4]]);
        expect(items[0].labelMatchRanges).toEqual([[0, 1]]);
    });

    it("sorted by relevance by default, the more recent first on a tie", () => {
        const { provider } = setup({ history: ["/root/xaxbxc.ts", "/root/abc.ts", "/root/abc.md"] });

        expect(rows(provider, "abc")).toEqual(["abc.ts", "abc.md", "xaxbxc.ts"]);
    });

    it("filterSortOrder `recency` keeps the history order while filtering", () => {
        const { provider } = setup({
            history: ["/root/xaxbxc.ts", "/root/abc.ts", "/root/zzz.ts"],
            settings: { "search.quickOpen.history.filterSortOrder": "recency" },
        });

        expect(rows(provider, "abc")).toEqual(["xaxbxc.ts", "abc.ts"]);
    });

    it("includeHistory `false` drops the history from a query, not from the empty list", async () => {
        const { provider } = setup({
            history: ["/root/src/main.ts"],
            results: [searchResult("src/main.ts")],
            settings: { "search.quickOpen.includeHistory": false },
        });

        expect(rows(provider, "")).toEqual(["src/main.ts"]);
        const items = await settled(provider, "main");
        expect(items).toHaveLength(1);
        // The search row: its highlights come from the search, not the history matcher.
        expect(items[0].labelMatchRanges).toEqual([]);
    });

    it("accepting a history row opens the file as one jump; `file:line` goes to the line", () => {
        const { provider, opened, editor, jumps } = setup({ history: ["/root/src/main.ts"] });

        provider.getItems("")[0].accept?.();
        expect(opened).toEqual(["/root/src/main.ts"]);
        expect(editor.goToPosition).not.toHaveBeenCalled();

        provider.getItems("main:12:3")[0].accept?.();
        expect(opened).toEqual(["/root/src/main.ts", "/root/src/main.ts"]);
        expect(editor.goToPosition).toHaveBeenCalledWith(11, 2);
        expect(jumps).toEqual(["jump", "jump"]);
    });

    it("showing the picker drops gone files and refreshes the list only when something dropped", async () => {
        const { provider, removeMissing } = setup({ shown: false });
        const refresh = vi.fn<(preserveSelection: boolean) => void>();

        provider.onShow(refresh);
        await flushMicrotasks();
        expect(removeMissing).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
        provider.onHide();

        removeMissing.mockResolvedValueOnce(true);
        provider.onShow(refresh);
        await flushMicrotasks();
        expect(refresh).toHaveBeenCalledWith(true);
        provider.onHide();
    });
});

describe("FilesQuickAccessProvider — search.quickOpen.includeSymbols", () => {
    const FILE = searchResult("src/foo.ts");
    const SYMBOL: QuickAccessItem = { label: "fooSymbol", accept: () => undefined };

    function symbolSetup(includeSymbols = true, results: readonly FileSearchResult[] = [FILE]) {
        const pending: ((rows: readonly QuickAccessItem[]) => void)[] = [];
        const search = vi.fn(
            (_filter: string, _options: ISymbolPickOptions, onResults: (rows: readonly QuickAccessItem[]) => void) => {
                pending.push(onResults);
            },
        );
        const cancelSearch = vi.fn();
        const { provider, refresh } = setup({
            results,
            settings: { "search.quickOpen.includeSymbols": includeSymbols },
            symbols: { search, cancelSearch },
        });
        return { provider, search, cancelSearch, refresh, pending };
    }

    it("off: no request and no group name", async () => {
        const { provider, search } = symbolSetup(false);
        const items = await settled(provider, "foo");
        expect(search).not.toHaveBeenCalled();
        expect(items.map((item) => item.hint)).toEqual([undefined]);
    });

    it("asks with skipLocal, adds the answer after the files keeping the cursor, the group name on the first row", async () => {
        const { provider, search, refresh, pending } = symbolSetup();

        const before = await settled(provider, "foo");
        refresh.mockClear();
        expect(search).toHaveBeenCalledWith("foo", { skipLocal: true }, expect.any(Function));
        expect(before.map((item) => item.hint)).toEqual(["file and symbol results"]);

        pending[0]([SYMBOL]);
        expect(refresh).toHaveBeenCalledWith(true);
        const after = provider.getItems("foo");
        expect(after.map((item) => item.label)).toEqual(["foo.ts", "fooSymbol"]);
        expect(after.map((item) => item.hint)).toEqual(["file and symbol results", undefined]);
    });

    it("no files: the group name goes on the first symbol", () => {
        const { provider, pending } = symbolSetup(true, []);
        expect(provider.getItems("foo")).toEqual([]);
        pending[0]([SYMBOL]);
        expect(provider.getItems("foo").map((item) => item.hint)).toEqual(["file and symbol results"]);
    });

    it("the same filter does not ask again, another one drops the old rows at once", async () => {
        const { provider, search, pending } = symbolSetup();
        await settled(provider, "foo");
        pending[0]([SYMBOL]);
        provider.getItems("foo");
        expect(search).toHaveBeenCalledTimes(1);

        const labels = provider.getItems("fooo").map((item) => item.label);
        expect(search).toHaveBeenCalledTimes(2);
        expect(labels).toEqual(["foo.ts"]);
    });

    it("`:line` is about files: no request, and what was asked is cancelled", async () => {
        const { provider, search, cancelSearch, pending } = symbolSetup();
        await settled(provider, "foo");
        pending[0]([SYMBOL]);
        search.mockClear();

        const items = provider.getItems("foo:12");

        expect(search).not.toHaveBeenCalled();
        expect(cancelSearch).toHaveBeenCalled();
        expect(items.map((item) => item.label)).toEqual(["foo.ts"]);
    });

    it("an empty query: only the history, no request; clearing the box cancels what was asked", () => {
        const { provider, search, cancelSearch } = symbolSetup();
        provider.getItems("");
        expect(search).not.toHaveBeenCalled();
        expect(cancelSearch).not.toHaveBeenCalled();

        provider.getItems("foo");
        provider.getItems("");
        expect(cancelSearch).toHaveBeenCalledTimes(1);
    });

    it("closing cancels and forgets the rows", async () => {
        const { provider, search, cancelSearch, pending, refresh } = symbolSetup();
        await settled(provider, "foo");
        pending[0]([SYMBOL]);
        provider.onHide();
        expect(cancelSearch).toHaveBeenCalled();

        provider.onShow(refresh);
        expect((await settled(provider, "foo")).map((item) => item.label)).toEqual(["foo.ts"]);
        expect(search).toHaveBeenCalledTimes(2);
    });
});

describe("FilesQuickAccessProvider — file search session", () => {
    it("each showing opens a session, hiding disposes it", () => {
        const { provider, fileSearch, refresh } = setup();
        expect(fileSearch.sessions).toHaveLength(1);
        provider.onHide();
        expect(fileSearch.sessions[0].disposed).toBe(true);

        provider.onShow(refresh);
        expect(fileSearch.sessions).toHaveLength(2);
        expect(fileSearch.sessions[1].disposed).toBe(false);
    });

    it("the answer lands with refresh(true), keeping the cursor", async () => {
        const { provider, refresh } = setup({ results: [searchResult("src/main.ts")] });

        expect(rows(provider, "main")).toEqual([]);
        await flushMicrotasks();

        expect(refresh).toHaveBeenCalledWith(true);
        expect(rows(provider, "main")).toEqual(["src/main.ts"]);
    });

    it("the same filter asks once; the refresh it causes does not ask again", async () => {
        const { provider, search } = setup({ results: [searchResult("a.ts")] });
        await settled(provider, "a");
        provider.getItems("a");
        expect(search).toHaveBeenCalledTimes(1);
        expect(search).toHaveBeenCalledWith("a", 50);
    });

    it("the previous rows stay until the next answer arrives", async () => {
        const { provider, fileSearch } = setup({ results: [searchResult("alpha.ts")] });
        await settled(provider, "al");

        fileSearch.results = [searchResult("alpine.ts")];
        expect(rows(provider, "alp")).toEqual(["alpha.ts"]);
        await flushMicrotasks();
        expect(rows(provider, "alp")).toEqual(["alpine.ts"]);
    });

    it("a late answer to an older filter is dropped", async () => {
        const { provider, search } = setup();
        let answerOld!: (r: IFileSearchResults) => void;
        search.mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)));
        search.mockImplementationOnce(() =>
            Promise.resolve({ results: [searchResult("new.ts")], limitHit: false, complete: true }),
        );

        provider.getItems("old");
        provider.getItems("new");
        await flushMicrotasks();
        answerOld({ results: [searchResult("old.ts")], limitHit: false, complete: true });
        await flushMicrotasks();

        expect(rows(provider, "new")).toEqual(["new.ts"]);
    });

    it("one query at a time: filters typed meanwhile collapse into the latest, sent once the answer lands", async () => {
        const { provider, search } = setup();
        let answerFirst!: (r: IFileSearchResults) => void;
        let answerLatest!: (r: IFileSearchResults) => void;
        search.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
        search.mockImplementationOnce(() => new Promise((resolve) => (answerLatest = resolve)));

        provider.getItems("a");
        provider.getItems("ab");
        provider.getItems("abc");
        expect(search.mock.calls.map(([query]) => query)).toEqual(["a"]);

        answerFirst({ results: [searchResult("a.ts")], limitHit: false, complete: true });
        await flushMicrotasks();

        expect(search.mock.calls.map(([query]) => query)).toEqual(["a", "abc"]);
        // The answer for "a" never landed: the box already said "abc".
        expect(rows(provider, "abc")).toEqual([]);
        answerLatest({ results: [searchResult("abc.ts")], limitHit: false, complete: true });
        await flushMicrotasks();
        expect(rows(provider, "abc")).toEqual(["abc.ts"]);
    });

    it("index growth during a query asks once more after it, not once per growth", async () => {
        const { provider, search, fileSearch } = setup({ results: [searchResult("a.ts")] });
        let answerFirst!: (r: IFileSearchResults) => void;
        search.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
        provider.getItems("a");
        for (let i = 0; i < 3; i++) {
            fileSearch.sessions[0].change.fire();
            // What the refresh does.
            provider.getItems("a");
        }
        expect(search).toHaveBeenCalledTimes(1);

        answerFirst({ results: [searchResult("a.ts")], limitHit: false, complete: true });
        await flushMicrotasks();
        expect(search).toHaveBeenCalledTimes(2);
    });

    it("isLoading: from typing until the answer for that text lands; growth under the same text does not count", async () => {
        const { provider, fileSearch } = setup({ results: [searchResult("a.ts")] });
        expect(provider.isLoading).toBe(false);
        provider.getItems("a");
        expect(provider.isLoading).toBe(true);
        await flushMicrotasks();
        expect(provider.isLoading).toBe(false);

        fileSearch.sessions[0].change.fire();
        expect(provider.isLoading).toBe(false);

        provider.getItems("ab");
        expect(provider.isLoading).toBe(true);
        // Back to an empty box: only the history shows, there is nothing to wait for.
        provider.getItems("  ");
        expect(provider.isLoading).toBe(false);
    });

    it("isLoading: an empty answer while the walk goes on still waits; a partial non-empty one or a finished walk does not", async () => {
        const { provider, search } = setup();
        search.mockResolvedValueOnce({ results: [], limitHit: false, complete: false });
        provider.getItems("a");
        await flushMicrotasks();
        expect(provider.isLoading).toBe(true);

        search.mockResolvedValueOnce({ results: [searchResult("ab.ts")], limitHit: false, complete: false });
        provider.getItems("ab");
        await flushMicrotasks();
        expect(provider.isLoading).toBe(false);

        search.mockResolvedValueOnce({ results: [], limitHit: false, complete: true });
        provider.getItems("abc");
        await flushMicrotasks();
        expect(provider.isLoading).toBe(false);
    });

    it("isLoading is false while hidden", () => {
        const { provider } = setup({ shown: false });
        provider.getItems("a");
        expect(provider.isLoading).toBe(false);
    });

    it("hiding a picker that was never shown is a no-op", () => {
        const { provider, fileSearch } = setup({ shown: false });
        expect(() => {
            provider.onHide();
        }).not.toThrow();
        expect(fileSearch.sessions).toEqual([]);
    });

    it("showing again without a hide disposes the previous session", () => {
        const { provider, fileSearch, refresh } = setup();
        provider.onShow(refresh);
        expect(fileSearch.sessions.map((s) => s.disposed)).toEqual([true, false]);
    });

    it("the box emptied while a query ran: the history shows and nothing is asked after the answer", async () => {
        const { provider, search, fileSearch } = setup({ results: [searchResult("a.ts")] });
        let answerFirst!: (r: IFileSearchResults) => void;
        search.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
        provider.getItems("a");
        // The index grows (the filter is forgotten), and the refresh it causes comes with an empty box.
        fileSearch.sessions[0].change.fire();
        provider.getItems("ab");
        fileSearch.sessions[0].change.fire();
        provider.getItems("");

        answerFirst({ results: [searchResult("a.ts")], limitHit: false, complete: true });
        await flushMicrotasks();

        expect(search).toHaveBeenCalledTimes(1);
    });

    it("an answer arriving after hiding is dropped", async () => {
        const { provider, search, refresh } = setup();
        let answer!: (r: IFileSearchResults) => void;
        search.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
        provider.getItems("main");
        provider.onHide();

        answer({ results: [searchResult("src/main.ts")], limitHit: false, complete: true });
        await flushMicrotasks();

        expect(refresh).not.toHaveBeenCalled();
    });

    it("a grown index refreshes keeping the cursor, and the refresh re-asks the current query", async () => {
        const { provider, fileSearch, search, refresh } = setup({ results: [searchResult("a.ts")] });
        await settled(provider, "a");
        refresh.mockClear();

        fileSearch.results = [searchResult("a.ts"), searchResult("ab.ts")];
        fileSearch.sessions[0].change.fire();
        expect(refresh).toHaveBeenCalledWith(true);

        // The refresh's `getItems` keeps the old rows until the new answer lands.
        expect(rows(provider, "a")).toEqual(["a.ts"]);
        await flushMicrotasks();
        expect(search).toHaveBeenCalledTimes(2);
        expect(rows(provider, "a")).toEqual(["a.ts", "ab.ts"]);
    });

    it("a grown index before anything was typed asks nothing", () => {
        const { fileSearch, search } = setup();
        fileSearch.sessions[0].change.fire();
        expect(search).not.toHaveBeenCalled();
    });

    it("hidden: no session, so a query has no file rows and asks nobody", async () => {
        const { provider, search } = setup({ results: [searchResult("a.ts")], shown: false });
        expect(await settledRows(provider, "a")).toEqual([]);
        expect(search).not.toHaveBeenCalled();
    });

    it("reopening forgets the previous showing's rows and filter", async () => {
        const { provider, refresh, search } = setup({ results: [searchResult("a.ts")] });
        await settled(provider, "a");
        provider.onHide();
        provider.onShow(refresh);

        expect(rows(provider, "a")).toEqual([]);
        await flushMicrotasks();
        expect(search).toHaveBeenCalledTimes(2);
    });
});
