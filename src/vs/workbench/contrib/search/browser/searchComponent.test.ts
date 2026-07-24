import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MockTerminalBackend } from "../../../../../../tuidom/backend/mockTerminalBackend.ts";
import type { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import type { InputElement } from "../../../../../../tuidom/ui/inputbox/inputElement.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { ExplorerService } from "../../files/browser/explorerService.ts";
import type {
    IFileMatch,
    ISearchHandle,
    ITextSearchComplete,
    ITextSearchService,
} from "../../../services/search/common/textSearch.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { SearchComponent } from "./searchComponent.ts";

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

function fileMatch(absolutePath: string, lines: Array<[number, string, string, string]>): IFileMatch {
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

function make(search: ITextSearchService, explorer: ExplorerService): SearchComponent {
    return new SearchComponent(search, explorer, new ThemeService(theme));
}

function render(component: SearchComponent, w = 40, h = 14): MockTerminalBackend {
    return renderElement(component.view, w, h, { resolveStyles: true });
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

    it("renders the SEARCH title and placeholders before any query", () => {
        const component = make(fakeSearch([]).service, fakeExplorer(ROOT));
        const screen = render(component).screenToString();
        expect(screen).toContain("SEARCH");
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
        const results = [fileMatch("/work/project/a.ts", [[1, "", "foo", ""], [2, "x ", "foo", " y"]])];
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
        const captured: Array<(m: IFileMatch) => void> = [];
        const service: ITextSearchService = {
            search(_q, _f, onResult): ISearchHandle {
                captured.push(onResult);
                return { complete: Promise.resolve({ matchCount: 0, fileCount: 0, limitHit: false }), cancel: () => {} };
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
});
