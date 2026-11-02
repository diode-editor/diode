import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type {
    DocumentSymbolProvider,
    ICoreDocumentSymbol,
} from "../../../../editor/common/languages/iDocumentSymbolSource.ts";
import { SymbolKind, SymbolTagDeprecated } from "../../../../editor/common/languages/symbolKinds.ts";
import type { IExternalDecorations } from "../../../../editor/common/model/iEditorDecoration.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import type { QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import {
    flattenDocumentSymbols,
    GotoSymbolQuickAccessProvider,
    type IGotoSymbolEditor,
} from "./gotoSymbolQuickAccessProvider.ts";

function symbol(
    name: string,
    kind: number,
    range: IRange,
    extra: Partial<ICoreDocumentSymbol> = {},
): ICoreDocumentSymbol {
    return { name, detail: "", kind, tags: [], range, selectionRange: range, children: [], ...extra };
}

/** `class Foo` (lines 0-9) with `paint` and `layout`, then `function paintAll`. */
const TREE: readonly ICoreDocumentSymbol[] = [
    symbol("paintAll", SymbolKind.Function, createRange(20, 0, 25, 1), {
        selectionRange: createRange(20, 9, 20, 17),
    }),
    symbol("Foo", SymbolKind.Class, createRange(0, 0, 9, 1), {
        selectionRange: createRange(0, 6, 0, 9),
        children: [
            symbol("paint", SymbolKind.Method, createRange(1, 4, 3, 5), {
                selectionRange: createRange(1, 4, 1, 9),
            }),
            symbol("layout", SymbolKind.Method, createRange(5, 4, 8, 5), {
                selectionRange: createRange(5, 4, 5, 10),
            }),
        ],
    }),
];

interface IFixture {
    readonly provider: GotoSymbolQuickAccessProvider;
    readonly features: LanguageFeaturesService;
    readonly editor: IGotoSymbolEditor;
    readonly decorations: IExternalDecorations[];
    readonly refresh: ReturnType<typeof vi.fn<(preserveSelection: boolean) => void>>;
    readonly jump: ReturnType<typeof vi.fn>;
    readonly goToPosition: ReturnType<typeof vi.fn<(line: number, character?: number) => void>>;
    readonly restoreCollapsedFolds: ReturnType<typeof vi.fn<(startLines: readonly number[]) => void>>;
    readonly revealRangeNearBottom: ReturnType<typeof vi.fn<(range: IRange) => void>>;
}

function makeFixture(activeEditor = true, cursor = createCursorSelection(6, 2)): IFixture {
    const features = new LanguageFeaturesService();
    const decorations: IExternalDecorations[] = [];
    const goToPosition = vi.fn<(line: number, character?: number) => void>();
    const revealRangeNearBottom = vi.fn<(range: IRange) => void>();
    const restoreCollapsedFolds = vi.fn<(startLines: readonly number[]) => void>();
    const viewState = {
        scrollTop: 3,
        selections: [cursor] as readonly ISelection[],
        primaryCursorLine: cursor.active.line,
        primaryCursorColumn: cursor.active.character,
        revealRangeNearBottom,
        getCollapsedFolds: () => [10],
        restoreCollapsedFolds,
        goToPosition,
    };
    const editor: IGotoSymbolEditor = {
        uri: Uri.file("/w/a.ts"),
        languageId: "typescript",
        versionId: 7,
        viewState,
        setDecorations: (value) => {
            decorations.push(value);
        },
    };
    const jump = vi.fn((navigate: () => unknown) => navigate());
    const provider = new GotoSymbolQuickAccessProvider(
        { getActiveEditor: () => (activeEditor ? editor : null) },
        features,
        { jump, jumpAsync: vi.fn() } as unknown as IJumpRecorder,
    );
    const refresh = vi.fn<(preserveSelection: boolean) => void>();
    return {
        provider,
        features,
        editor,
        decorations,
        refresh,
        jump,
        goToPosition,
        revealRangeNearBottom,
        restoreCollapsedFolds,
    };
}

function registerProvider(fixture: IFixture, answer: readonly ICoreDocumentSymbol[] = TREE): DocumentSymbolProvider {
    const provider: DocumentSymbolProvider = {
        provideDocumentSymbols: vi.fn(() => Promise.resolve(answer)),
    };
    fixture.features.documentSymbolProvider.register({ language: "typescript" }, provider);
    return provider;
}

async function show(fixture: IFixture): Promise<void> {
    fixture.provider.onShow(fixture.refresh);
    await flushMicrotasks();
}

const labels = (items: readonly QuickAccessItem[]): string[] => items.map((item) => item.label);

describe("flattenDocumentSymbols", () => {
    it("goes in document order, with the parent's name as the container, unless the symbol has its own", () => {
        const flat = flattenDocumentSymbols([
            ...TREE,
            symbol("own", SymbolKind.Variable, createRange(30, 0, 30, 1), { containerName: "elsewhere" }),
        ]);
        expect(flat.map((entry) => [entry.name, entry.containerName])).toEqual([
            ["Foo", ""],
            ["paint", "Foo"],
            ["layout", "Foo"],
            ["paintAll", ""],
            ["own", "elsewhere"],
        ]);
    });

    it("at one start the longer range goes first, and names are trimmed", () => {
        const flat = flattenDocumentSymbols([
            symbol("short", SymbolKind.Variable, createRange(1, 0, 1, 2)),
            symbol("  long ", SymbolKind.Variable, createRange(1, 0, 4, 0)),
        ]);
        expect(flat.map((entry) => entry.name)).toEqual(["long", "short"]);
    });
});

describe("GotoSymbolQuickAccessProvider — messages", () => {
    it("the placeholder is upstream's", () => {
        expect(makeFixture().provider.getPlaceholder()).toBe("Type the name of a symbol to go to.");
    });

    it("before the first show: the no-editor row", () => {
        expect(labels(makeFixture().provider.getItems("@"))).toEqual([
            "To go to a symbol, first open a text editor with symbol information.",
        ]);
    });

    it("a late provider reloads once and refreshes without keeping the selection", () => {
        const fixture = makeFixture();
        fixture.provider.onShow(fixture.refresh);
        const pending: DocumentSymbolProvider = {
            provideDocumentSymbols: vi.fn(() => new Promise<never>(() => undefined)),
        };
        fixture.features.documentSymbolProvider.register({ language: "typescript" }, pending);
        expect(fixture.refresh).toHaveBeenCalledExactlyOnceWith(false);

        fixture.features.documentSymbolProvider.register({ language: "typescript" }, pending);
        expect(fixture.refresh).toHaveBeenCalledTimes(1);
    });

    it("no editor: a single informational row", async () => {
        const fixture = makeFixture(false);
        await show(fixture);
        const items = fixture.provider.getItems("@");
        expect(labels(items)).toEqual(["To go to a symbol, first open a text editor with symbol information."]);
        expect(items[0].accept).toBeUndefined();
    });

    it("an editor without a provider says so, and picks up a provider registered later", async () => {
        const fixture = makeFixture();
        await show(fixture);
        expect(labels(fixture.provider.getItems("@"))).toEqual([
            "The active text editor does not provide symbol information.",
        ]);

        fixture.features.documentSymbolProvider.register(
            { language: "python" },
            {
                provideDocumentSymbols: () => Promise.resolve(TREE),
            },
        );
        expect(fixture.refresh).not.toHaveBeenCalled();

        registerProvider(fixture);
        expect(labels(fixture.provider.getItems("@"))).toEqual([]);
        await flushMicrotasks();
        expect(fixture.refresh).toHaveBeenCalledWith(false);
        expect(labels(fixture.provider.getItems("@"))).toEqual(["Foo", "paint", "layout", "paintAll"]);
    });

    it("a provider registered after the picker closed asks nothing", async () => {
        const fixture = makeFixture();
        await show(fixture);
        fixture.provider.onHide("cancel");
        const late = registerProvider(fixture);
        await flushMicrotasks();
        expect(late.provideDocumentSymbols).not.toHaveBeenCalled();
    });

    it("an empty answer and an unmatched filter have their own rows", async () => {
        const empty = makeFixture();
        registerProvider(empty, []);
        await show(empty);
        expect(labels(empty.provider.getItems("@"))).toEqual(["No editor symbols"]);
        expect(labels(empty.provider.getItems("@zzz"))).toEqual(["No matching editor symbols"]);

        const unmatched = makeFixture();
        registerProvider(unmatched);
        await show(unmatched);
        expect(labels(unmatched.provider.getItems("@zzz"))).toEqual(["No matching editor symbols"]);
        expect(labels(unmatched.provider.getItems("@:zzz"))).toEqual(["No matching editor symbols"]);
    });
});

describe("GotoSymbolQuickAccessProvider — request", () => {
    let fixture: IFixture;
    beforeEach(() => {
        fixture = makeFixture();
    });

    it("asks once per show, filtering does not ask again, and the list is empty until the answer", async () => {
        const source = registerProvider(fixture);
        fixture.provider.onShow(fixture.refresh);
        expect(fixture.provider.getItems("@")).toEqual([]);
        expect(fixture.refresh).not.toHaveBeenCalled();

        await flushMicrotasks();
        expect(fixture.refresh).toHaveBeenCalledWith(false);
        fixture.provider.getItems("@p");
        fixture.provider.getItems("@pa");
        expect(source.provideDocumentSymbols).toHaveBeenCalledTimes(1);
        expect(source.provideDocumentSymbols).toHaveBeenCalledWith(
            { uri: Uri.file("/w/a.ts").toString(), languageId: "typescript", versionId: 7 },
            expect.anything(),
        );
    });

    it("takes the first provider with a non-empty answer; a failing one counts as empty", async () => {
        const first = fixture.features.documentSymbolProvider.register(
            { language: "typescript" },
            {
                provideDocumentSymbols: () =>
                    Promise.resolve([symbol("older", SymbolKind.Class, createRange(0, 0, 1, 0))]),
            },
        );
        const failing = { provideDocumentSymbols: vi.fn(() => Promise.reject(new Error("boom"))) };
        const empty = { provideDocumentSymbols: vi.fn(() => Promise.resolve([])) };
        fixture.features.documentSymbolProvider.register({ language: "typescript" }, failing);
        fixture.features.documentSymbolProvider.register({ language: "typescript" }, empty);
        fixture.provider.onShow(fixture.refresh);
        await vi.waitFor(() => {
            expect(fixture.refresh).toHaveBeenCalled();
        });
        expect(empty.provideDocumentSymbols).toHaveBeenCalled();
        expect(failing.provideDocumentSymbols).toHaveBeenCalled();
        expect(labels(fixture.provider.getItems("@"))).toEqual(["older"]);
        first.dispose();
    });

    it("an answer arriving after hide is dropped and the request is cancelled", async () => {
        let resolve: (value: readonly ICoreDocumentSymbol[]) => void = () => undefined;
        let cancelled: { isCancellationRequested: boolean } | undefined;
        fixture.features.documentSymbolProvider.register(
            { language: "typescript" },
            {
                provideDocumentSymbols: (_request, token) => {
                    cancelled = token;
                    return new Promise((done) => {
                        resolve = done;
                    });
                },
            },
        );
        fixture.provider.onShow(fixture.refresh);
        await flushMicrotasks();
        fixture.provider.onHide("cancel");
        expect(cancelled?.isCancellationRequested).toBe(true);
        resolve(TREE);
        await flushMicrotasks();
        expect(fixture.refresh).not.toHaveBeenCalled();
    });
});

describe("GotoSymbolQuickAccessProvider — rows", () => {
    let fixture: IFixture;
    beforeEach(async () => {
        fixture = makeFixture();
        registerProvider(fixture);
        await show(fixture);
    });

    it("without a query: document order, icon by kind, container in the description, count on the first row", () => {
        const items = fixture.provider.getItems("@");
        expect(labels(items)).toEqual(["Foo", "paint", "layout", "paintAll"]);
        expect(items.map((item) => item.description)).toEqual([undefined, "Foo", "Foo", undefined]);
        expect(items.map((item) => item.hint)).toEqual(["symbols (4)", undefined, undefined, undefined]);
        expect(items[1].icon).toBeTruthy();
        expect(items[1].icon).not.toBe(items[0].icon);
        expect(items[1].icon).toBe(items[2].icon);
        expect(items[1].labelMatchRanges).toBeUndefined();
    });

    it("a query filters by name, best score first, with match ranges and the count of what is left", () => {
        const items = fixture.provider.getItems("@paint");
        expect(labels(items)).toEqual(["paint", "paintAll"]);
        expect(items[0].labelMatchRanges).toEqual([[0, 5]]);
        expect(items[0].hint).toBe("symbols (2)");
        expect(items[0].description).toBe("Foo");
        expect(items[0].descriptionMatchRanges).toEqual([]);
    });

    it("the better match goes first, wherever it stands in the document", async () => {
        const later = makeFixture();
        registerProvider(later, [
            symbol("xpxaxixnxt", SymbolKind.Function, createRange(1, 0, 1, 10)),
            symbol("paint", SymbolKind.Function, createRange(5, 0, 5, 5)),
        ]);
        await show(later);
        expect(labels(later.provider.getItems("@paint"))).toEqual(["paint", "xpxaxixnxt"]);
    });

    it("two words: a better container adds to the score", async () => {
        const twins = makeFixture();
        registerProvider(twins, [
            symbol("paint", SymbolKind.Method, createRange(1, 0, 1, 5), { containerName: "xfxoxo" }),
            symbol("paint", SymbolKind.Method, createRange(5, 0, 5, 5), { containerName: "foo" }),
        ]);
        await show(twins);
        expect(twins.provider.getItems("@paint foo").map((item) => item.description)).toEqual(["foo", "xfxoxo"]);
    });

    it("equal scores keep document order", async () => {
        const twins = makeFixture();
        registerProvider(twins, [
            symbol("twin", SymbolKind.Variable, createRange(5, 0, 5, 4), { detail: "second" }),
            symbol("twin", SymbolKind.Variable, createRange(1, 0, 1, 4), { containerName: "first" }),
        ]);
        await show(twins);
        expect(twins.provider.getItems("@twin").map((item) => item.description)).toEqual(["first", undefined]);
    });

    it("two words: the first is the symbol, the second its container", () => {
        const items = fixture.provider.getItems("@paint foo");
        expect(labels(items)).toEqual(["paint"]);
        expect(items[0].descriptionMatchRanges).toEqual([[0, 3]]);
        expect(fixture.provider.getItems("@paint   foo")[0].descriptionMatchRanges).toEqual([[0, 3]]);
        expect(labels(fixture.provider.getItems("@paint oo f"))).toEqual(["paint"]);
        expect(labels(fixture.provider.getItems("@paint bar"))).toEqual(["No matching editor symbols"]);
    });

    it("a symbol without a container does not match a two-word query", () => {
        expect(labels(fixture.provider.getItems("@paintAll x"))).toEqual(["No matching editor symbols"]);
    });

    it("the whole query may match the name, spaces included", async () => {
        const heading = makeFixture();
        registerProvider(heading, [
            symbol("change log", SymbolKind.String, createRange(0, 0, 0, 10)),
            symbol("other", SymbolKind.String, createRange(1, 0, 1, 5)),
        ]);
        await show(heading);
        const items = heading.provider.getItems("@change log");
        expect(labels(items)).toEqual(["change log"]);
        expect(items[0].labelMatchRanges).toEqual([[0, 10]]);
    });

    it("the query is trimmed", () => {
        expect(labels(fixture.provider.getItems("@  layout  "))).toEqual(["layout"]);
    });

    it("a deprecated symbol says so in its label and has no highlights", async () => {
        const old = makeFixture();
        registerProvider(old, [
            symbol("old", SymbolKind.Function, createRange(0, 0, 1, 0), { tags: [SymbolTagDeprecated] }),
        ]);
        await show(old);
        const [item] = old.provider.getItems("@old");
        expect(item.label).toBe("old (deprecated)");
        expect(item.labelMatchRanges).toBeUndefined();
    });
});

describe("GotoSymbolQuickAccessProvider — @: groups", () => {
    it("sorted by group name, then score, each run counted on its first row", async () => {
        const fixture = makeFixture();
        registerProvider(fixture);
        await show(fixture);

        const items = fixture.provider.getItems("@:");
        expect(labels(items)).toEqual(["Foo", "paintAll", "paint", "layout"]);
        expect(items.map((item) => item.hint)).toEqual(["classes (1)", "functions (1)", "methods (2)", undefined]);
    });

    it("the `:` is not part of the filter", async () => {
        const fixture = makeFixture();
        registerProvider(fixture);
        await show(fixture);

        const items = fixture.provider.getItems("@:paint");
        expect(labels(items)).toEqual(["paintAll", "paint"]);
        expect(labels(fixture.provider.getItems("@: paint"))).toEqual(["paintAll", "paint"]);
        expect(items[1].hint).toBe("methods (1)");
    });

    it("Null and Property share a name but not a run", async () => {
        const fixture = makeFixture();
        registerProvider(fixture, [
            symbol("nil", SymbolKind.Null, createRange(0, 0, 0, 1)),
            symbol("prop", SymbolKind.Property, createRange(1, 0, 1, 1)),
        ]);
        await show(fixture);
        expect(fixture.provider.getItems("@:").map((item) => item.hint)).toEqual(["properties (1)", "properties (1)"]);
    });
});

describe("GotoSymbolQuickAccessProvider — starting row", () => {
    it("the last symbol around the cursor, only once and only without a query", async () => {
        const fixture = makeFixture();
        registerProvider(fixture);
        await show(fixture);
        const items = fixture.provider.getItems("@");
        expect(fixture.provider.getInitialActiveIndex(items, "@")).toBe(2);
        expect(fixture.provider.getInitialActiveIndex(items, "@")).toBeUndefined();
    });

    it("waits for the answer: the empty loading list does not use it up", async () => {
        const fixture = makeFixture();
        registerProvider(fixture);
        fixture.provider.onShow(fixture.refresh);
        expect(fixture.provider.getInitialActiveIndex([], "@")).toBeUndefined();
        await flushMicrotasks();
        expect(fixture.provider.getInitialActiveIndex(fixture.provider.getItems("@"), "@")).toBe(2);
    });

    it("a query keeps the first row, and so does a cursor outside every symbol", async () => {
        const typed = makeFixture();
        registerProvider(typed);
        await show(typed);
        expect(typed.provider.getInitialActiveIndex(typed.provider.getItems("@o"), "@o")).toBeUndefined();

        const outside = makeFixture(true, createCursorSelection(15, 0));
        registerProvider(outside);
        await show(outside);
        expect(outside.provider.getInitialActiveIndex(outside.provider.getItems("@"), "@")).toBeUndefined();
    });

    it("the very first row can be the starting one", async () => {
        const fixture = makeFixture(true, createCursorSelection(4, 0));
        registerProvider(fixture);
        await show(fixture);
        expect(fixture.provider.getInitialActiveIndex(fixture.provider.getItems("@"), "@")).toBe(0);
    });

    it("no editor: nothing to enclose", async () => {
        const fixture = makeFixture(false);
        await show(fixture);
        expect(fixture.provider.getInitialActiveIndex(fixture.provider.getItems("@"), "@")).toBeUndefined();
    });
});

describe("GotoSymbolQuickAccessProvider — preview and return", () => {
    let fixture: IFixture;
    let items: QuickAccessItem[];
    beforeEach(async () => {
        fixture = makeFixture();
        registerProvider(fixture);
        await show(fixture);
        items = fixture.provider.getItems("@");
    });

    it("the active row is revealed and its name's line lit, the selection untouched", () => {
        fixture.provider.onActiveItemChanged(items[1]);
        expect(fixture.revealRangeNearBottom).toHaveBeenCalledWith(createRange(1, 4, 1, 9));
        expect(fixture.decorations).toEqual([
            { lineBackgrounds: [{ startLine: 1, endLine: 1, colorToken: "editor.rangeHighlightBackground" }] },
        ]);
        expect(fixture.goToPosition).not.toHaveBeenCalled();
    });

    it("every preview, cancel and accept put back the folds the picker found, before moving on", () => {
        fixture.provider.onActiveItemChanged(items[1]);
        expect(fixture.restoreCollapsedFolds).toHaveBeenCalledExactlyOnceWith([10]);
        expect(fixture.restoreCollapsedFolds.mock.invocationCallOrder[0]).toBeLessThan(
            fixture.revealRangeNearBottom.mock.invocationCallOrder[0],
        );

        fixture.provider.onHide("accept");
        expect(fixture.restoreCollapsedFolds).toHaveBeenCalledTimes(2);
    });

    it("cancel puts the folds back too", () => {
        fixture.provider.onHide("cancel");
        expect(fixture.restoreCollapsedFolds).toHaveBeenCalledExactlyOnceWith([10]);
    });

    it("an informational row or none previews nothing", () => {
        fixture.provider.onActiveItemChanged({ label: "No editor symbols" });
        fixture.provider.onActiveItemChanged(undefined);
        expect(fixture.revealRangeNearBottom).not.toHaveBeenCalled();
        expect(fixture.decorations).toEqual([]);
    });

    it("cancel restores the scroll and the selections and removes the highlight", () => {
        const { viewState } = fixture.editor;
        const before = viewState.selections;
        fixture.provider.onActiveItemChanged(items[3]);
        viewState.scrollTop = 40;
        viewState.selections = [createCursorSelection(1, 1)];

        fixture.provider.onHide("cancel");
        expect(viewState.scrollTop).toBe(3);
        expect(viewState.selections).toEqual(before);
        expect(fixture.decorations.at(-1)).toEqual({});
    });

    it("hiding on accept keeps the view and removes the highlight", () => {
        const { viewState } = fixture.editor;
        fixture.provider.onActiveItemChanged(items[3]);
        viewState.scrollTop = 40;

        fixture.provider.onHide("accept");
        expect(viewState.scrollTop).toBe(40);
        expect(fixture.decorations.at(-1)).toEqual({});
    });

    it("accept lands on the start of the selection range inside a jump, after the hide let go of the editor", () => {
        fixture.provider.onHide("accept");
        items[3].accept?.();
        expect(fixture.jump).toHaveBeenCalledTimes(1);
        expect(fixture.goToPosition).toHaveBeenCalledWith(20, 9);
    });

    it("a row built after the hide has no editor to move", () => {
        fixture.provider.onHide("cancel");
        fixture.provider.getItems("@")[0].accept?.();
        expect(fixture.goToPosition).not.toHaveBeenCalled();
    });

    it("after hide a late active row previews nothing, and a repeated hide restores nothing", () => {
        const { viewState } = fixture.editor;
        fixture.provider.onHide("cancel");
        fixture.provider.onActiveItemChanged(items[0]);
        expect(fixture.revealRangeNearBottom).not.toHaveBeenCalled();
        viewState.scrollTop = 99;
        fixture.provider.onHide("cancel");
        expect(viewState.scrollTop).toBe(99);
    });
});
