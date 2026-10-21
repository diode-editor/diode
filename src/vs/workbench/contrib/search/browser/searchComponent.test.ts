import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { WorkspaceId } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { SEARCH_VIEW_MODE_STATE } from "../../../common/stateKeys.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import type {
    IFileMatch,
    ISearchHandle,
    ITextSearchComplete,
    ITextSearchService,
} from "../../../services/search/common/textSearch.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { type ISearchRevealTarget, SearchComponent } from "./searchComponent.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
const ROOT = "/work/project";

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

/** The root as a raw string: the Windows path test relies on the string, and `Uri.file` would normalize it. */
function fakeWorkspace(root: string | null): IWorkspaceContextService {
    const folders = root === null ? [] : [{ uri: { fsPath: root }, name: "", index: 0 }];
    return { getWorkspace: () => ({ id: root, folders }) } as unknown as IWorkspaceContextService;
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

function fakeState(): { service: IStateService; stored: Map<string, unknown> } {
    const stored = new Map<string, unknown>();
    const openWorkspaceEmitter = new Emitter<WorkspaceId>();
    const service: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        remove: () => undefined,
        openWorkspace: (workspaceId) => {
            openWorkspaceEmitter.fire(workspaceId);
        },
        flushSync: () => {},
        dispose: () => {},
        onDidOpenWorkspace: openWorkspaceEmitter.event,
    };
    return { service, stored };
}

const NULL_VIEWS_SERVICE = { registerContainer: () => {}, registerView: () => {} } as unknown as ViewsService;

function make(
    search: ITextSearchService,
    workspace: IWorkspaceContextService,
    opts: {
        reveal?: ISearchRevealTarget;
        state?: IStateService;
        contextKeys?: ContextKeyService;
        configuration?: IConfigurationService;
    } = {},
): SearchComponent {
    return new SearchComponent(
        search,
        workspace,
        opts.reveal ?? fakeReveal().target,
        opts.state ?? NULL_STATE_SERVICE,
        opts.contextKeys ?? new ContextKeyService(),
        NULL_VIEWS_SERVICE,
        NULL_JUMP_RECORDER,
        opts.configuration ?? NULL_CONFIGURATION_SERVICE,
    );
}

function render(component: SearchComponent, w = 40, h = 14): MockTerminalBackend {
    return renderElement(component.view, w, h, { themeVars: true });
}

function queryInput(component: SearchComponent): InputElement {
    return component.view.querySelectorAll("InputElement")[0] as InputElement;
}

function typeQuery(component: SearchComponent, text: string): void {
    const input = queryInput(component);
    input.inputState.value = text;
    input.onChange?.(text);
    vi.advanceTimersByTime(200);
}

describe("SearchComponent", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("by default: the query line and '···', include/exclude hidden (the SEARCH title is drawn by pane-header)", () => {
        const component = make(fakeSearch([]).service, fakeWorkspace(ROOT));
        const screen = render(component).screenToString();
        expect(screen).toContain("Search");
        expect(screen).toContain("···");
        expect(screen).not.toContain("files to include");
        expect(screen).not.toContain("files to exclude");
    });

    it("toggleQueryDetails reveals include/exclude with a blank line between them and hides them back", () => {
        const component = make(fakeSearch([]).service, fakeWorkspace(ROOT));
        // The "···" button is the same toggle by mouse (the 4th button after Aa/\b/.*).
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

    it("inputs are not flush with the edges: one column of padding left and right of the query line", () => {
        const component = make(fakeSearch([]).service, fakeWorkspace(ROOT));
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
        const component = make(fakeSearch(results).service, fakeWorkspace(ROOT));
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
        const component = make(fakeSearch(results).service, fakeWorkspace(ROOT));
        typeQuery(component, "foo");
        expect(render(component).screenToString()).toContain("2 results in 1 file");
    });

    it("shows 'No results' once a search with no matches completes", async () => {
        const component = make(fakeSearch([]).service, fakeWorkspace(ROOT));
        typeQuery(component, "zzz");
        await vi.runAllTimersAsync(); // let the completion promise settle
        expect(render(component).screenToString()).toContain("No results");
    });

    it("does not search on an empty query and clears the count", () => {
        const { service } = fakeSearch([fileMatch("/work/project/a.ts", [[1, "", "foo", ""]])]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeWorkspace(ROOT));
        typeQuery(component, "");
        expect(spy).not.toHaveBeenCalled();
    });

    it("does not search when there is no workspace root", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeWorkspace(null));
        typeQuery(component, "foo");
        expect(spy).not.toHaveBeenCalled();
    });

    it("debounces rapid keystrokes into a single search", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeWorkspace(ROOT));
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
        const component = make(service, fakeWorkspace(ROOT));
        typeQuery(component, "foo"); // 1 search
        const regexButton = component.view.querySelectorAll("ButtonElement")[2] as ButtonElement;
        regexButton.onActivate?.();
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy.mock.calls[1][0]).toMatchObject({ isRegExp: true });
    });

    it("passes include/exclude globs and all toggle state to the query", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeWorkspace(ROOT));
        component.toggleQueryDetails(true, false); // include/exclude are in the tree only when expanded
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
            // typed field patterns match "at any depth", like upstream
            includes: ["**/*.ts/**", "**/*.ts", "**/*.js/**", "**/*.js"],
            excludes: ["**/dist/**", "**/dist"],
        });
    });

    it("settings patterns go to ripgrep together with what is typed in 'files to exclude'", () => {
        // Without this, "excluded in settings, yet visible in results": upstream content search
        // applies BOTH settings sets.
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const values: Record<string, unknown> = {
            "files.exclude": { "**/.git": true, common: true },
            "search.exclude": { "**/node_modules": true, "**/off": false },
        };
        const configuration: IConfigurationService = {
            ...NULL_CONFIGURATION_SERVICE,
            get: (key: string) => values[key] as never,
        };
        const component = make(service, fakeWorkspace(ROOT), { configuration });
        component.toggleQueryDetails(true, false);
        const [, , exclude] = component.view.querySelectorAll("InputElement") as InputElement[];
        exclude.inputState.value = "*.min.js";
        exclude.onChange?.("*.min.js");
        typeQuery(component, "foo");

        // A setting pattern goes as is (root-anchored by `buildRgArgs`),
        // a typed field pattern expands to "at any depth".
        expect(spy.mock.calls.at(-1)?.[0].excludes).toEqual([
            "**/.git",
            "common",
            "**/node_modules",
            "**/*.min.js/**",
            "**/*.min.js",
        ]);
    });

    it("appends to the same file group when its matches span several events", () => {
        const results = [
            fileMatch("/work/project/a.ts", [[1, "", "foo", ""]]),
            fileMatch("/work/project/a.ts", [[2, "x ", "foo", ""]]),
        ];
        const component = make(fakeSearch(results).service, fakeWorkspace(ROOT));
        typeQuery(component, "foo");
        expect(render(component).screenToString()).toContain("2 results in 1 file");
    });

    it("shows workspace-relative, forward-slash labels for Windows paths", () => {
        const results = [fileMatch("C:\\work\\sub\\gamma.md", [[1, "", "foo", ""]])];
        const component = make(fakeSearch(results).service, fakeWorkspace("C:\\work"));
        typeQuery(component, "foo");
        const screen = render(component).screenToString();
        expect(screen).toContain("sub/gamma.md");
        expect(screen).not.toContain("C:\\work");
    });

    it("shows an absolute path for a match outside the workspace root", () => {
        const results = [fileMatch("/elsewhere/x.ts", [[1, "", "foo", ""]])];
        const component = make(fakeSearch(results).service, fakeWorkspace(ROOT));
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
        const component = make(service, fakeWorkspace(ROOT));
        typeQuery(component, "foo"); // search #1
        typeQuery(component, "bar"); // search #2 supersedes #1
        captured[0](fileMatch("/work/project/stale.ts", [[1, "", "x", ""]]));
        await vi.runAllTimersAsync(); // both completions settle; #1's is stale
        expect(render(component).screenToString()).not.toContain("stale.ts");
    });

    it("completion of a superseded search does not end the fresh one", async () => {
        const completes: ((c: ITextSearchComplete) => void)[] = [];
        const service: ITextSearchService = {
            search(): ISearchHandle {
                return {
                    complete: new Promise((resolve) => {
                        completes.push(resolve);
                    }),
                    cancel: () => {},
                };
            },
        };
        const component = make(service, fakeWorkspace(ROOT));
        typeQuery(component, "foo"); // search #1
        typeQuery(component, "bar"); // search #2 supersedes #1, still running
        completes[0]({ matchCount: 0, fileCount: 0, limitHit: false });
        await vi.runAllTimersAsync();
        // #2 is still in flight: «No results» would be a lie.
        const screen = render(component).screenToString();
        expect(screen).toContain("Searching…");
        expect(screen).not.toContain("No results");
    });

    it("clears a pending debounce so a cancelled search never spawns", () => {
        const { service } = fakeSearch([]);
        const spy = vi.spyOn(service, "search");
        const component = make(service, fakeWorkspace(ROOT));
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
        const component = make(service, fakeWorkspace(ROOT));
        typeQuery(component, "foo");
        typeQuery(component, "bar");
        expect(onCancel).toHaveBeenCalled();
    });

    it("cancels an in-flight search on dispose", () => {
        const onCancel = vi.fn();
        const { service } = fakeSearch([], { onCancel });
        const component = make(service, fakeWorkspace(ROOT));
        typeQuery(component, "foo");
        component.dispose();
        expect(onCancel).toHaveBeenCalled();
    });

    it("focus() targets the query input", () => {
        const component = make(fakeSearch([]).service, fakeWorkspace(ROOT));
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
            const component = make(fakeSearch(twoFiles()).service, fakeWorkspace(ROOT));
            typeQuery(component, "foo");
            // The cursor is on the first row (file:a.ts); the letter "b" must not jump to b.ts.
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "b" }));
            expect(component.results.inspectState()).toMatchObject({ cursorId: "file:a.ts" });
        });

        it("list mode (default): matches collapse under the file row", () => {
            const component = make(fakeSearch(twoFiles()).service, fakeWorkspace(ROOT));
            expect(component.getViewMode()).toBe("list");
            typeQuery(component, "foo");
            expect(component.results.contentHeight).toBe(5); // 2 files + 3 matches

            component.results.toggleCollapsed("file:a.ts");
            expect(component.results.contentHeight).toBe(3);
        });

        it("Enter on a file row toggles its group", () => {
            const component = make(fakeSearch(twoFiles()).service, fakeWorkspace(ROOT));
            typeQuery(component, "foo");
            // The default cursor is on the first row (file:a.ts).
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
            expect(component.results.isCollapsed("file:a.ts")).toBe(true);
        });

        it("tree mode builds a folder hierarchy without a new rg; files show the basename", () => {
            const { service } = fakeSearch(nestedFiles());
            const spy = vi.spyOn(service, "search");
            const component = make(service, fakeWorkspace(ROOT));
            typeQuery(component, "foo");

            component.setViewMode("tree");
            expect(spy).toHaveBeenCalledTimes(1); // rg was not restarted
            // src(1) + x(1) + a.ts(1) + 2 matches + y(1) + b.ts(1) + 1 match = 8 rows.
            expect(component.results.contentHeight).toBe(8);
            const screen = render(component).screenToString();
            expect(screen).toContain("src");
            expect(screen).toContain("a.ts");
            expect(screen).not.toContain("src/x/a.ts");

            component.results.toggleCollapsed("dir:src");
            expect(component.results.contentHeight).toBe(1);
        });

        it("tree mode: single-child folder chains are compacted into one row", () => {
            const component = make(
                fakeSearch([fileMatch("/work/project/deep/nested/dir/c.ts", [[1, "", "foo", ""]])]).service,
                fakeWorkspace(ROOT),
            );
            typeQuery(component, "foo");
            component.setViewMode("tree");
            // One folder chain + file + match.
            expect(component.results.contentHeight).toBe(3);
            expect(render(component).screenToString()).toContain("deep/nested/dir");
        });

        it("Enter on a folder collapses its subtree", () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeWorkspace(ROOT));
            typeQuery(component, "foo");
            component.setViewMode("tree");
            component.results.setCursorTo("dir:src");
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
            expect(component.results.isCollapsed("dir:src")).toBe(true);
        });

        it("streaming in tree mode rebuilds rows on a throttle", () => {
            const { service: state } = fakeState();
            const component = make(fakeSearch(nestedFiles()).service, fakeWorkspace(ROOT), { state });
            component.setViewMode("tree");
            typeQuery(component, "foo");
            // The results are already in the model, but the rebuild waits for the throttle.
            expect(component.results.contentHeight).toBe(0);
            vi.advanceTimersByTime(100);
            expect(component.results.contentHeight).toBe(8);
        });

        it("search completion flushes the pending tree rebuild without waiting for the throttle", async () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeWorkspace(ROOT));
            component.setViewMode("tree");
            typeQuery(component, "foo");
            expect(component.results.contentHeight).toBe(0); // the throttle is still waiting

            // Microtasks: the complete promise of the synchronous fakeSearch is already resolved.
            await Promise.resolve();
            await Promise.resolve();
            expect(component.results.contentHeight).toBe(8);
        });

        it("a new search cancels the pending tree rebuild of the previous one", () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeWorkspace(ROOT));
            component.setViewMode("tree");
            typeQuery(component, "foo");
            expect(component.results.contentHeight).toBe(0); // the first search's throttle is waiting

            // A toggle restarts the search synchronously (no debounce) — cancelSearch
            // drops the pending throttle, and the second search schedules its own.
            const [caseBtn] = component.view.querySelectorAll("ButtonElement") as ButtonElement[];
            caseBtn.onActivate?.();
            vi.advanceTimersByTime(100);
            expect(component.results.contentHeight).toBe(8); // the second search's rows, no duplicates
        });

        it("collapsed state and cursor survive a mode switch via stable ids", () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeWorkspace(ROOT));
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

        it("v2 state migration: any old value (tree/flat) becomes list", () => {
            expect(SEARCH_VIEW_MODE_STATE.version).toBe(2);
            expect(SEARCH_VIEW_MODE_STATE.migrate?.("tree", 0)).toBe("list");
            expect(SEARCH_VIEW_MODE_STATE.migrate?.("flat", 1)).toBe("list");
        });

        it("a collapsed tree folder silently loses its collapsed state on switching to list (the id is gone)", () => {
            const component = make(fakeSearch(nestedFiles()).service, fakeWorkspace(ROOT));
            typeQuery(component, "foo");
            component.setViewMode("tree");
            component.results.toggleCollapsed("dir:src");
            expect(component.results.contentHeight).toBe(1);

            component.setViewMode("list"); // no more dir: rows — their collapse is discarded
            expect(component.results.contentHeight).toBe(5);
        });

        it("setViewMode persists to workspace state; same mode is a no-op", () => {
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch([]).service, fakeWorkspace(ROOT), { state });
            component.setViewMode("tree");
            expect(stored.get("workbench.search.viewMode")).toBe("tree");

            stored.clear();
            component.setViewMode("tree");
            expect(stored.size).toBe(0);
        });

        it("restoreViewState reads the store without writing back", () => {
            const { service: state, stored } = fakeState();
            stored.set("workbench.search.viewMode", "tree");
            const component = make(fakeSearch(twoFiles()).service, fakeWorkspace(ROOT), { state });
            // The constructor already read tree; switch back to list and check restore.
            component.setViewMode("list");
            stored.set("workbench.search.viewMode", "tree");
            const writes = vi.spyOn(state, "store");

            component.restoreViewState();
            expect(component.getViewMode()).toBe("tree");
            expect(writes).not.toHaveBeenCalled();

            component.restoreViewState(); // a repeat is a no-op
            expect(component.getViewMode()).toBe("tree");
        });

        it("opening the project store restores the mode without an external call", () => {
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch(twoFiles()).service, fakeWorkspace(ROOT), { state });
            expect(component.getViewMode()).toBe("list");
            stored.set("workbench.search.viewMode", "tree");

            state.openWorkspace("project" as WorkspaceId);

            expect(component.getViewMode()).toBe("tree");
        });

        it("toggleQueryDetails: write-through, focus goes to include on reveal and to query on hide", () => {
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch([]).service, fakeWorkspace(ROOT), { state });
            const inputs = () => component.view.querySelectorAll("InputElement") as InputElement[];

            const queryFocus = vi.spyOn(inputs()[0], "focus");
            component.toggleQueryDetails();
            expect(stored.get("workbench.search.queryDetailsExpanded")).toBe(true);
            const includeFocus = vi.spyOn(inputs()[1], "focus");
            expect(includeFocus).not.toHaveBeenCalled();

            component.toggleQueryDetails(true); // a repeated show=true only focuses
            expect(includeFocus).toHaveBeenCalled();

            component.toggleQueryDetails();
            expect(stored.get("workbench.search.queryDetailsExpanded")).toBe(false);
            expect(queryFocus).toHaveBeenCalled();
        });

        it("restoreViewState reveals details from the store or when fields are non-empty, without write-through", () => {
            const { service: state, stored } = fakeState();
            stored.set("workbench.search.queryDetailsExpanded", true);
            const component = make(fakeSearch([]).service, fakeWorkspace(ROOT), { state });
            expect(component.isQueryDetailsShown()).toBe(true);

            // Hidden; the store holds false. A non-empty exclude makes restore expand.
            component.toggleQueryDetails(false, false);
            const exclude = component.view.querySelectorAll("InputElement");
            expect(exclude).toHaveLength(1); // only query is left
            const writes = vi.spyOn(state, "store");
            const excludeField = (component as unknown as { excludeInput: InputElement }).excludeInput;
            excludeField.inputState.value = "dist";
            component.restoreViewState();
            expect(component.isQueryDetailsShown()).toBe(true);
            expect(writes).not.toHaveBeenCalled();
        });

        it("sets the searchViewMode data key on create, toggle and restore", () => {
            const keys = new ContextKeyService();
            const { service: state, stored } = fakeState();
            const component = make(fakeSearch([]).service, fakeWorkspace(ROOT), { contextKeys: keys, state });
            expect(keys.get("searchViewMode")).toBe("list");

            component.setViewMode("tree");
            expect(keys.get("searchViewMode")).toBe("tree");

            component.setViewMode("list");
            stored.set("workbench.search.viewMode", "tree");
            component.restoreViewState();
            expect(keys.get("searchViewMode")).toBe("tree");
        });
    });

    describe("Collapse All / Expand All (stepwise CollapseDeepestExpandedLevel)", () => {
        const nested = () => [
            fileMatch("/work/project/src/x/a.ts", [
                [12, "const ", "foo", " = 1"],
                [20, "", "foo", ""],
            ]),
            fileMatch("/work/project/src/y/b.ts", [[3, "let ", "foo", ""]]),
        ];

        it("in tree mode: the first call collapses matches under files, the second the whole tree", () => {
            const component = make(fakeSearch(nested()).service, fakeWorkspace(ROOT));
            typeQuery(component, "foo");
            component.setViewMode("tree");
            expect(component.results.contentHeight).toBe(8);

            component.collapseDeepestLevel();
            // Folders expanded, files collapsed: src, x, a.ts, y, b.ts.
            expect(component.results.contentHeight).toBe(5);
            expect(component.results.isCollapsed("file:src/x/a.ts")).toBe(true);
            expect(component.results.isCollapsed("dir:src")).toBe(false);

            component.collapseDeepestLevel();
            expect(component.results.contentHeight).toBe(1); // only dir:src

            component.collapseDeepestLevel(); // everything already collapsed — no-op
            expect(component.results.contentHeight).toBe(1);
        });

        it("in list mode collapses file rows; expandAll restores everything", () => {
            const component = make(fakeSearch(nested()).service, fakeWorkspace(ROOT));
            typeQuery(component, "foo");
            expect(component.results.contentHeight).toBe(5);

            component.collapseDeepestLevel();
            expect(component.results.contentHeight).toBe(2);

            component.expandAll();
            expect(component.results.contentHeight).toBe(5);
        });

        it("sets the hasSearchResult/viewHasSomeCollapsibleResult data keys (debounced)", () => {
            const keys = new ContextKeyService();
            const component = make(fakeSearch(nested()).service, fakeWorkspace(ROOT), { contextKeys: keys });
            expect(keys.get("hasSearchResult")).toBe(false);
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(false);

            typeQuery(component, "foo");
            vi.advanceTimersByTime(100); // the key recomputation debounce
            expect(keys.get("hasSearchResult")).toBe(true);
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(true);

            component.collapseDeepestLevel(); // list: all files collapsed — nothing expanded is left
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(false);
            expect(keys.get("hasSearchResult")).toBe(true);

            component.expandAll();
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(true);
        });

        it("a user collapsing a row triggers key recomputation via onCollapsedChanged", () => {
            const keys = new ContextKeyService();
            const component = make(fakeSearch(nested()).service, fakeWorkspace(ROOT), { contextKeys: keys });
            typeQuery(component, "foo");
            component.results.toggleCollapsed("file:src/x/a.ts");
            component.results.toggleCollapsed("file:src/y/b.ts");
            vi.advanceTimersByTime(100);
            expect(keys.get("viewHasSomeCollapsibleResult")).toBe(false);
        });
    });

    describe("focus ring (Down/Up between inputs and the list)", () => {
        function makeFocusable(withDetails: boolean): { component: SearchComponent; app: TestApp } {
            const component = make(
                fakeSearch([fileMatch("/work/project/a.ts", [[1, "", "foo", ""]])]).service,
                fakeWorkspace(ROOT),
            );
            if (withDetails) component.toggleQueryDetails(true, false);
            const app = TestApp.createWithContent(component.view, new Size(40, 14));
            return { component, app };
        }

        it("details hidden: query → list; list → query (inputs behind '···' are skipped)", () => {
            const { component, app } = makeFocusable(false);
            component.focus();
            component.focusNextInputBox();
            expect(app.focusedElement).toBe(component.results);

            component.focusSearchFromResults();
            expect(app.focusedElement?.id).toBe(queryInput(component).id);
            const keys = new ContextKeyService();
            component.updateContextKeys(keys, app.focusedElement);
            expect(keys.get("searchInputBoxFocus")).toBe(true);
        });

        it("details shown: query → include → exclude → list; back exclude → include → query", () => {
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
            component.focusPreviousInputBox(); // top of the ring — no-op
            expect(app.focusedElement).toBe(query);
        });

        it("a ring call without focus in the inputs is a no-op (does not steal focus)", () => {
            const { component, app } = makeFocusable(false);
            component.results.focus();
            component.focusNextInputBox();
            expect(app.focusedElement).toBe(component.results);
        });

        it("firstMatchFocus: only an active list with the cursor on the first row", () => {
            const { component } = makeFocusable(false);
            const keys = new ContextKeyService();
            const firstMatchFocus = (active: TUIElement | null): unknown => {
                component.updateContextKeys(keys, active);
                return keys.get("firstMatchFocus");
            };
            // No results yet — no first row, the key is off.
            expect(firstMatchFocus(component.results)).toBe(false);
            (component as unknown as { queryInput: InputElement }).queryInput.inputState.value = "foo";
            typeQuery(component, "foo");

            expect(firstMatchFocus(component.results)).toBe(true); // the cursor is on file:a.ts
            component.results.setCursorTo("match:a.ts:0");
            expect(firstMatchFocus(component.results)).toBe(false);
            expect(firstMatchFocus(null)).toBe(false);
        });
    });

    it("searchViewletFocus/searchInputBoxFocus follow the view root and the three inputs", () => {
        const component = make(fakeSearch([]).service, fakeWorkspace(ROOT));
        component.toggleQueryDetails(true, false);
        const [query, include, exclude] = component.view.querySelectorAll("InputElement") as InputElement[];
        const keys = new ContextKeyService();
        const focusKeys = (active: TUIElement | null): unknown[] => {
            component.updateContextKeys(keys, active);
            return [keys.get("searchViewletFocus"), keys.get("searchInputBoxFocus")];
        };

        expect(focusKeys(query)).toEqual([true, true]);
        expect(focusKeys(include)).toEqual([true, true]);
        expect(focusKeys(exclude)).toEqual([true, true]);
        expect(focusKeys(component.results)).toEqual([true, false]);
        // An element outside the search view: its ancestors never reach the root.
        expect(focusKeys(new InputElement())).toEqual([false, false]);
        expect(focusKeys(null)).toEqual([false, false]);
    });

    it("registers its view in the merged Search container on creation", () => {
        const registered: { id: string; containerId: string; focus: () => void }[] = [];
        const viewsService = {
            registerContainer: () => {},
            registerView: (d: { id: string; containerId: string; focus: () => void }) => registered.push(d),
        } as unknown as ViewsService;
        const component = new SearchComponent(
            fakeSearch([]).service,
            fakeWorkspace(ROOT),
            fakeReveal().target,
            NULL_STATE_SERVICE,
            new ContextKeyService(),
            viewsService,
            NULL_JUMP_RECORDER,
            NULL_CONFIGURATION_SERVICE,
        );
        expect(registered).toHaveLength(1);
        expect(registered[0].id).toBe("workbench.search.results");
        expect(registered[0].containerId).toBe("search");

        // The descriptor's focus goes to the query row (viewlet focus).
        const spy = vi.spyOn(queryInput(component), "focus");
        registered[0].focus();
        expect(spy).toHaveBeenCalled();
    });

    it("theme change restyles existing file and match rows in place", () => {
        const component = make(
            fakeSearch([fileMatch("/work/project/a.ts", [[1, "x ", "foo", ""]])]).service,
            fakeWorkspace(ROOT),
        );
        typeQuery(component, "foo");
        const before = render(component).screenToString();

        // The cascade resolves tokens — a re-render is stable without restyling.
        expect(render(component).screenToString()).toBe(before);
    });

    describe("opening a result", () => {
        it("Enter on a match opens the file at the match position (1-based line → 0-based)", () => {
            const reveal = fakeReveal();
            const results = [fileMatch("/work/project/a.ts", [[12, "const ", "foo", " = 1"]])];
            const component = make(fakeSearch(results).service, fakeWorkspace(ROOT), { reveal: reveal.target });
            typeQuery(component, "foo");

            // The list's children are row wrappers (state carriers); the id is on the content.
            const matchRow = component.results.getChildren()[1].getChildren()[0];
            component.results.setCursorTo(matchRow.id!);
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));

            expect(reveal.opened).toEqual(["/work/project/a.ts"]);
            expect(reveal.positions).toEqual([[11, 6]]); // line 12 → 11, startColumn = "const ".length
            expect(reveal.ranges).toEqual([{ start: { line: 11, character: 6 }, end: { line: 11, character: 9 } }]);
        });
    });
});
