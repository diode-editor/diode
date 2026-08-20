import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
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
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import { SEARCH_VIEW_MODE_STATE } from "../../../common/stateKeys.ts";
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
        NULL_JUMP_RECORDER,
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

    it("по умолчанию — строка запроса и «···», include/exclude скрыты (заголовок SEARCH рисует pane-header)", () => {
        const component = make(fakeSearch([]).service, fakeExplorer(ROOT));
        const screen = render(component).screenToString();
        expect(screen).toContain("Search");
        expect(screen).toContain("···");
        expect(screen).not.toContain("files to include");
        expect(screen).not.toContain("files to exclude");
    });

    it("toggleQueryDetails раскрывает include/exclude с пустой строкой между ними и скрывает обратно", () => {
        const component = make(fakeSearch([]).service, fakeExplorer(ROOT));
        // Кнопка «···» — тот же тумблер мышью (4-я кнопка после Aa/\b/.*).
        const detailsBtn = (component.view.querySelectorAll("ButtonElement") as ButtonElement[])[3];
        detailsBtn.onActivate?.();
        expect(component.isQueryDetailsShown()).toBe(true);
        const screen = render(component).screenToString();
        expect(screen).toContain("files to include");
        expect(screen).toContain("files to exclude");

        component.toggleQueryDetails();
        expect(component.isQueryDetailsShown()).toBe(false);
        expect(render(component).screenToString()).not.toContain("files to include");
    });

    it("инпуты не прижаты к краям: слева и справа от строки запроса по колонке отступа", () => {
        const component = make(fakeSearch([]).service, fakeExplorer(ROOT));
        const lines = render(component).screenToString().split("\n");
        const queryLine = lines.find((line) => line.includes("Search"))!;
        expect(queryLine.startsWith(" ")).toBe(true);
        expect(queryLine.endsWith(" ")).toBe(true);
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
        component.toggleQueryDetails(true, false); // include/exclude в дереве только раскрытыми
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

    describe("list/tree view modes", () => {
        const twoFiles = () => [
            fileMatch("/work/project/a.ts", [
                [12, "const ", "foo", " = 1"],
                [20, "", "foo", ""],
            ]),
            fileMatch("/work/project/b.ts", [[3, "let ", "foo", ""]]),
        ];

        const nestedFiles = () => [
            fileMatch("/work/project/src/x/a.ts", [
                [12, "const ", "foo", " = 1"],
                [20, "", "foo", ""],
            ]),
            fileMatch("/work/project/src/y/b.ts", [[3, "let ", "foo", ""]]),
        ];

        it("typing letters in the results list does not typeahead-jump between groups", () => {
            const component = make(fakeSearch(twoFiles()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            // Курсор на первой строке (file:a.ts); буква «b» не должна прыгать на b.ts.
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "b" }));
            expect(component.results.inspectState()).toMatchObject({ cursorId: "file:a.ts" });
        });

        it("list-режим (дефолт): матчи сворачиваются под файл-строкой", () => {
            const component = make(fakeSearch(twoFiles()).service, fakeExplorer(ROOT));
            expect(component.getViewMode()).toBe("list");
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

        it("tree-режим строит иерархию каталогов без нового rg; файлы — basename", () => {
            const { service } = fakeSearch(nestedFiles());
            const spy = vi.spyOn(service, "search");
            const component = make(service, fakeExplorer(ROOT));
            typeQuery(component, "foo");

            component.setViewMode("tree");
            expect(spy).toHaveBeenCalledTimes(1); // rg не перезапускался
            // src(1) + x(1) + a.ts(1) + 2 матча + y(1) + b.ts(1) + 1 матч = 8 строк.
            expect(component.results.contentHeight).toBe(8);
            const screen = render(component).screenToString();
            expect(screen).toContain("src");
            expect(screen).toContain("a.ts");
            expect(screen).not.toContain("src/x/a.ts");

            // Сворачивание папки прячет всё поддерево.
            component.results.toggleCollapsed("dir:src");
            expect(component.results.contentHeight).toBe(1);
        });

        it("tree-режим: одиночные цепочки папок компактируются в одну строку", () => {
            const component = make(
                fakeSearch([fileMatch("/work/project/deep/nested/dir/c.ts", [[1, "", "foo", ""]])]).service,
                fakeExplorer(ROOT),
            );
            typeQuery(component, "foo");
            component.setViewMode("tree");
            // Одна папка-цепочка + файл + матч.
            expect(component.results.contentHeight).toBe(3);
            expect(render(component).screenToString()).toContain("deep/nested/dir");
        });

        it("Enter на папке сворачивает её поддерево", () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            component.setViewMode("tree");
            component.results.setCursorTo("dir:src");
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
            expect(component.results.isCollapsed("dir:src")).toBe(true);
        });

        it("стрим в tree-режиме пересобирает строки по троттлу", () => {
            const { service: state } = fakeState();
            const component = make(fakeSearch(nestedFiles()).service, fakeExplorer(ROOT), { state });
            component.setViewMode("tree");
            typeQuery(component, "foo");
            // Результаты уже в модели, но пересборка ждёт троттл.
            expect(component.results.contentHeight).toBe(0);
            vi.advanceTimersByTime(100);
            expect(component.results.contentHeight).toBe(8);
        });

        it("завершение поиска флашит отложенную пересборку дерева, не дожидаясь троттла", async () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeExplorer(ROOT));
            component.setViewMode("tree");
            typeQuery(component, "foo");
            expect(component.results.contentHeight).toBe(0); // троттл ещё ждёт

            // Микротаски: complete-промис синхронного fakeSearch уже зарезолвлен.
            await Promise.resolve();
            await Promise.resolve();
            expect(component.results.contentHeight).toBe(8);
        });

        it("новый поиск отменяет отложенную пересборку дерева прежнего", () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeExplorer(ROOT));
            component.setViewMode("tree");
            typeQuery(component, "foo");
            expect(component.results.contentHeight).toBe(0); // троттл первого поиска ждёт

            // Тумблер перезапускает поиск синхронно (без дебаунса) — cancelSearch
            // снимает ждущий троттл, второй поиск планирует свой.
            const [caseBtn] = component.view.querySelectorAll("ButtonElement") as ButtonElement[];
            caseBtn.onActivate?.();
            vi.advanceTimersByTime(100);
            expect(component.results.contentHeight).toBe(8); // строки второго поиска, без дублей
        });

        it("свёрнутость и курсор переживают смену режима по стабильным id", () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            component.results.toggleCollapsed("file:src/x/a.ts");
            component.results.setCursorTo("file:src/y/b.ts");

            component.setViewMode("tree");
            expect(component.results.isCollapsed("file:src/x/a.ts")).toBe(true);
            expect(component.results.inspectState()).toMatchObject({ cursorId: "file:src/y/b.ts" });

            component.setViewMode("list");
            expect(component.results.isCollapsed("file:src/x/a.ts")).toBe(true);
            expect(component.results.inspectState()).toMatchObject({ cursorId: "file:src/y/b.ts" });
        });

        it("миграция v2 стейта: любое старое значение (tree/flat) приводится к list", () => {
            expect(SEARCH_VIEW_MODE_STATE.version).toBe(2);
            expect(SEARCH_VIEW_MODE_STATE.migrate?.("tree", 0)).toBe("list");
            expect(SEARCH_VIEW_MODE_STATE.migrate?.("flat", 1)).toBe("list");
        });

        it("свёрнутая папка дерева при уходе в list теряет свёрнутость молча (id умер)", () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            component.setViewMode("tree");
            component.results.toggleCollapsed("dir:src");
            expect(component.results.contentHeight).toBe(1);

            component.setViewMode("list"); // dir:-строк больше нет — их collapse отбрасывается
            expect(component.results.contentHeight).toBe(5);
        });

        it("setViewMode persists to workspace state; same mode is a no-op", () => {
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch([]).service, fakeExplorer(ROOT), { state });
            component.setViewMode("tree");
            expect(stored.get("workbench.search.viewMode")).toBe("tree");

            stored.clear();
            component.setViewMode("tree");
            expect(stored.size).toBe(0);
        });

        it("restoreViewState reads the store without writing back", () => {
            const { service: state, stored } = fakeState();
            stored.set("workbench.search.viewMode", "tree");
            const component = make(fakeSearch(twoFiles()).service, fakeExplorer(ROOT), { state });
            // Конструктор уже прочитал tree; вернём list и проверим restore.
            component.setViewMode("list");
            stored.set("workbench.search.viewMode", "tree");
            const writes = vi.spyOn(state, "store");

            component.restoreViewState();
            expect(component.getViewMode()).toBe("tree");
            expect(writes).not.toHaveBeenCalled();

            component.restoreViewState(); // повтор — no-op
            expect(component.getViewMode()).toBe("tree");
        });

        it("toggleQueryDetails: write-through, фокус в include при раскрытии и в query при скрытии", () => {
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch([]).service, fakeExplorer(ROOT), { state });
            const inputs = () => component.view.querySelectorAll("InputElement") as InputElement[];

            const queryFocus = vi.spyOn(inputs()[0], "focus");
            component.toggleQueryDetails();
            expect(stored.get("workbench.search.queryDetailsExpanded")).toBe(true);
            const includeFocus = vi.spyOn(inputs()[1], "focus");
            expect(includeFocus).not.toHaveBeenCalled();

            component.toggleQueryDetails(true); // повтор show=true — только фокус
            expect(includeFocus).toHaveBeenCalled();

            component.toggleQueryDetails();
            expect(stored.get("workbench.search.queryDetailsExpanded")).toBe(false);
            expect(queryFocus).toHaveBeenCalled();
        });

        it("restoreViewState раскрывает детали из стора или при непустых полях, без write-through", () => {
            const { service: state, stored } = fakeState();
            stored.set("workbench.search.queryDetailsExpanded", true);
            const component = make(fakeSearch([]).service, fakeExplorer(ROOT), { state });
            expect(component.isQueryDetailsShown()).toBe(true);

            // Скрыли; в сторе false. Непустой exclude заставляет restore раскрыть.
            component.toggleQueryDetails(false, false);
            const exclude = component.view.querySelectorAll("InputElement");
            expect(exclude).toHaveLength(1); // остался только query
            const writes = vi.spyOn(state, "store");
            const excludeField = (component as unknown as { excludeInput: InputElement }).excludeInput;
            excludeField.inputState.value = "dist";
            component.restoreViewState();
            expect(component.isQueryDetailsShown()).toBe(true);
            expect(writes).not.toHaveBeenCalled();
        });

        it("сетит data-ключ searchViewMode при создании, переключении и restore", () => {
            const keys = new ContextKeyService();
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch([]).service, fakeExplorer(ROOT), { contextKeys: keys, state });
            expect(keys.get("searchViewMode")).toBe("list");

            component.setViewMode("tree");
            expect(keys.get("searchViewMode")).toBe("tree");

            component.setViewMode("list");
            stored.set("workbench.search.viewMode", "tree");
            component.restoreViewState();
            expect(keys.get("searchViewMode")).toBe("tree");
        });
    });

    describe("Collapse All / Expand All (поэтапный CollapseDeepestExpandedLevel)", () => {
        const nested = () => [
            fileMatch("/work/project/src/x/a.ts", [
                [12, "const ", "foo", " = 1"],
                [20, "", "foo", ""],
            ]),
            fileMatch("/work/project/src/y/b.ts", [[3, "let ", "foo", ""]]),
        ];

        it("в tree-режиме: первый вызов сворачивает матчи под файлами, второй — всё дерево", () => {
            const component = make(fakeSearch(nested()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            component.setViewMode("tree");
            expect(component.results.contentHeight).toBe(8);

            component.collapseDeepestLevel();
            // Папки раскрыты, файлы свёрнуты: src, x, a.ts, y, b.ts.
            expect(component.results.contentHeight).toBe(5);
            expect(component.results.isCollapsed("file:src/x/a.ts")).toBe(true);
            expect(component.results.isCollapsed("dir:src")).toBe(false);

            component.collapseDeepestLevel();
            expect(component.results.contentHeight).toBe(1); // только dir:src

            component.collapseDeepestLevel(); // уже всё свёрнуто — no-op
            expect(component.results.contentHeight).toBe(1);
        });

        it("в list-режиме сворачивает файл-строки; expandAll возвращает всё", () => {
            const component = make(fakeSearch(nested()).service, fakeExplorer(ROOT));
            typeQuery(component, "foo");
            expect(component.results.contentHeight).toBe(5);

            component.collapseDeepestLevel();
            expect(component.results.contentHeight).toBe(2);

            component.expandAll();
            expect(component.results.contentHeight).toBe(5);
        });

        it("сетит data-ключи hasSearchResult/viewHasSomeCollapsibleResult (дебаунс)", () => {
            const keys = new ContextKeyService();
            const component = make(fakeSearch(nested()).service, fakeExplorer(ROOT), { contextKeys: keys });
            expect(keys.get("hasSearchResult")).toBe(false);
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(false);

            typeQuery(component, "foo");
            vi.advanceTimersByTime(100); // дебаунс пересчёта ключей
            expect(keys.get("hasSearchResult")).toBe(true);
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(true);

            component.collapseDeepestLevel(); // list: все файлы свёрнуты — раскрытых не осталось
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(false);
            expect(keys.get("hasSearchResult")).toBe(true);

            component.expandAll();
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(true);
        });

        it("сворачивание строки пользователем дёргает пересчёт ключей через onCollapsedChanged", () => {
            const keys = new ContextKeyService();
            const component = make(fakeSearch(nested()).service, fakeExplorer(ROOT), { contextKeys: keys });
            typeQuery(component, "foo");
            component.results.toggleCollapsed("file:src/x/a.ts");
            component.results.toggleCollapsed("file:src/y/b.ts");
            vi.advanceTimersByTime(100);
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(false);
        });
    });

    describe("кольцо фокуса (Down/Up между инпутами и списком)", () => {
        function makeFocusable(withDetails: boolean): { component: SearchComponent; app: TestApp } {
            const component = make(fakeSearch([fileMatch("/work/project/a.ts", [[1, "", "foo", ""]])]).service, fakeExplorer(ROOT));
            if (withDetails) component.toggleQueryDetails(true, false);
            const app = TestApp.createWithContent(component.view, new Size(40, 14));
            return { component, app };
        }

        it("детали скрыты: query → список; список → query (инпуты за «···» пропускаются)", () => {
            const { component, app } = makeFocusable(false);
            component.focus();
            component.focusNextInputBox();
            expect(app.focusedElement).toBe(component.results);

            component.focusSearchFromResults();
            expect(app.focusedElement?.id).toBe(queryInput(component).id);
            expect(component.isInputBoxFocused(app.focusedElement)).toBe(true);
        });

        it("детали раскрыты: query → include → exclude → список; обратно exclude → include → query", () => {
            const { component, app } = makeFocusable(true);
            const [query, include, exclude] = component.view.querySelectorAll("InputElement") as InputElement[];

            component.focus();
            component.focusNextInputBox();
            expect(app.focusedElement).toBe(include);
            component.focusNextInputBox();
            expect(app.focusedElement).toBe(exclude);
            component.focusNextInputBox();
            expect(app.focusedElement).toBe(component.results);

            component.focusSearchFromResults();
            expect(app.focusedElement).toBe(exclude);
            component.focusPreviousInputBox();
            expect(app.focusedElement).toBe(include);
            component.focusPreviousInputBox();
            expect(app.focusedElement).toBe(query);
            component.focusPreviousInputBox(); // верх кольца — no-op
            expect(app.focusedElement).toBe(query);
        });

        it("вызов кольца без фокуса в инпутах — no-op (не перетягивает фокус)", () => {
            const { component, app } = makeFocusable(false);
            component.results.focus();
            component.focusNextInputBox();
            expect(app.focusedElement).toBe(component.results);
        });

        it("isFirstResultFocused: только активный список с курсором на первой строке", () => {
            const { component } = makeFocusable(false);
            (component as unknown as { queryInput: InputElement }).queryInput.inputState.value = "foo";
            typeQuery(component, "foo");

            expect(component.isFirstResultFocused(component.results)).toBe(true); // курсор на file:a.ts
            component.results.setCursorTo("match:a.ts:0");
            expect(component.isFirstResultFocused(component.results)).toBe(false);
            expect(component.isFirstResultFocused(null)).toBe(false);
        });
    });

    it("containsFocus/isInputBoxFocused — по корню view и трём инпутам", () => {
        const component = make(fakeSearch([]).service, fakeExplorer(ROOT));
        component.toggleQueryDetails(true, false);
        const [query, include] = component.view.querySelectorAll("InputElement") as InputElement[];

        expect(component.containsFocus(query)).toBe(true);
        expect(component.containsFocus(component.results)).toBe(true);
        expect(component.containsFocus(null)).toBe(false);

        expect(component.isInputBoxFocused(query)).toBe(true);
        expect(component.isInputBoxFocused(include)).toBe(true);
        expect(component.isInputBoxFocused(component.results)).toBe(false);
        expect(component.isInputBoxFocused(null)).toBe(false);
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
            NULL_JUMP_RECORDER,
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
