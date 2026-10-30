import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { charMask } from "../../../../base/common/fuzzySearch.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import type { FileSearchResult, IFileSearchService } from "../../../services/search/common/fileSearch.ts";

import { FilesQuickAccessProvider } from "./filesQuickAccessProvider.ts";
import type { IGotoLineEditor } from "./gotoLineQuickAccessProvider.ts";

function searchResult(relativePath: string, matchedIndices: number[] = []): FileSearchResult {
    const basename = relativePath.split("/").pop() ?? relativePath;
    return {
        entry: {
            relativePath,
            absolutePath: `/root/${relativePath}`,
            basename,
            basenameLower: basename.toLowerCase(),
            relativePathLower: relativePath.toLowerCase(),
            basenameBits: charMask(basename.toLowerCase()),
            relativePathBits: charMask(relativePath.toLowerCase()),
        },
        score: 1,
        matchedIndices,
    };
}

interface Setup {
    readonly provider: FilesQuickAccessProvider;
    readonly search: ReturnType<typeof vi.fn<(query: string, max?: number) => FileSearchResult[]>>;
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
    } = {},
): Setup {
    const search = vi.fn((_query: string, _max?: number) => [...(options.results ?? [])]);
    const fileSearch = {
        search,
        refreshIfStale: () => undefined,
        onIndexChanged: new Emitter<void>().event,
    } as unknown as IFileSearchService;
    const commands = new CommandRegistry();
    const opened: string[] = [];
    commands.register("workbench.openFile", (absolutePath: unknown) => {
        opened.push(String(absolutePath));
    });
    const editor = { lineCount: 100, primaryCursorLine: 0, primaryCursorColumn: 0, goToPosition: vi.fn() };
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
    const provider = new FilesQuickAccessProvider(
        fileSearch,
        commands,
        { getActiveEditor: () => editor },
        recorder,
        { getHistory: () => (options.history ?? []).map((p) => Uri.file(p)), removeMissing },
        createTestConfigurationService(options.settings),
        workspace,
        options.icons ?? NERD_FONT_ICONS,
    );
    return { provider, search, opened, editor, removeMissing, jumps };
}

const rows = (provider: FilesQuickAccessProvider, query: string): string[] =>
    provider.getItems(query).map((item) => (item.description ? `${item.description}/${item.label}` : item.label));

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

    it("history rows carry the file icon, like the search rows", () => {
        const { provider } = setup({ history: ["/root/a.ts"], results: [searchResult("b.md")] });

        const [history, file] = provider.getItems("a");
        expect(history.icon).toBe(NERD_FONT_ICONS.fileIcon("a.ts")?.icon);
        expect(history.icon).toBeDefined();
        expect(file.icon).toBe(NERD_FONT_ICONS.fileIcon("b.md")?.icon);
    });

    it("a query puts the matching history above the search results, without repeating them", () => {
        const { provider, search } = setup({
            history: ["/root/src/main.ts", "/root/readme.md", "/root/lib/domain.ts"],
            results: [searchResult("src/main.ts"), searchResult("src/maintenance.ts")],
        });

        expect(rows(provider, "main")).toEqual(["src/main.ts", "lib/domain.ts", "src/maintenance.ts"]);
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

    it("without an icon for the file type the rows simply have none", () => {
        const { provider } = setup({
            history: ["/root/a.ts"],
            results: [searchResult("b.md")],
            icons: { ...NERD_FONT_ICONS, fileIcon: () => undefined },
        });

        expect(provider.getItems("a").map((item) => item.icon)).toEqual([undefined, undefined]);
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

    it("includeHistory `false` drops the history from a query, not from the empty list", () => {
        const { provider } = setup({
            history: ["/root/src/main.ts"],
            results: [searchResult("src/main.ts")],
            settings: { "search.quickOpen.includeHistory": false },
        });

        expect(rows(provider, "")).toEqual(["src/main.ts"]);
        const items = provider.getItems("main");
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
        const { provider, removeMissing } = setup();
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
