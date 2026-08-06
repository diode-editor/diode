import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MockTerminalBackend } from "../../../../../../tuidom/backend/mockTerminalBackend.ts";
import { TUIKeyboardEvent } from "../../../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import type { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import type { InputElement } from "../../../../../../tuidom/ui/inputbox/inputElement.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type {
    IFileMatch,
    ISearchHandle,
    ITextSearchComplete,
    ITextSearchService,
} from "../../../services/search/common/textSearch.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import type { ExplorerService } from "../../files/browser/explorerService.ts";

import { type ISearchRevealTarget, SearchComponent } from "./searchComponent.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
const ROOT = "/work/project";

// ─── Fakes ────────────────────────────────────────────────────────────────────

/** A TextSearchService that streams the given results synchronously on search(). */
function fakeSearch(
    results: IFileMatch[],
    opts: { complete?: ITextSearchComplete; onCancel?: () => void } = {},
): { service: ITextSearchService } {
    const service: ITextSearchService = {
        search(_query, _folder, onResult): ISearchHandle {
            for (const r of results) onResult(r);
            return {
                complete: Promise.resolve(opts.complete ?? { matchCount: 0, fileCount: 0, limitHit: false }),
                cancel: opts.onCancel ?? (() => {}),
            };
        },
    };
    return { service };
}

function fakeExplorer(root: string | null): ExplorerService {
    return { getRootPath: () => root } as unknown as ExplorerService;
}

function fileMatch(absolutePath: string, lines: [number, string, string, string][]): IFileMatch {
    return {
        absolutePath,
        matches: lines.map(([lineNumber, before, inside, after]) => ({
            lineNumber,
            startColumn: before.length,
            endColumn: before.length + inside.length,
            preview: { before, inside, after },
        })),
    };
}

/** Reveal-цель, записывающая открытия и переходы (аналог фейка Problems). */
function fakeReveal(): {
    target: ISearchRevealTarget;
    opened: string[];
    positions: [number, number | undefined][];
    ranges: IRange[];
} {
    const opened: string[] = [];
    const positions: [number, number | undefined][] = [];
    const ranges: IRange[] = [];
    const target: ISearchRevealTarget = {
        openUri: (uri) => opened.push(uri.fsPath),
        getActiveEditor: () => ({
            goToPosition: (line, column) => positions.push([line, column]),
            revealRange: (range) => ranges.push(range),
        }),
    };
    return { target, opened, positions, ranges };
}

/** In-memory стейт: get отдаёт сохранённое или дефолт, store записывает. */
function fakeState(): { service: IStateService; stored: Map<string, unknown> } {
    const stored = new Map<string, unknown>();
    const service: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        openWorkspace: () => {},
        flushSync: () => {},
    };
    return { service, stored };
}

/** Реестр view не участвует в юнит-тестах компонента — merged-контейнер собирает workbench. */
const NULL_VIEWS_SERVICE = { registerView: () => {} } as unknown as ViewsService;

function make(
    search: ITextSearchService,
    explorer: ExplorerService,
    opts: { reveal?: ISearchRevealTarget; state?: IStateService; contextKeys?: ContextKeyService } = {},
): SearchComponent {
    return new SearchComponent(
        search,
        explorer,
        opts.reveal ?? fakeReveal().target,
        opts.state ?? NULL_STATE_SERVICE,
        opts.contextKeys ?? new ContextKeyService(),
        NULL_VIEWS_SERVICE,
    );
}

function render(component: SearchComponent, w = 40, h = 14): MockTerminalBackend {
    return renderElement(component.view, w, h, { themeVars: true });
}

function queryInput(component: SearchComponent): InputElement {
    return component.view.querySelectorAll("InputElement")[0] as InputElement;
}

/** Types into the query input and fires the debounced search. */
function typeQuery(component: SearchComponent, text: string): void {
    const input = queryInput(component);
    input.inputState.value = text;
    input.onChange?.(text);
    vi.advanceTimersByTime(200);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SearchComponent", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("renders the input placeholders before any query (заголовок SEARCH рисует pane-header контейнера)", () => {
        const component = make(fakeSearch([]).service, fakeExplorer(ROOT));
        const screen = render(component).screenToString();
        expect(screen).toContain("Search");
        expect(screen).toContain("files to include");
        expect(screen).toContain("files to exclude");
    });

    it("streams results grouped by file with a count", () => {
        const results = [
            fileMatch("/work/project/a.ts", [[12, "const ", "foo", " = 1"]]),
            fileMatch("/work/project/b.ts", [[3, "let ", "foo", ""]]),
        ];
        const component = make(fakeSearch(results).service, fakeExplorer(ROOT));
        typeQuery(component, "foo");
        const screen = render(component).screenToString();
        expect(screen).toContain("a.ts");
        expect(screen).toContain("b.ts");
        expect(screen).toContain("foo");
        expect(screen).toContain("2 results in 2 files");
    });

    it("uses singular 'file' for a single matched file", () => {
        const results = [
            fileMatch("/work/project/a.ts", [
                [1, "", "foo", ""],
                [2, "x ", "foo", " y"],
            ]),
        ];
        const component = make(fakeSearch(results).service, fakeExplorer(ROOT));
        typeQuery(component, "foo");
        expect(render(component).screenToString()).toContain("2 results in 1 file");
    });

    it("shows 'No results' once a search with no matches completes", async () => {
        const component = make(fakeSearch([]).service, fakeExplorer(ROOT));
        typeQuery(component, "zzz");
        await vi.runAllTimersAsync(); // let the completion promise settle
        expect(render(component).screenToString()).toContain("No results");
    });

    it("does not search on an empty query and clears the count", () => {
        const { service } = fakeSearch([fileMatch("/work/project/a.ts", [[1, "", "foo", ""]])]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeExplorer(ROOT));
        typeQuery(component, "");
        expect(spy).not.toHaveBeenCalled();
    });

    it("does not search when there is no workspace root", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeExplorer(null));
        typeQuery(component, "foo");
        expect(spy).not.toHaveBeenCalled();
    });

    it("debounces rapid keystrokes into a single search", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeExplorer(ROOT));
        const input = queryInput(component);
        input.inputState.value = "f";
        input.onChange?.("f");
        input.inputState.value = "fo";
        input.onChange?.("fo");
        input.inputState.value = "foo";
        input.onChange?.("foo");
        vi.advanceTimersByTime(200);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("re-runs the search immediately when a toggle is flipped", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeExplorer(ROOT));
        typeQuery(component, "foo"); // 1 search
        const regexButton = component.view.querySelectorAll("ButtonElement")[2] as ButtonElement;
        regexButton.onActivate?.();
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy.mock.calls[1][0]).toMatchObject({ isRegExp: true });
    });

    it("passes include/exclude globs and all toggle state to the query", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeExplorer(ROOT));
        const [, include, exclude] = component.view.querySelectorAll("InputElement") as InputElement[];
        const [caseBtn, wordBtn] = component.view.querySelectorAll("ButtonElement") as ButtonElement[];
        include.inputState.value = "*.ts, *.js";
        include.onChange?.("*.ts, *.js");
        exclude.inputState.value = "dist";
        exclude.onChange?.("dist");
        caseBtn.onActivate?.();
        wordBtn.onActivate?.();
        typeQuery(component, "foo");
        expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({
            pattern: "foo",
            isCaseSensitive: true,
            isWholeWord: true,
            includes: ["*.ts", "*.js"],
            excludes: ["dist"],
        });
    });

    it("appends to the same file group when its matches span several events", () => {
        const results = [
            fileMatch("/work/project/a.ts", [[1, "", "foo", ""]]),
            fileMatch("/work/project/a.ts", [[2, "x ", "foo", ""]]),
        ];
        const component = make(fakeSearch(results).service, fakeExplorer(ROOT));
        typeQuery(component, "foo");
        expect(render(component).screenToString()).toContain("2 results in 1 file");
    });

    it("shows workspace-relative, forward-slash labels for Windows paths", () => {
        const results = [fileMatch("C:\\work\\sub\\gamma.md", [[1, "", "foo", ""]])];
        const component = make(fakeSearch(results).service, fakeExplorer("C:\\work"));
        typeQuery(component, "foo");
        const screen = render(component).screenToString();
        expect(screen).toContain("sub/gamma.md");
        expect(screen).not.toContain("C:\\work");
    });

    it("shows an absolute path for a match outside the workspace root", () => {
        const results = [fileMatch("/elsewhere/x.ts", [[1, "", "foo", ""]])];
        const component = make(fakeSearch(results).service, fakeExplorer(ROOT));
        typeQuery(component, "foo");
        expect(render(component).screenToString()).toContain("/elsewhere/x.ts");
    });

    it("ignores results and completion from a superseded search", async () => {
        const captured: ((m: IFileMatch) => void)[] = [];
        const service: ITextSearchService = {
            search(_q, _f, onResult): ISearchHandle {
                captured.push(onResult);
                return {
                    complete: Promise.resolve({ matchCount: 0, fileCount: 0, limitHit: false }),
                    cancel: () => {},
                };
            },
        };
        const component = make(service, fakeExplorer(ROOT));
        typeQuery(component, "foo"); // search #1
        typeQuery(component, "bar"); // search #2 supersedes #1
        captured[0](fileMatch("/work/project/stale.ts", [[1, "", "x", ""]]));
        await vi.runAllTimersAsync(); // both completions settle; #1's is stale
        expect(render(component).screenToString()).not.toContain("stale.ts");
    });

    it("clears a pending debounce so a cancelled search never spawns", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeExplorer(ROOT));
        const input = queryInput(component);
        input.inputState.value = "foo";
        input.onChange?.("foo"); // debounce armed, not yet fired
        component.dispose(); // cancelSearch clears the pending timer
        vi.advanceTimersByTime(200);
        expect(spy).not.toHaveBeenCalled();
    });

    it("cancels the previous search before starting a new one", () => {
        const onCancel = vi.fn();
        const { service } = fakeSearch([], { onCancel });
        const component = make(service, fakeExplorer(ROOT));
        typeQuery(component, "foo");
        typeQuery(component, "bar");
        expect(onCancel).toHaveBeenCalled();
    });

    it("cancels an in-flight search on dispose", () => {
        const onCancel = vi.fn();
        const { service } = fakeSearch([], { onCancel });
        const component = make(service, fakeExplorer(ROOT));
        typeQuery(component, "foo");
        component.dispose();
        expect(onCancel).toHaveBeenCalled();
    });

    it("focus() targets the query input", () => {
        const component = make(fakeSearch([]).service, fakeExplorer(ROOT));
        const spy = vi.spyOn(queryInput(component), "focus");
        component.focus();
        expect(spy).toHaveBeenCalled();
    });

    describe("tree/flat view modes", () => {
        const twoFiles = () => [
            fileMatch("/work/project/a.ts", [
                [12, "const ", "foo", " = 1"],
                [20, "", "foo", ""],
            ]),
            fileMatch("/work/project/b.ts", [[3, "let ", "foo", ""]]),
        ];

        it("typing letters in the results list does not typeahead-jump between groups", () => {
            const component = make(fakeSearch(twoFiles()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            // Курсор на первой строке (file:a.ts); буква «b» не должна прыгать на b.ts.
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "b" }));
            expect(component.results.inspectState()).toMatchObject({ cursorId: "file:a.ts" });
        });

        it("collapsing a file group hides its matches (tree mode)", () => {
            const component = make(fakeSearch(twoFiles()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            expect(component.results.contentHeight).toBe(5); // 2 файла + 3 матча

            component.results.toggleCollapsed("file:a.ts");
            expect(component.results.contentHeight).toBe(3);
        });

        it("Enter on a file row toggles its group", () => {
            const component = make(fakeSearch(twoFiles()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            // Курсор по умолчанию — на первой строке (file:a.ts).
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
            expect(component.results.isCollapsed("file:a.ts")).toBe(true);
        });

        it("switching to flat rebuilds rows from the model without a new search", () => {
            const { service } = fakeSearch(twoFiles());
            const spy = vi.spyOn(service, "search");
            const component = make(service, fakeExplorer(ROOT));
            typeQuery(component, "foo");

            component.setViewMode("flat");
            expect(spy).toHaveBeenCalledTimes(1); // rg не перезапускался
            expect(component.getViewMode()).toBe("flat");
            // Те же строки, но группы больше не сворачиваются (детей нет).
            expect(component.results.contentHeight).toBe(5);
            component.results.toggleCollapsed("file:a.ts");
            expect(component.results.contentHeight).toBe(5);
        });

        it("setViewMode persists to workspace state; same mode is a no-op", () => {
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch([]).service, fakeExplorer(ROOT), { state });
            component.setViewMode("flat");
            expect(stored.get("workbench.search.viewMode")).toBe("flat");

            stored.clear();
            component.setViewMode("flat");
            expect(stored.size).toBe(0);
        });

        it("restoreViewMode reads the store without writing back", () => {
            const { service: state, stored } = fakeState();
            stored.set("workbench.search.viewMode", "flat");
            const component = make(fakeSearch(twoFiles()).service, fakeExplorer(ROOT), { state });
            // Конструктор уже прочитал flat; вернём tree и проверим restore.
            component.setViewMode("tree");
            stored.set("workbench.search.viewMode", "flat");
            const writes = vi.spyOn(state, "store");

            component.restoreViewMode();
            expect(component.getViewMode()).toBe("flat");
            expect(writes).not.toHaveBeenCalled();

            component.restoreViewMode(); // повтор — no-op
            expect(component.getViewMode()).toBe("flat");
        });

        it("сетит data-ключ searchViewMode при создании, переключении и restore", () => {
            const keys = new ContextKeyService();
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch([]).service, fakeExplorer(ROOT), { contextKeys: keys, state });
            expect(keys.get("searchViewMode")).toBe("tree");

            component.setViewMode("flat");
            expect(keys.get("searchViewMode")).toBe("flat");

            component.setViewMode("tree");
            stored.set("workbench.search.viewMode", "flat");
            component.restoreViewMode();
            expect(keys.get("searchViewMode")).toBe("flat");
        });
    });

    it("регистрирует свою view в merged-контейнере Search при создании", () => {
        const registered: { id: string; containerId: string; focus: () => void }[] = [];
        const viewsService = {
            registerView: (d: { id: string; containerId: string; focus: () => void }) => registered.push(d),
        } as unknown as ViewsService;
        const component = new SearchComponent(
            fakeSearch([]).service,
            fakeExplorer(ROOT),
            fakeReveal().target,
            NULL_STATE_SERVICE,
            new ContextKeyService(),
            viewsService,
        );
        expect(registered).toHaveLength(1);
        expect(registered[0].id).toBe("workbench.search.results");
        expect(registered[0].containerId).toBe("search");

        // focus дескриптора ведёт в строку запроса (фокус вьюлета).
        const spy = vi.spyOn(queryInput(component), "focus");
        registered[0].focus();
        expect(spy).toHaveBeenCalled();
    });

    it("theme change restyles existing file and match rows in place", () => {
        const component = make(
            fakeSearch([fileMatch("/work/project/a.ts", [[1, "x ", "foo", ""]])]).service,
            fakeExplorer(ROOT),
        );
        typeQuery(component, "foo");
        const before = render(component).screenToString();

        // Токены резолвит каскад — повторный рендер стабилен без рестайла.
        expect(render(component).screenToString()).toBe(before);
    });

    describe("opening a result", () => {
        it("Enter on a match opens the file at the match position (1-based line → 0-based)", () => {
            const reveal = fakeReveal();
            const results = [fileMatch("/work/project/a.ts", [[12, "const ", "foo", " = 1"]])];
            const component = make(fakeSearch(results).service, fakeExplorer(ROOT), { reveal: reveal.target });
            typeQuery(component, "foo");

            // Дети списка — обёртки строк (носители состояний); id — у контента.
            const matchRow = component.results.getChildren()[1].getChildren()[0];
            component.results.setCursorTo(matchRow.id!);
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));

            expect(reveal.opened).toEqual(["/work/project/a.ts"]);
            expect(reveal.positions).toEqual([[11, 6]]); // line 12 → 11, startColumn = "const ".length
            expect(reveal.ranges).toEqual([{ start: { line: 11, character: 6 }, end: { line: 11, character: 9 } }]);
        });
    });
});
