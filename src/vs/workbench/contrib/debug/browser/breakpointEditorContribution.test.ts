// The contribution over fake editors with a real debug service: what each click of the lane does (upstream's
// `onMouseDown`), when the glyphs are drawn again (settings, language, closed editors, edits), column breakpoints and
// several breakpoints on a line, and the stack frames of several sessions on one line.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { NO_DELAY_TIMING, registerSyntheticDebugger } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Emitter, Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    IGlyphMarginClick,
    IGlyphMarginDecoration,
    ILineHighlightDecoration,
} from "../../../../editor/common/model/iGlyphMarginDecoration.ts";
import type { IInlineInsertion } from "../../../../editor/common/model/iInlineInsertion.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { type IDebugSession, type IStackFrame, type IThread, State } from "../common/debug.ts";

import {
    BreakpointEditorContribution,
    DEBUG_GLYPH_OWNER,
    type IBreakpointEditor,
    type IBreakpointEditorSource,
} from "./breakpointEditorContribution.ts";
import type { BreakpointInput } from "./breakpointInput.ts";
import { BreakpointWidgetContext } from "./breakpointInput.ts";

const FILE = Uri.file("/w/a.cpp");
const TEXT = "int a;\n    int b;\nint c;\nint d;\n";

interface IFakeEditor extends IBreakpointEditor {
    glyphs: readonly IGlyphMarginDecoration[];
    highlights: readonly ILineHighlightDecoration[];
    insertions: readonly IInlineInsertion[];
    reserved: boolean;
    languageId: string;
    readonly document: TextDocument;
    click(click: Partial<IGlyphMarginClick> & Pick<IGlyphMarginClick, "line">): void;
    /** Inserts `text` at `character` of `line`. */
    edit(line: number, text: string, character?: number): void;
    changeLanguage(languageId: string): void;
}

function fakeEditor(uri = FILE, languageId = "cpp"): IFakeEditor {
    const document = new TextDocument(TEXT);
    const clicks = new Emitter<IGlyphMarginClick>();
    const content = new Emitter<void>();
    const language = new Emitter<void>();
    const editor: IFakeEditor = {
        uri,
        languageId,
        document,
        viewState: { document },
        glyphs: [],
        highlights: [],
        insertions: [],
        reserved: false,
        setGlyphMarginDecorations: (owner, decorations) => {
            expect(owner).toBe(DEBUG_GLYPH_OWNER);
            editor.glyphs = decorations;
        },
        setGlyphMarginReserved: (reserved) => {
            editor.reserved = reserved;
        },
        setLineHighlightDecorations: (decorations) => {
            editor.highlights = decorations;
        },
        setOwnedInlineInsertions: (owner, insertions) => {
            expect(owner).toBe(DEBUG_GLYPH_OWNER);
            editor.insertions = insertions;
        },
        onDidClickGlyphMargin: (listener) => clicks.event(listener),
        onDidChangeContent: (listener) => content.event(listener),
        onDidChangeLanguage: (listener) => language.event(listener),
        click: (click) => {
            clicks.fire({ button: "left", shiftKey: false, altKey: false, screenX: 0, screenY: 0, ...click });
        },
        edit: (line, text, character = 0) => {
            document.applyEdits([createTextEdit(createRange(line, character, line, character), text)]);
            content.fire();
        },
        changeLanguage: (id) => {
            editor.languageId = id;
            language.fire();
        },
    };
    return editor;
}

/**
 * A stopped thread of a session of its own with frames at these 1-based lines (of `FILE` unless a `Uri` is given);
 * its first frame is the top one, unless `noTop` (a thread whose top frame is not known).
 */
function stoppedThread(lines: readonly (number | [Uri, number])[], noTop = false): IStackFrame[] {
    const session = { configuration: {} } as IDebugSession;
    const thread = { stopped: true, session } as unknown as IThread & { stopped: boolean };
    const frames = lines.map((spec, index) => {
        const [uri, line] = typeof spec === "number" ? [FILE, spec] : spec;
        const frame = {
            source: { uri },
            range: { startLineNumber: line },
            getId: () => `${String(index)}@${String(line)}`,
            equals: (other: IStackFrame) => other === frame,
            thread,
        } as unknown as IStackFrame;
        return frame;
    });
    Object.assign(thread, { getCallStack: () => frames, getTopStackFrame: () => (noTop ? undefined : frames[0]) });
    Object.assign(session, { getAllThreads: () => [thread] });
    return frames;
}

describe("BreakpointEditorContribution", () => {
    let fx: IDebugServiceFixture;
    let open: IFakeEditor[];
    let editorsChanged: Emitter<void>;
    let input: { show: ReturnType<typeof vi.fn>; confirmRemoval: ReturnType<typeof vi.fn> };
    let contribution: BreakpointEditorContribution;
    let editor: IFakeEditor;
    let iconsChanged: Emitter<void>;
    let callStackChanged: Emitter<void>;
    let stateChanged: Emitter<State>;

    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const glyphLines = (e = editor) => e.glyphs.map((g) => [g.line, g.glyph]);

    beforeEach(() => {
        fx = createDebugServiceFixture();
        registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING);
        fx.service.getAdapterManager().registerBreakpoints({ language: "cpp" });
        editor = fakeEditor();
        open = [editor];
        editorsChanged = new Emitter<void>();
        const source: IBreakpointEditorSource = {
            getEditors: () => open,
            onDidChangeEditors: (listener) => editorsChanged.event(listener),
        };
        input = { show: vi.fn().mockResolvedValue(undefined), confirmRemoval: vi.fn().mockResolvedValue(undefined) };
        iconsChanged = new Emitter<void>();
        callStackChanged = new Emitter<void>();
        stateChanged = new Emitter<State>();
        // The fixture's own instances: the getters are shadowed for this test only.
        Object.defineProperty(fx.service.getModel(), "onDidChangeCallStack", { get: () => callStackChanged.event });
        Object.defineProperty(fx.service, "onDidChangeState", { get: () => stateChanged.event });
        contribution = new BreakpointEditorContribution(
            source,
            fx.service,
            fx.configuration,
            { codicon: (name) => name, onDidChange: iconsChanged.event },
            input as unknown as BreakpointInput,
        );
    });

    afterEach(() => {
        contribution.dispose();
        fx.service.dispose();
    });

    describe("clicks on the lane", () => {
        it("on an empty line adds a breakpoint; on a line where none can be set, nothing", async () => {
            editor.click({ line: 2 });
            await settle();
            expect(glyphLines()).toEqual([[2, "debug-breakpoint"]]);

            const notes = fakeEditor(Uri.file("/w/notes.txt"), "plaintext");
            open.push(notes);
            editorsChanged.fire();
            notes.click({ line: 0 });
            await settle();
            expect(fx.service.getModel().getBreakpoints()).toHaveLength(1);
            expect(notes.reserved).toBe(false);
            expect(editor.reserved).toBe(true);
        });

        it("Alt on an empty line asks for a condition, Alt on a breakpoint edits it", async () => {
            editor.click({ line: 1, altKey: true });
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 3, column: 2 }]);
            editor.click({ line: 2, altKey: true });
            await settle();
            expect(input.show.mock.calls).toEqual([
                [FILE, 2, undefined, BreakpointWidgetContext.CONDITION],
                [FILE, 3, 2],
            ]);
        });

        it("on a breakpoint with a condition asks before removing; on a disabled one enables it", async () => {
            await fx.service.addBreakpoints(FILE, [
                { lineNumber: 1, condition: "x" },
                { lineNumber: 2, enabled: false },
            ]);
            const [conditional, disabled] = fx.service.getModel().getBreakpoints();

            editor.click({ line: 0 });
            editor.click({ line: 1 });
            await settle();

            expect(input.confirmRemoval).toHaveBeenCalledWith([conditional], true);
            expect(disabled.enabled).toBe(true);
            expect(fx.service.getModel().getBreakpoints()).toHaveLength(2);
        });

        it("another owner's glyph or a right click is not the debugger's click", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 2 }]);
            const add = vi.spyOn(fx.service, "addBreakpoints");
            const remove = vi.spyOn(fx.service, "removeBreakpoints");
            // The handler decides before its first await: whatever it asks of the service is asked already.
            editor.click({ line: 0, owner: "testing", key: "t" });
            editor.click({ line: 0, button: "right" });
            editor.click({ line: 1, owner: "testing", key: "t" });
            editor.click({ line: 1, button: "right" });
            expect(add).not.toHaveBeenCalled();
            expect(remove).not.toHaveBeenCalled();

            editor.click({ line: 1, owner: DEBUG_GLYPH_OWNER, key: "bp" });
            expect(remove).toHaveBeenCalledOnce();
        });

        it("without a debugger a click neither sets nor removes a breakpoint", async () => {
            const empty = createDebugServiceFixture();
            await empty.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            const lone = fakeEditor();
            const other = new BreakpointEditorContribution(
                { getEditors: () => [lone], onDidChangeEditors: () => ({ dispose: () => undefined }) },
                empty.service,
                empty.configuration,
                { codicon: (name) => name, onDidChange: Event.None },
                input as unknown as BreakpointInput,
            );
            const add = vi.spyOn(empty.service, "addBreakpoints");
            const remove = vi.spyOn(empty.service, "removeBreakpoints");
            lone.click({ line: 0 });
            lone.click({ line: 3 });
            expect(add).not.toHaveBeenCalled();
            expect(remove).not.toHaveBeenCalled();
            other.dispose();
            empty.service.dispose();
        });

        it("on a line with an enabled and a disabled breakpoint removes both", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 4 }, { lineNumber: 4, column: 2, enabled: false }]);
            editor.click({ line: 3 });
            await vi.waitFor(() => {
                expect(fx.service.getModel().getBreakpoints()).toEqual([]);
            });
        });

        it("on a line where one of the breakpoints has a condition asks before removing", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 4 }, { lineNumber: 4, column: 2, condition: "x" }]);
            editor.click({ line: 3 });
            expect(input.confirmRemoval).toHaveBeenCalledWith(fx.service.getModel().getBreakpoints(), true);
        });

        it("a middle click asks for a log message, with `debug.gutterMiddleClickAction` none nothing", async () => {
            const add = vi.spyOn(fx.service, "addBreakpoints");
            editor.click({ line: 0, button: "middle" });
            await fx.configuration.updateValue("debug.gutterMiddleClickAction", "none");
            editor.click({ line: 1, button: "middle" });
            expect(input.show.mock.calls).toEqual([[FILE, 1, undefined, BreakpointWidgetContext.LOG_MESSAGE]]);
            expect(add).not.toHaveBeenCalled();
        });
    });

    describe("editors and redraws", () => {
        it("an opened editor is drawn at once and decorated from scratch; opened twice, it is clicked once", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            const second = fakeEditor();
            const deltaDecorations = vi.spyOn(second.document, "deltaDecorations");
            open.push(second);
            editorsChanged.fire();
            expect(glyphLines(second)).toEqual([[0, "debug-breakpoint"]]);
            expect(deltaDecorations.mock.calls[0][0]).toEqual([]);

            editorsChanged.fire();
            const add = vi.spyOn(fx.service, "addBreakpoints");
            const remove = vi.spyOn(fx.service, "removeBreakpoints");
            second.click({ line: 2 });
            expect(add).toHaveBeenCalledOnce();
            expect(remove).not.toHaveBeenCalled();
        });

        it("a closed editor is neither clicked nor drawn; opened again, it is drawn again", async () => {
            const add = vi.spyOn(fx.service, "addBreakpoints");
            open = [];
            editorsChanged.fire();
            editor.click({ line: 0 });
            expect(add).not.toHaveBeenCalled();

            const drawn = editor.glyphs;
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            await settle();
            expect(editor.glyphs).toBe(drawn);

            open = [editor];
            editorsChanged.fire();
            expect(glyphLines()).toEqual([[0, "debug-breakpoint"]]);
        });

        it("dispose takes the breakpoints' decorations off the documents", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            await settle();
            const deltaDecorations = vi.spyOn(editor.document, "deltaDecorations");
            contribution.dispose();
            expect(deltaDecorations).toHaveBeenCalledWith([expect.any(String)], []);
        });

        it("a redraw replaces the previous decorations", async () => {
            const deltaDecorations = vi.spyOn(editor.document, "deltaDecorations");
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            await settle();
            iconsChanged.fire();
            await settle();
            expect(deltaDecorations.mock.calls[1][0]).toEqual(deltaDecorations.mock.results[0].value);
        });

        it("the call stack, the debug state and the icons each redraw, a batch of them once", async () => {
            const draw = vi.spyOn(editor, "setGlyphMarginDecorations");
            for (const fire of [
                () => {
                    callStackChanged.fire();
                },
                () => {
                    stateChanged.fire(State.Stopped);
                },
                () => {
                    iconsChanged.fire();
                },
            ]) {
                fire();
                await settle();
            }
            expect(draw).toHaveBeenCalledTimes(3);

            callStackChanged.fire();
            stateChanged.fire(State.Running);
            iconsChanged.fire();
            await settle();
            expect(draw).toHaveBeenCalledTimes(4);
        });
    });

    describe("glyphs", () => {
        it("one per line, the first breakpoint's; a column breakpoint rides its column and is sent with it", async () => {
            await fx.service.addBreakpoints(FILE, [
                { lineNumber: 2, column: 9 },
                { lineNumber: 2, condition: "c" },
            ]);
            await settle();
            expect(glyphLines()).toEqual([[1, "debug-breakpoint"]]);

            editor.edit(1, "  ");
            await settle();
            const [column] = fx.service
                .getModel()
                .getBreakpoints()
                .filter((bp) => bp.column !== undefined);
            expect(column.column).toBe(11);
        });

        it("only this file's breakpoints, up to its last line", async () => {
            await fx.service.addBreakpoints(Uri.file("/w/b.cpp"), [{ lineNumber: 2 }]);
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 5 }, { lineNumber: 6 }]);
            await settle();
            expect(editor.document.lineCount).toBe(5);
            expect(glyphLines()).toEqual([[4, "debug-breakpoint"]]);
        });

        it("a column breakpoint typed in front of moves on and is sent on save", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1, column: 1 }]);
            await settle();
            const update = vi.spyOn(fx.service, "updateBreakpoints");
            editor.edit(0, "x");
            expect(update).toHaveBeenCalledWith(FILE, expect.any(Map), true);
            expect(fx.service.getModel().getBreakpoints()[0].column).toBe(2);
        });

        it("a breakpoint rides its line's first non-blank character, not the whole line", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }, { lineNumber: 2 }]);
            await settle();
            const update = vi.spyOn(fx.service, "updateBreakpoints");
            // Past the first character of `int a;`: the breakpoint's decoration is untouched.
            editor.edit(0, "x", 3);
            expect(update).not.toHaveBeenCalled();
            // In the indentation of `    int b;`: the code goes down, and the breakpoint with it.
            editor.edit(1, "\n", 2);
            expect(
                fx.service
                    .getModel()
                    .getBreakpoints()
                    .map((bp) => bp.lineNumber),
            ).toEqual([1, 3]);
        });

        it("an edit below a breakpoint moves nothing and draws the glyphs again where the breakpoints are", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            await settle();
            const update = vi.spyOn(fx.service, "updateBreakpoints");
            const drawn = editor.glyphs;

            editor.edit(3, "// below\n");

            expect(update).not.toHaveBeenCalled();
            expect(editor.glyphs).not.toBe(drawn);
            expect(glyphLines()).toEqual([[0, "debug-breakpoint"]]);
        });

        it("an edit in a file without breakpoints draws nothing again", () => {
            const drawn = editor.glyphs;
            editor.edit(0, "// top\n");
            expect(editor.glyphs).toBe(drawn);
        });

        it("the overview ruler by `debug.showBreakpointsInOverviewRuler`; other settings draw nothing again", async () => {
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            await settle();
            expect(editor.glyphs[0].overviewRulerColorToken).toBeUndefined();

            const drawn = editor.glyphs;
            await fx.configuration.updateValue("debug.openDebug", "neverOpen");
            await settle();
            expect(editor.glyphs).toBe(drawn);

            await fx.configuration.updateValue("debug.showBreakpointsInOverviewRuler", true);
            await settle();
            expect(editor.glyphs[0].overviewRulerColorToken).toBe("debugIcon.breakpointForeground");
        });

        it("`debug.allowBreakpointsEverywhere` gives a file of any language the lane", async () => {
            editor.changeLanguage("plaintext");
            expect(editor.reserved).toBe(false);
            await fx.configuration.updateValue("debug.allowBreakpointsEverywhere", true);
            await settle();
            expect(editor.reserved).toBe(true);
        });

        it("a language change decides the lane again; a closed editor loses its decorations", async () => {
            editor.changeLanguage("plaintext");
            expect(editor.reserved).toBe(false);

            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            await settle();
            const deltaDecorations = vi.spyOn(editor.document, "deltaDecorations");
            open = [];
            editorsChanged.fire();
            expect(deltaDecorations).toHaveBeenCalledWith([expect.any(String)], []);
        });
    });

    describe("stack frames", () => {
        /** These threads' sessions stopped, `focused` the focused frame; a redraw. */
        const stop = async (threads: readonly IStackFrame[][], focused: IStackFrame | undefined) => {
            vi.spyOn(fx.service.getModel(), "getSessions").mockReturnValue(threads.map((t) => t[0].thread.session));
            vi.spyOn(fx.service.getViewModel(), "focusedStackFrame", "get").mockReturnValue(focused);
            iconsChanged.fire();
            await settle();
        };
        const highlightKeys = () => editor.highlights.map((h) => [h.key, h.colorToken]);
        const frameGlyphs = () => editor.glyphs.map((g) => [g.key, g.line, g.glyph, g.colorToken]);

        it("the same top frame of two sessions is drawn once, with the glyph of the focused session", async () => {
            const [firstFrame] = stoppedThread([3]);
            const [secondFrame] = stoppedThread([3]);
            for (const focus of [secondFrame, firstFrame]) {
                await stop([[firstFrame], [secondFrame]], focus);
                expect(editor.highlights).toEqual([
                    { key: "top:2", line: 2, colorToken: "editor.stackFrameHighlightBackground" },
                ]);
                expect(frameGlyphs()).toEqual([
                    ["top-stack-frame", 2, "debug-stackframe", "debugIcon.breakpointCurrentStackframeForeground"],
                ]);
            }
        });

        it("a focused frame below the top one: both highlighted, each with its glyph", async () => {
            const frames = stoppedThread([3, 1]);
            await stop([frames], frames[1]);
            expect(highlightKeys()).toEqual([
                ["focused:0", "editor.focusedStackFrameHighlightBackground"],
                ["top:2", "editor.stackFrameHighlightBackground"],
            ]);
            expect(frameGlyphs()).toEqual([
                ["focused-stack-frame", 0, "debug-stackframe-focused", "debugIcon.breakpointStackframeForeground"],
                ["top-stack-frame", 2, "debug-stackframe", "debugIcon.breakpointCurrentStackframeForeground"],
            ]);
        });

        it("another session's frame is highlighted without a glyph; another file's frame is not drawn", async () => {
            const focused = stoppedThread([3]);
            await stop([focused, stoppedThread([1]), stoppedThread([[Uri.file("/w/b.cpp"), 2]])], focused[0]);
            expect(highlightKeys()).toEqual([
                ["top:2", "editor.stackFrameHighlightBackground"],
                ["top:0", "editor.stackFrameHighlightBackground"],
            ]);
            expect(frameGlyphs().map(([, line]) => line)).toEqual([2]);
        });

        it("frames on the file's first and last lines are drawn, frames outside it are not", async () => {
            expect(editor.document.lineCount).toBe(5);
            const threads = [stoppedThread([0]), stoppedThread([1]), stoppedThread([5]), stoppedThread([6])];
            await stop(threads, threads[1][0]);
            expect(editor.highlights.map((h) => h.line)).toEqual([0, 4]);
        });

        it("a running thread's frames are not drawn", async () => {
            const frames = stoppedThread([2]);
            Object.assign(frames[0].thread, { stopped: false });
            await stop([frames], frames[0]);
            expect(editor.highlights).toEqual([]);
        });

        it("a thread without a known top frame: its frame is drawn as a focused one", async () => {
            const frames = stoppedThread([2], true);
            await stop([frames], frames[0]);
            expect(highlightKeys()).toEqual([["focused:1", "editor.focusedStackFrameHighlightBackground"]]);
        });

        it("the frame's glyph is combined with a plain or conditional breakpoint of its line, not with a disabled one", async () => {
            await fx.service.addBreakpoints(FILE, [
                { lineNumber: 1 },
                { lineNumber: 2, condition: "x" },
                { lineNumber: 3, enabled: false },
            ]);
            await settle();
            for (const [line, glyph] of [
                [1, "debug-stackframe-active"],
                [2, "debug-stackframe-active"],
                [3, "debug-stackframe"],
            ] as const) {
                const frames = stoppedThread([line]);
                await stop([frames], frames[0]);
                expect(editor.glyphs.find((g) => g.line === line - 1)?.glyph).toBe(glyph);
            }
        });
    });
});
