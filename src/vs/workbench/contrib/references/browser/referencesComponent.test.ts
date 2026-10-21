import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import type { IReferenceGroup } from "./referencePreview.ts";
import { type IReferencesRevealTarget, ReferencesComponent } from "./referencesComponent.ts";

const NULL_VIEWS_SERVICE = { registerContainer: () => {}, registerView: () => {} } as unknown as ViewsService;

function fakeReveal(opts: { noEditor?: boolean } = {}): {
    target: IReferencesRevealTarget;
    opened: string[];
    positions: [number, number | undefined][];
    ranges: IRange[];
} {
    const opened: string[] = [];
    const positions: [number, number | undefined][] = [];
    const ranges: IRange[] = [];
    const target: IReferencesRevealTarget = {
        openUri: (uri) => opened.push(uri.fsPath),
        getActiveEditor: () =>
            opts.noEditor === true
                ? null
                : {
                      goToPosition: (line, column) => positions.push([line, column]),
                      revealRange: (range) => ranges.push(range),
                  },
    };
    return { target, opened, positions, ranges };
}

function group(relPath: string, lines: [number, string, string, string][]): IReferenceGroup {
    return {
        absolutePath: `/work/project/${relPath}`,
        relPath,
        matches: lines.map(([lineNumber, before, inside, after]) => ({
            lineNumber,
            startColumn: before.length,
            endColumn: before.length + inside.length,
            preview: { before, inside, after },
        })),
    };
}

function twoFiles(): IReferenceGroup[] {
    return [
        group("src/a.ts", [
            [1, "export function ", "greet", "() {}"],
            [7, "  return ", "greet", "();"],
        ]),
        group("src/b.ts", [[3, "import { ", "greet", ' } from "./a";']]),
    ];
}

function make(opts: { reveal?: IReferencesRevealTarget; contextKeys?: ContextKeyService } = {}): ReferencesComponent {
    return new ReferencesComponent(
        opts.reveal ?? fakeReveal().target,
        opts.contextKeys ?? new ContextKeyService(),
        NULL_VIEWS_SERVICE,
        NULL_JUMP_RECORDER,
    );
}

function render(component: ReferencesComponent, w = 40, h = 10): MockTerminalBackend {
    return renderElement(component.view, w, h, { themeVars: true });
}

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);

function line(backend: MockTerminalBackend, y: number): string {
    return backend.screenToString().split("\n")[y];
}

describe("ReferencesComponent — filling the panel", () => {
    it("groups references by file with a counter and code lines", () => {
        const component = make();
        component.setResults(twoFiles());

        const screen = render(component).screenToString();
        expect(screen).toContain("3 results in 2 files");
        expect(screen).toContain("src/a.ts");
        expect(screen).toContain("export function greet() {}");
        expect(screen).toContain("src/b.ts");
        expect(screen).toContain("7");
        expect(component.resultCount).toBe(3);
        // 2 files + 3 references.
        expect(component.results.contentHeight).toBe(5);
    });

    it("a single file is counted in the singular", () => {
        const component = make();
        component.setResults([group("a.ts", [[1, "", "greet", ""]])]);
        expect(render(component).screenToString()).toContain("1 results in 1 file");
    });

    it("an empty result is 'No results', not an empty header", () => {
        const component = make();
        component.setResults([]);
        expect(render(component).screenToString()).toContain("No results");
        expect(component.resultCount).toBe(0);
    });

    it("the header is empty before the first search", () => {
        expect(render(make()).screenToString()).not.toContain("results");
    });

    it("a new search replaces the previous references, and clear() resets the panel", () => {
        const component = make();
        component.setResults(twoFiles());
        component.setResults([group("c.ts", [[2, "const ", "other", " = 1;"]])]);

        let screen = render(component).screenToString();
        expect(screen).toContain("1 results in 1 file");
        expect(screen).not.toContain("src/a.ts");

        component.clear();
        const backend = render(component);
        // The header is exactly empty, not "anything without the word results".
        expect(line(backend, 0)).toBe("".padEnd(40, " "));
        screen = backend.screenToString();
        expect(screen).not.toContain("c.ts");
        expect(component.results.contentHeight).toBe(0);
        expect(component.resultCount).toBe(0);
    });

    it("the cursor lands on the first reference, not on the file row", () => {
        const component = make();
        component.setResults(twoFiles());
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:0");
    });
});

describe("ReferencesComponent — styling", () => {
    it("the header has a one-column indent and sidebar colors", () => {
        const component = make();
        component.setResults(twoFiles());
        const backend = render(component);

        expect(line(backend, 0)).toBe(" 3 results in 2 files".padEnd(40, " "));
        expect(backend.getBgAt(new Point(0, 0))).toBe(theme.getRequiredColor("sideBar.background"));
        expect(backend.getFgAt(new Point(1, 0))).toBe(theme.getRequiredColor("descriptionForeground"));
        expect(backend.getBgAt(new Point(0, 1))).toBe(theme.getRequiredColor("sideBar.background"));
    });

    it("the match in the line is highlighted with the word-highlight background", () => {
        const component = make();
        component.setResults(twoFiles());
        const backend = render(component);

        // The second reference (frame row 3): the first is under the cursor, and its background
        // overrides the match highlight.
        const y = 3;
        const text = line(backend, y);
        const at = text.indexOf("greet");
        expect(text.trim()).toBe("7    return greet();");
        expect(backend.getBgAt(new Point(at, y))).toBe(theme.getRequiredColor("editor.wordHighlightBackground"));
        expect(backend.getBgAt(new Point(at - 1, y))).not.toBe(
            theme.getRequiredColor("editor.wordHighlightBackground"),
        );
    });

    it("before the first search the header is blank, not text", () => {
        expect(line(render(make()), 0)).toBe("".padEnd(40, " "));
    });

    it("a single file is 'file', several are 'files'", () => {
        const one = make();
        one.setResults([group("a.ts", [[1, "", "greet", ""]])]);
        expect(line(render(one), 0).trim()).toBe("1 results in 1 file");

        const many = make();
        many.setResults(twoFiles());
        expect(line(render(many), 0).trim()).toBe("3 results in 2 files");
    });

    it("an empty result is exactly 'No results'", () => {
        const component = make();
        component.setResults([]);
        expect(line(render(component), 0).trim()).toBe("No results");
    });

    it("the view root carries an id that tests and the inspector find it by", () => {
        expect(make().view.id).toBe("referencesView");
    });
});

describe("ReferencesComponent — list keyboard", () => {
    it("typeahead jumps to a file by name prefix", () => {
        const component = make();
        component.setResults(twoFiles());
        // The cursor is on the first reference of src/a.ts; typing "src/b" moves to the row
        // of the second file (a file row's label is its path).
        for (const key of ["s", "r", "c", "/", "b"]) {
            component.results.dispatchEvent(new TUIKeyboardEvent("keypress", { key }));
        }
        expect(component.results.getCursorElement()?.id).toBe("file:src/b.ts");
    });
});

describe("ReferencesComponent — collapsing", () => {
    it("Collapse All collapses files, Expand All brings references back", () => {
        const component = make();
        component.setResults(twoFiles());
        expect(component.results.contentHeight).toBe(5);

        component.collapseDeepestLevel();
        expect(component.results.contentHeight).toBe(2);
        expect(component.results.isCollapsed("file:src/a.ts")).toBe(true);
        // Only files collapse: references themselves have no children, and there's no point
        // marking them collapsed.
        expect(component.results.isCollapsed("ref:src/a.ts:0")).toBe(false);

        component.expandAll();
        expect(component.results.contentHeight).toBe(5);
        expect(component.results.isCollapsed("file:src/a.ts")).toBe(false);
    });

    it("context keys follow the panel state", () => {
        const contextKeys = new ContextKeyService();
        const component = make({ contextKeys });

        expect(contextKeys.get("hasReferenceResult")).toBe(false);
        expect(contextKeys.get("referencesViewHasSomeCollapsibleResult")).toBe(false);

        component.setResults(twoFiles());
        expect(contextKeys.get("hasReferenceResult")).toBe(true);
        expect(contextKeys.get("referencesViewHasSomeCollapsibleResult")).toBe(true);

        component.collapseDeepestLevel();
        expect(contextKeys.get("referencesViewHasSomeCollapsibleResult")).toBe(false);

        component.clear();
        expect(contextKeys.get("hasReferenceResult")).toBe(false);
    });
});

describe("ReferencesComponent — opening a reference", () => {
    it("activating a reference opens the file at its position", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        component.results.onActivate!({ id: "ref:src/a.ts:1" } as never);

        expect(reveal.opened).toEqual(["/work/project/src/a.ts"]);
        // lineNumber 7 (1-based) → editor line 6; columns come from the preview.
        expect(reveal.positions).toEqual([[6, 9]]);
        expect(reveal.ranges).toEqual([{ start: { line: 6, character: 9 }, end: { line: 6, character: 14 } }]);
    });

    it("activating a file row collapses it instead of opening the file", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        component.results.onActivate!({ id: "file:src/a.ts" } as never);

        expect(reveal.opened).toEqual([]);
        expect(component.results.isCollapsed("file:src/a.ts")).toBe(true);
    });

    it("after clear() old rows are dead: activating a vanished reference is a no-op", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());
        component.clear();

        component.results.onActivate!({ id: "ref:src/a.ts:0" } as never);
        component.results.onActivate!({ id: "file:src/a.ts" } as never);

        expect(reveal.opened).toEqual([]);
    });

    it("activating an unknown row does not crash the panel", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        expect(() => {
            component.results.onActivate!({ id: "no such row" } as never);
        }).not.toThrow();
        expect(reveal.opened).toEqual([]);
    });

    it("without an active editor after openUri the position is not set", () => {
        const reveal = fakeReveal({ noEditor: true });
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        component.results.onActivate!({ id: "ref:src/a.ts:0" } as never);

        expect(reveal.opened).toEqual(["/work/project/src/a.ts"]);
        expect(reveal.positions).toEqual([]);
    });
});

describe("ReferencesComponent — F4 navigation", () => {
    it("walks all files in order and wraps from the last to the first", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        component.goToNextReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:1");
        component.goToNextReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/b.ts:0");
        component.goToNextReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:0");

        expect(reveal.opened).toEqual(["/work/project/src/a.ts", "/work/project/src/b.ts", "/work/project/src/a.ts"]);
    });

    it("Shift+F4 from the first reference wraps to the last", () => {
        const component = make();
        component.setResults(twoFiles());

        component.goToPreviousReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/b.ts:0");
        component.goToPreviousReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:1");
    });

    it("a collapsed file expands so the cursor does not move into hidden rows", () => {
        const component = make();
        component.setResults(twoFiles());
        // Everything collapsed: the cursor left the reference (its row is hidden), so a step
        // forward goes to the first reference and expands its file.
        component.collapseDeepestLevel();
        expect(component.results.getCursorElement()?.id).not.toBe("ref:src/a.ts:0");

        component.goToNextReference();

        expect(component.results.isCollapsed("file:src/a.ts")).toBe(false);
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:0");

        component.goToNextReference();
        component.goToNextReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/b.ts:0");
        expect(component.results.isCollapsed("file:src/b.ts")).toBe(false);
    });

    it("cursor on a file row: forward goes to the first reference, back to the last", () => {
        const forward = make();
        forward.setResults(twoFiles());
        forward.results.setCursorTo("file:src/b.ts");
        forward.goToNextReference();
        expect(forward.results.getCursorElement()?.id).toBe("ref:src/a.ts:0");

        const backward = make();
        backward.setResults(twoFiles());
        backward.results.setCursorTo("file:src/b.ts");
        backward.goToPreviousReference();
        expect(backward.results.getCursorElement()?.id).toBe("ref:src/b.ts:0");
    });

    it("navigation on an empty panel is a no-op", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });

        component.goToNextReference();
        component.goToPreviousReference();

        expect(reveal.opened).toEqual([]);
    });
});
