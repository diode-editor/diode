import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    CodeLens,
    CodeLensCommand,
    CodeLensProvider,
} from "../../../../editor/common/languages/iCodeLensSource.ts";

// Gutter: 2 padding + 1 digit + fold margin (3) = 6.
const GUTTER = 6;
/** Past the longest debounce. */
const SETTLE_MS = 1000;
const LENS_FG = packRgb(0x99, 0x99, 0x99);

function command(title: string, id = `cmd.${title}`, args?: readonly unknown[]): CodeLensCommand {
    return { id, title, arguments: args };
}

function lens(line: number, cmd?: CodeLensCommand, character = 0): CodeLens {
    return {
        range: { start: { line, character }, end: { line, character: character + 1 } },
        command: cmd,
    };
}

function provider(lenses: readonly CodeLens[], rest: Partial<CodeLensProvider> = {}): CodeLensProvider {
    return { provideCodeLenses: () => ({ lenses, dispose: () => undefined }), ...rest };
}

describe("EditorComponent — code lens", () => {
    let ws: ITempWorkspace;
    let providers: LanguageFeatureRegistry<CodeLensProvider>;
    let runCommand: ReturnType<typeof vi.fn<(command: CodeLensCommand) => Promise<void>>>;
    let unexpected: unknown[];
    let pane: TextEditorPane | null;

    beforeEach(() => {
        vi.useFakeTimers();
        ws = createTempWorkspace({ prefix: "diode-code-lens-" });
        providers = new LanguageFeatureRegistry();
        runCommand = vi.fn(() => Promise.resolve());
        unexpected = [];
        setUnexpectedErrorHandler((e) => {
            unexpected.push(e);
        });
        pane = null;
    });

    afterEach(() => {
        pane?.dispose();
        vi.useRealTimers();
        setUnexpectedErrorHandler(() => undefined);
        ws.dispose();
    });

    async function open(
        content: string,
        size: Size = new Size(40, 8),
    ): Promise<{ app: TestApp; editor: TextEditorPane; frame: () => string[]; settle: () => Promise<void> }> {
        const editor = createEditorPane({
            codeLens: { providers, runCommand },
            file: Uri.file(ws.writeFile("a.ts", content)),
        });
        pane = editor;
        const app = TestApp.createWithContent(editor.view, size);
        const settle = async (): Promise<void> => {
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            app.render();
        };
        await settle();
        // The gutter grows with the digits of the line count.
        const gutter = (): number => GUTTER + String(editor.viewState.lineCount).length - 1;
        const frame = (): string[] => {
            app.render();
            return Array.from({ length: size.height }, (_, y) =>
                // The last column is the scroll bar's, an indent guide is not the text under test.
                app.backend
                    .getTextAt(new Point(gutter(), y), size.width - gutter() - 1)
                    .replaceAll("▏", " ")
                    .trimEnd(),
            );
        };
        return { app, editor, frame, settle };
    }

    function fire(type: "mousedown" | "dblclick", x: number, y: number, button: "left" | "right" = "left"): void {
        const element = pane?.component.view.getChild();
        element?.dispatchEvent(new TUIMouseEvent(type, { button, screenX: x, screenY: y, localX: x, localY: y }));
    }

    function click(x: number, y: number): void {
        fire("mousedown", x, y);
    }

    it("a row above the line, titles through ' | ', indented to the first non-whitespace column, in the lens color", async () => {
        providers.register("*", provider([lens(1, command("3 references")), lens(1, command("Run test"))]));
        const { app, frame } = await open("alpha\n    bravo\ncharlie");
        expect(frame().slice(0, 4)).toEqual(["alpha", "    3 references | Run test", "    bravo", "charlie"]);
        expect(app.backend.getFgAt(new Point(GUTTER + 4, 1))).toBe(LENS_FG);
    });

    it("a tab indent counts in columns and is drawn as spaces", async () => {
        providers.register("*", provider([lens(0, command("x"))]));
        const { frame, editor } = await open("\tbravo");
        const tabSize = editor.viewState.tabSize;
        expect(frame()[0]).toBe(`${" ".repeat(tabSize)}x`);
    });

    it("a lens on the first line sits before it", async () => {
        providers.register("*", provider([lens(0, command("top"))]));
        const { frame, editor } = await open("alpha\nbravo");
        expect(frame().slice(0, 2)).toEqual(["top", "alpha"]);
        expect(editor.viewState.viewZones).toEqual([{ afterLine: -1, size: 1 }]);
    });

    it("the row is taken at once, the title comes with the resolve, only for the viewport", async () => {
        const answers: (() => void)[] = [];
        const resolveCodeLens = vi.fn(
            (_model: unknown, item: CodeLens) =>
                new Promise<CodeLens>((resolve) => {
                    answers.push(() => {
                        resolve({ ...item, command: command(`line ${String(item.range.start.line)}`) });
                    });
                }),
        );
        const lines = Array.from({ length: 50 }, (_, i) => `l${String(i)}`).join("\n");
        providers.register("*", provider([lens(1), lens(40)], { resolveCodeLens }));
        const { editor, frame, settle } = await open(lines);
        expect(editor.viewState.viewZones).toEqual([
            { afterLine: 0, size: 1 },
            { afterLine: 39, size: 1 },
        ]);
        expect(frame().slice(0, 3)).toEqual(["l0", "", "l1"]);
        expect(resolveCodeLens).toHaveBeenCalledOnce();

        answers[0]();
        await settle();
        expect(frame().slice(0, 3)).toEqual(["l0", "line 1", "l1"]);

        editor.viewState.goToPosition(40, 0);
        await settle();
        expect(resolveCodeLens).toHaveBeenCalledTimes(2);
    });

    it("a lens whose zone is the bottom row of the viewport is resolved too", async () => {
        const resolveCodeLens = vi.fn((_model: unknown, item: CodeLens) => ({ ...item, command: command("t") }));
        providers.register("*", provider([lens(3)], { resolveCodeLens }));
        // Rows: l0 l1 l2 <zone> at height 4.
        await open("l0\nl1\nl2\nl3\nl4\nl5", new Size(40, 4));
        expect(resolveCodeLens).toHaveBeenCalledOnce();
    });

    it("every lens of a line fallen off: 'no commands'; one of several: the others stay", async () => {
        const resolveCodeLens = vi.fn((_model: unknown, item: CodeLens) => {
            if (item.range.start.line === 0) return null;
            if (item.range.start.character === 0) throw new Error("boom");
            return { ...item, command: command("kept") };
        });
        providers.register("*", provider([lens(0), lens(2), lens(2, undefined, 1)], { resolveCodeLens }));
        const { frame } = await open("alpha\nbravo\ncharlie");
        expect(frame().slice(0, 4)).toEqual(["no commands", "alpha", "bravo", "kept"]);
        expect(unexpected).toHaveLength(1);
    });

    it("a resolve answering without a command leaves the lens blank, not 'no commands'", async () => {
        providers.register("*", provider([lens(0)], { resolveCodeLens: (_m, item) => item }));
        const { frame } = await open("alpha");
        expect(frame().slice(0, 2)).toEqual(["", "alpha"]);
    });

    it("a provider without resolve and without a command: a blank row", async () => {
        providers.register("*", provider([lens(0)]));
        const { frame } = await open("alpha");
        expect(frame().slice(0, 2)).toEqual(["", "alpha"]);
    });

    it("two providers on a line go in provider order; a failing one costs the other nothing", async () => {
        providers.register("*", provider([lens(0, command("first"), 3)]));
        providers.register("*", provider([lens(0, command("second"), 0)]));
        providers.register("*", {
            provideCodeLenses: () => {
                throw new Error("boom");
            },
        });
        const { frame } = await open("alpha");
        const ordered = frame()[0].split(" | ");
        expect(ordered.sort()).toEqual(["first", "second"]);
        expect(unexpected).toHaveLength(1);
    });

    it("an empty title takes no place, a range past the end clamps to the last line, unicode stays whole", async () => {
        providers.register(
            "*",
            provider([
                lens(0, command("")),
                lens(0, command("你好")),
                lens(0, command("ok")),
                {
                    range: { start: { line: 99, character: 99 }, end: { line: 99, character: 100 } },
                    command: command("late"),
                },
            ]),
        );
        const { frame } = await open("alpha\nbravo");
        expect(frame()[0]).toBe("你好 | ok");
        expect(frame().slice(1, 4)).toEqual(["alpha", "late", "bravo"]);
    });

    it("a narrow terminal cuts the titles and wraps nothing", async () => {
        providers.register("*", provider([lens(0, command("a".repeat(30)))]));
        const { frame, editor } = await open("alpha\nbravo", new Size(16, 4));
        expect(frame()[0]).toBe("a".repeat(16 - GUTTER - 1));
        expect(editor.viewState.viewZones).toEqual([{ afterLine: -1, size: 1 }]);
    });

    it("the row scrolls with the text and the click follows it", async () => {
        providers.register("*", provider([lens(1, command("title"))]));
        const { editor, frame } = await open(`alpha\n${"x".repeat(100)}`);
        editor.viewState.scrollLeft = 2;
        expect(frame()[1]).toBe("tle");
        click(GUTTER, 1);
        expect(runCommand).toHaveBeenCalledOnce();
    });

    it("the provider's onDidChange asks again; a stale answer is dropped", async () => {
        const changed = new Emitter<void>();
        const answers: ((value: { lenses: readonly CodeLens[]; dispose(): void }) => void)[] = [];
        providers.register("*", {
            provideCodeLenses: () =>
                new Promise((resolve) => {
                    answers.push(resolve);
                }),
            onDidChange: changed.event,
        });
        const { frame, settle } = await open("alpha\nbravo");
        expect(answers).toHaveLength(1);
        changed.fire();
        await settle();
        expect(answers).toHaveLength(2);
        const staleDispose = vi.fn();
        answers[0]({ lenses: [lens(0, command("stale"))], dispose: staleDispose });
        answers[1]({ lenses: [lens(0, command("fresh"))], dispose: () => undefined });
        await settle();
        expect(frame()[0]).toBe("fresh");
        expect(staleDispose).toHaveBeenCalledOnce();
    });

    it("an edit above moves the zone with its line; deleting the line removes it", async () => {
        providers.register("*", provider([]));
        const lenses = [lens(1, command("t"))];
        providers.register("*", provider(lenses));
        const { editor, frame } = await open("alpha\nbravo\ncharlie");
        expect(frame().slice(0, 3)).toEqual(["alpha", "t", "bravo"]);

        editor.viewState.goToPosition(0, 0);
        editor.viewState.insertText("new\n");
        await vi.advanceTimersByTimeAsync(0);
        expect(editor.viewState.viewZones).toEqual([{ afterLine: 1, size: 1 }]);
        expect(frame().slice(0, 4)).toEqual(["new", "alpha", "t", "bravo"]);

        editor.viewState.selections = [{ anchor: { line: 2, character: 0 }, active: { line: 3, character: 0 } }];
        editor.viewState.insertText("");
        await vi.advanceTimersByTimeAsync(0);
        expect(editor.viewState.viewZones).toEqual([]);
        expect(frame().slice(0, 3)).toEqual(["new", "alpha", "charlie"]);
    });

    it("an edit above a collapsed region keeps the folds and the lenses on their lines", async () => {
        providers.register("*", provider([lens(3, command("inside")), lens(4, command("after"))]));
        const { editor, frame } = await open("top\nh\n  a\n  b\nz\ny");
        editor.viewState.setFoldingRegions([{ startLine: 1, endLine: 3, isCollapsed: true }]);
        expect(frame().slice(0, 4)).toEqual(["top", "h ⋯", "after", "z"]);

        editor.viewState.goToPosition(0, 0);
        editor.viewState.insertText("new\n");
        await vi.advanceTimersByTimeAsync(0);
        expect(frame().slice(0, 5)).toEqual(["new", "top", "h ⋯", "after", "z"]);
    });

    it("arriving zones above the viewport leave the text where it is", async () => {
        const answers: ((value: { lenses: readonly CodeLens[]; dispose(): void }) => void)[] = [];
        providers.register("*", {
            provideCodeLenses: () =>
                new Promise((resolve) => {
                    answers.push(resolve);
                }),
        });
        const lines = Array.from({ length: 50 }, (_, i) => `l${String(i)}`).join("\n");
        const { editor, frame, settle } = await open(lines);
        editor.viewState.scrollTop = 20;
        answers[0]({ lenses: [lens(1, command("a")), lens(2, command("b"))], dispose: () => undefined });
        await settle();
        expect(frame()[0]).toBe("l20");
    });

    it("the left click: title runs its command with arguments, the rest goes to the line", async () => {
        const run = command("run", "cmd.run", [1, "two"]);
        providers.register("*", provider([lens(1, run), lens(1, command("other", "cmd.other"))]));
        const { editor } = await open("alpha\n  bravo");
        const selection = editor.viewState.selections[0];

        // "  run | other"
        click(GUTTER + 2, 1);
        expect(runCommand).toHaveBeenCalledWith(run);
        click(GUTTER + 4, 1);
        expect(runCommand).toHaveBeenCalledTimes(2);
        expect(editor.viewState.selections[0]).toEqual(selection);

        runCommand.mockClear();
        // The separator.
        click(GUTTER + 6, 1);
        expect(runCommand).not.toHaveBeenCalled();
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 2 });

        editor.viewState.goToPosition(0, 0);
        // Past the text, in the indent: no command either.
        click(GUTTER + 30, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 2 });
        editor.viewState.goToPosition(0, 0);
        click(GUTTER, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 2 });
        expect(runCommand).not.toHaveBeenCalled();
    });

    it("the cell right after a title is not the title", async () => {
        providers.register("*", provider([lens(0, command("run"))]));
        await open("alpha");
        click(GUTTER + 3, 0);
        expect(runCommand).not.toHaveBeenCalled();
    });

    it("a line of whitespace only gives its lens no indent", async () => {
        providers.register("*", provider([lens(1, command("t"))]));
        const { frame } = await open("alpha\n    \nbravo");
        expect(frame()[1]).toBe("t");
    });

    it("the ghost tail of another line does not shadow a click on the lens", async () => {
        providers.register("*", provider([lens(2, command("t"))]));
        const { editor, frame } = await open("alpha\nbravo\ncharlie");
        editor.setGhostText({ line: 0, character: 5, lines: ["-a", "tail"] });
        // alpha-a, tail, bravo, t, charlie
        expect(frame().slice(0, 4)).toEqual(["alpha-a", "tail", "bravo", "t"]);
        click(GUTTER, 3);
        expect(runCommand).toHaveBeenCalledOnce();
    });

    it("without code lens at all the picker gets nothing", async () => {
        const editor = createEditorPane();
        pane = editor;
        await expect(editor.getCodeLensPicksAtLine(0)).resolves.toEqual([]);
    });

    it("a right click and a command without an id don't run anything", async () => {
        providers.register("*", provider([lens(0, command("label", ""))]));
        await open("alpha");
        click(GUTTER, 0);
        fire("mousedown", GUTTER, 0, "right");
        expect(runCommand).not.toHaveBeenCalled();
    });

    it("a wide title is hit by its cells", async () => {
        providers.register("*", provider([lens(0, command("你好", "cmd.wide")), lens(0, command("b", "cmd.b"))]));
        await open("alpha");
        click(GUTTER + 3, 0);
        expect(runCommand.mock.lastCall?.[0].id).toBe("cmd.wide");
        // "你好 | b": the separator ends at column 6.
        click(GUTTER + 7, 0);
        expect(runCommand.mock.lastCall?.[0].id).toBe("cmd.b");
    });

    it("a double click on the row selects nothing", async () => {
        providers.register("*", provider([lens(1, command("t"))]));
        const { editor } = await open("alpha\nbravo");
        fire("mousedown", GUTTER + 20, 1);
        fire("dblclick", GUTTER + 20, 1);
        const { anchor, active } = editor.viewState.selections[0];
        expect(anchor).toEqual(active);
    });

    it("folds: over a collapsed header, none inside, over the line after the region", async () => {
        providers.register(
            "*",
            provider([
                lens(0, command("head")),
                lens(1, command("in1")),
                lens(2, command("in2")),
                lens(3, command("after")),
            ]),
        );
        const { editor, frame } = await open("h\n  a\n  b\nz\ny");
        editor.viewState.setFoldingRegions([{ startLine: 0, endLine: 2, isCollapsed: true }]);
        expect(frame().slice(0, 4)).toEqual(["head", "h ⋯", "after", "z"]);

        editor.viewState.setFoldingRegions([{ startLine: 0, endLine: 2, isCollapsed: false }]);
        expect(frame().slice(0, 4)).toEqual(["head", "h", "  in1", "  a"]);
    });

    it("lives next to a multi-line ghost text at one anchor: the tail first, then the lens", async () => {
        providers.register("*", provider([lens(1, command("t"))]));
        const { editor, frame } = await open("alpha\nbravo");
        editor.setGhostText({ line: 0, character: 5, lines: ["-a", "tail"] });
        expect(editor.viewState.viewZones).toEqual([{ afterLine: 0, size: 2 }]);
        expect(frame().slice(0, 4)).toEqual(["alpha-a", "tail", "t", "bravo"]);

        editor.setGhostText(null);
        expect(editor.viewState.viewZones).toEqual([{ afterLine: 0, size: 1 }]);
        expect(frame().slice(0, 3)).toEqual(["alpha", "t", "bravo"]);
    });

    it("a click on the ghost tail row is not a click on the lens at its anchor", async () => {
        providers.register("*", provider([lens(1, command("t"))]));
        const { editor, frame } = await open("alpha\nbravo");
        editor.setGhostText({ line: 0, character: 5, lines: ["-a", "tail"] });
        frame();
        click(GUTTER, 1);
        expect(runCommand).not.toHaveBeenCalled();
        click(GUTTER, 2);
        expect(runCommand).toHaveBeenCalledOnce();
    });

    it("going up to a line with a lens shows the lens too", async () => {
        const lines = Array.from({ length: 50 }, (_, i) => `l${String(i)}`).join("\n");
        providers.register("*", provider([lens(20, command("t"))]));
        const { editor, frame } = await open(lines);
        editor.viewState.goToPosition(40, 0);
        editor.viewState.goToPosition(20, 0);
        expect(frame().slice(0, 2)).toEqual(["t", "l20"]);
    });

    it("Up and Down step over the row", async () => {
        providers.register("*", provider([lens(1, command("t"))]));
        const { editor } = await open("alpha\nbravo");
        editor.viewState.goToPosition(0, 0);
        editor.viewState.cursorDown();
        expect(editor.viewState.selections[0].active.line).toBe(1);
        editor.viewState.cursorUp();
        expect(editor.viewState.selections[0].active.line).toBe(0);
    });

    it("turning off drops the zones at once, turning on asks again without reopening", async () => {
        const provideCodeLenses = vi.fn(() => ({ lenses: [lens(0, command("t"))], dispose: () => undefined }));
        providers.register("*", { provideCodeLenses });
        const { editor, frame, settle } = await open("alpha");
        expect(frame()[0]).toBe("t");

        editor.setCodeLens({ enabled: false, nerdFont: false });
        expect(editor.viewState.viewZones).toEqual([]);
        expect(frame()[0]).toBe("alpha");

        editor.setCodeLens({ enabled: true, nerdFont: false });
        await settle();
        expect(provideCodeLenses).toHaveBeenCalledTimes(2);
        expect(frame()[0]).toBe("t");
    });

    it("an icon in a title expands for the current glyph set; an unknown one is dropped", async () => {
        providers.register("*", provider([lens(0, command("$(nosuchicon)go"))]));
        const { frame } = await open("alpha");
        expect(frame()[0]).toBe("go");
    });

    it("the commands of the caret line for the picker, with the empty titles left out", async () => {
        const run = command("run");
        providers.register("*", provider([lens(1, run), lens(1, command(""))]));
        const { editor } = await open("alpha\nbravo");
        await expect(editor.getCodeLensPicksAtLine(1)).resolves.toEqual([{ label: "run", command: run }]);
        await expect(editor.getCodeLensPicksAtLine(0)).resolves.toEqual([]);
    });

    it("closing the editor disposes the lists", async () => {
        const dispose = vi.fn();
        providers.register("*", { provideCodeLenses: () => ({ lenses: [], dispose }) });
        const { editor } = await open("alpha");
        editor.dispose();
        pane = null;
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("no providers, no asking; a later registration brings the lenses", async () => {
        const { frame, settle } = await open("alpha");
        expect(frame()[0]).toBe("alpha");
        providers.register("*", provider([lens(0, command("t"))]));
        await settle();
        expect(frame()[0]).toBe("t");
    });
});
