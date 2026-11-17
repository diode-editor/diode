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
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import type { IDebugSession, IStackFrame, IThread } from "../common/debug.ts";

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
    reserved: boolean;
    languageId: string;
    readonly document: TextDocument;
    click(click: Partial<IGlyphMarginClick> & Pick<IGlyphMarginClick, "line">): void;
    edit(line: number, text: string): void;
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
        onDidClickGlyphMargin: (listener) => clicks.event(listener),
        onDidChangeContent: (listener) => content.event(listener),
        onDidChangeLanguage: (listener) => language.event(listener),
        click: (click) => {
            clicks.fire({ button: "left", shiftKey: false, altKey: false, screenX: 0, screenY: 0, ...click });
        },
        edit: (line, text) => {
            document.applyEdits([createTextEdit(createRange(line, 0, line, 0), text)]);
            content.fire();
        },
        changeLanguage: (id) => {
            editor.languageId = id;
            language.fire();
        },
    };
    return editor;
}

describe("BreakpointEditorContribution", () => {
    let fx: IDebugServiceFixture;
    let open: IFakeEditor[];
    let editorsChanged: Emitter<void>;
    let input: { show: ReturnType<typeof vi.fn>; confirmRemoval: ReturnType<typeof vi.fn> };
    let contribution: BreakpointEditorContribution;
    let editor: IFakeEditor;

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
        contribution = new BreakpointEditorContribution(
            source,
            fx.service,
            fx.configuration,
            { codicon: (name) => name, onDidChange: Event.None },
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

        it("another owner's glyph, a right click, or no debugger at all: not the debugger's click", async () => {
            editor.click({ line: 0, owner: "testing", key: "t" });
            editor.click({ line: 0, button: "right" });
            await settle();
            expect(fx.service.getModel().getBreakpoints()).toEqual([]);

            const empty = createDebugServiceFixture();
            const other = new BreakpointEditorContribution(
                { getEditors: () => [editor], onDidChangeEditors: () => ({ dispose: () => undefined }) },
                empty.service,
                empty.configuration,
                { codicon: (name) => name, onDidChange: Event.None },
                input as unknown as BreakpointInput,
            );
            editor.click({ line: 3 });
            await settle();
            expect(empty.service.getModel().getBreakpoints()).toEqual([]);
            other.dispose();
            empty.service.dispose();
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

    it("the same top frame of two sessions is drawn once, with the glyph of the focused session", async () => {
        const frame = (session: IDebugSession, id: string): IStackFrame => {
            const thread = { stopped: true, session } as unknown as IThread & { stopped: boolean };
            const stackFrame = {
                source: { uri: FILE },
                range: { startLineNumber: 3 },
                getId: () => id,
                equals: (other: IStackFrame) => other === stackFrame,
                thread,
            } as unknown as IStackFrame;
            Object.assign(thread, {
                getCallStack: () => [stackFrame],
                getTopStackFrame: () => stackFrame,
            });
            Object.assign(session, { getAllThreads: () => [thread] });
            return stackFrame;
        };
        const first = { configuration: {} } as IDebugSession;
        const second = { configuration: {} } as IDebugSession;
        const firstFrame = frame(first, "f1");
        const secondFrame = frame(second, "f2");
        vi.spyOn(fx.service.getModel(), "getSessions").mockReturnValue([first, second]);
        const focused = vi.spyOn(fx.service.getViewModel(), "focusedStackFrame", "get");

        for (const focus of [secondFrame, firstFrame]) {
            focused.mockReturnValue(focus);
            // A setting that redraws (the sessions are fakes: adding a breakpoint would send it to them).
            await fx.configuration.updateValue("debug.showBreakpointsInOverviewRuler", focus === secondFrame);
            await settle();
            expect(editor.highlights).toEqual([
                { key: "top:2", line: 2, colorToken: "editor.stackFrameHighlightBackground" },
            ]);
            expect(editor.glyphs.find((g) => g.line === 2)?.glyph).toBe("debug-stackframe");
        }
    });
});
