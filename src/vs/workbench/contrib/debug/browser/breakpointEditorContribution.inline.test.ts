// The inline breakpoints and the candidate locations of `BreakpointEditorContribution` over a fake editor with a
// real debug service: which column breakpoints show before their column, which locations of the focused session
// show as candidates by `debug.showInlineBreakpointCandidates`, and a late answer of the adapter.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { NO_DELAY_TIMING, registerSyntheticDebugger } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Emitter, Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IInlineInsertion } from "../../../../editor/common/model/iInlineInsertion.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import type { IDebugSession } from "../common/debug.ts";

import {
    BreakpointEditorContribution,
    DEBUG_GLYPH_OWNER,
    type IBreakpointEditor,
} from "./breakpointEditorContribution.ts";
import type { BreakpointInput } from "./breakpointInput.ts";

const FILE = Uri.file("/w/a.cpp");
/** `sum` at column 5, `numAt` at 12, `nums` at 18, `;` at 29 (1-based); the third line is blank. */
const TEXT = "    sum += numAt(nums.at(i));\n    ++count;\n\n";

interface IFakeEditor extends IBreakpointEditor {
    insertions: readonly IInlineInsertion[];
}

function fakeEditor(): IFakeEditor {
    const document = new TextDocument(TEXT);
    const editor: IFakeEditor = {
        uri: FILE,
        languageId: "cpp",
        viewState: { document },
        insertions: [],
        setGlyphMarginDecorations: () => undefined,
        setGlyphMarginReserved: () => undefined,
        setLineHighlightDecorations: () => undefined,
        setOwnedInlineInsertions: (owner, insertions) => {
            expect(owner).toBe(DEBUG_GLYPH_OWNER);
            editor.insertions = insertions;
        },
        onDidClickGlyphMargin: () => ({ dispose: () => undefined }),
        onDidChangeContent: () => ({ dispose: () => undefined }),
        onDidChangeLanguage: () => ({ dispose: () => undefined }),
    };
    return editor;
}

describe("BreakpointEditorContribution: inline breakpoints and candidates", () => {
    let fx: IDebugServiceFixture;
    let editor: IFakeEditor;
    let open: IFakeEditor[];
    let editorsChanged: Emitter<void>;
    let contribution: BreakpointEditorContribution;
    type Locations = (uri: Uri, lineNumber: number) => Promise<{ lineNumber: number; column: number }[]>;
    let breakpointsLocations: Mock<Locations>;
    let focusedSession: IDebugSession | undefined;

    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const shown = (e = editor) => e.insertions.map((i) => [i.line, i.offset, i.text, i.colorToken]);

    beforeEach(() => {
        fx = createDebugServiceFixture();
        registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING);
        fx.service.getAdapterManager().registerBreakpoints({ language: "cpp" });
        editor = fakeEditor();
        open = [editor];
        editorsChanged = new Emitter<void>();
        breakpointsLocations = vi.fn<Locations>((_uri, lineNumber) =>
            Promise.resolve([1, 5, 12, 18, 30, 31].map((column) => ({ lineNumber, column }))),
        );
        focusedSession = {
            capabilities: { supportsBreakpointLocationsRequest: true },
            breakpointsLocations,
        } as unknown as IDebugSession;
        Object.defineProperty(fx.service.getViewModel(), "focusedSession", { get: () => focusedSession });
        contribution = new BreakpointEditorContribution(
            { getEditors: () => open, onDidChangeEditors: (listener) => editorsChanged.event(listener) },
            fx.service,
            fx.configuration,
            { codicon: (name) => name, onDidChange: Event.None },
            {} as BreakpointInput,
        );
    });

    afterEach(() => {
        contribution.dispose();
        fx.service.dispose();
    });

    it("a column breakpoint past the first non-blank shows before its column, in its icon's color", async () => {
        focusedSession = undefined;
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1, column: 12 }]);
        // On the first non-blank, alone on its line: no inline glyph (the lane's glyph is it).
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 2, column: 5, enabled: false }]);
        await settle();
        expect(editor.insertions.map((i) => [i.line, i.offset, i.text, i.colorToken, i.caretSide])).toEqual([
            [0, 11, "debug-breakpoint", "debugIcon.breakpointForeground", "right"],
        ]);
    });

    it("on the first non-blank, with another breakpoint on the line, it shows too; a line breakpoint never", async () => {
        focusedSession = undefined;
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 2, column: 5 }, { lineNumber: 2 }]);
        await settle();
        expect(shown()).toEqual([[1, 4, "debug-breakpoint", "debugIcon.breakpointForeground"]]);
    });

    it("on a blank line any column shows", async () => {
        focusedSession = undefined;
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 3, column: 1 }]);
        await settle();
        expect(shown()).toEqual([[2, 0, "debug-breakpoint", "debugIcon.breakpointForeground"]]);
    });

    it("the candidates: the session's locations on the breakpoints' lines, past the first non-blank, up to after the last", async () => {
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }, { lineNumber: 1, column: 18 }]);
        await settle();
        await settle();
        // Asked once per line.
        expect(breakpointsLocations.mock.calls).toEqual([[FILE, 1]]);
        expect(shown()).toEqual([
            [0, 17, "debug-breakpoint", "debugIcon.breakpointForeground"],
            // With a breakpoint past the first non-blank, the line's start too; the line breakpoint's location in
            // its own icon; `numAt`; the column after `;`. Not `nums` (the inline one), not past the line's end.
            [0, 0, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 4, "debug-breakpoint", "debugIcon.breakpointForeground"],
            [0, 11, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 29, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
        ]);
    });

    it("no candidates on the line's start without a breakpoint past it", async () => {
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        await settle();
        await settle();
        expect(shown()).toEqual([
            [0, 11, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 17, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 29, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
        ]);
    });

    it("a line the adapter fails on has none; the others still do", async () => {
        breakpointsLocations.mockImplementationOnce(() => Promise.reject(new Error("no")));
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }, { lineNumber: 2 }]);
        await settle();
        await settle();
        expect(breakpointsLocations).toHaveBeenCalledTimes(2);
        // `++count;`: only `numAt`'s column 12 is within it.
        expect(shown()).toEqual([[1, 11, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"]]);
    });

    it("none with the setting off, without a session, or without the capability", async () => {
        await fx.configuration.updateValue("debug.showInlineBreakpointCandidates", false);
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        await settle();
        await settle();
        expect(shown()).toEqual([]);
        expect(breakpointsLocations).not.toHaveBeenCalled();

        await fx.configuration.updateValue("debug.showInlineBreakpointCandidates", true);
        await settle();
        await settle();
        expect(shown()).toHaveLength(3);

        focusedSession = { capabilities: {}, breakpointsLocations } as unknown as IDebugSession;
        await fx.configuration.updateValue("debug.showInlineBreakpointCandidates", false);
        await fx.configuration.updateValue("debug.showInlineBreakpointCandidates", true);
        await settle();
        await settle();
        expect(shown()).toEqual([]);
        expect(breakpointsLocations).toHaveBeenCalledTimes(1);
    });

    it("an answer for a line the document no longer has is left out", async () => {
        let answer: (positions: { lineNumber: number; column: number }[]) => void = () => undefined;
        breakpointsLocations.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 4 }]);
        await settle();
        (editor.viewState.document as TextDocument).applyEdits([createTextEdit(createRange(0, 0, 3, 0), "")]);
        answer([{ lineNumber: 4, column: 1 }]);
        await settle();
        expect(shown()).toEqual([]);
    });

    it("while the adapter is asked, the inline breakpoints show at once and no candidates yet", async () => {
        breakpointsLocations.mockImplementation(() => new Promise(() => undefined));
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1, column: 12 }]);
        await settle();
        expect(shown()).toEqual([[0, 11, "debug-breakpoint", "debugIcon.breakpointForeground"]]);
    });

    it("an editor opened while the adapter is asked shows its inline breakpoints and no candidates yet", async () => {
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1, column: 12 }]);
        await settle();
        breakpointsLocations.mockImplementation(() => new Promise(() => undefined));
        const second = fakeEditor();
        open.push(second);
        editorsChanged.fire();
        expect(shown(second)).toEqual([[0, 11, "debug-breakpoint", "debugIcon.breakpointForeground"]]);
    });

    it("the document's last line has its candidates", async () => {
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 4 }]);
        await settle();
        await settle();
        // The line breakpoint's own location: its icon.
        expect(shown()).toEqual([[3, 0, "debug-breakpoint", "debugIcon.breakpointForeground"]]);
    });

    it("a breakpoint one column past the first non-blank lets the line's start show", async () => {
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }, { lineNumber: 1, column: 6 }]);
        await settle();
        await settle();
        expect(shown()).toEqual([
            [0, 5, "debug-breakpoint", "debugIcon.breakpointForeground"],
            [0, 0, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 4, "debug-breakpoint", "debugIcon.breakpointForeground"],
            [0, 11, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 17, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 29, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
        ]);
    });

    it("each line's candidates look only at that line's breakpoints", async () => {
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }, { lineNumber: 2, column: 12 }]);
        await settle();
        await settle();
        expect(shown()).toEqual([
            [1, 11, "debug-breakpoint", "debugIcon.breakpointForeground"],
            [0, 11, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 17, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [0, 29, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [1, 0, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
            [1, 4, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"],
        ]);
    });

    it("no breakpoints: nothing asked", async () => {
        await fx.configuration.updateValue("debug.showInlineBreakpointCandidates", false);
        await fx.configuration.updateValue("debug.showInlineBreakpointCandidates", true);
        await settle();
        expect(breakpointsLocations).not.toHaveBeenCalled();
    });

    it("a late answer is dropped for a newer one; a closed editor's answer is dropped and its glyphs cleared", async () => {
        const answers: ((positions: { lineNumber: number; column: number }[]) => void)[] = [];
        breakpointsLocations.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answers.push(resolve);
                }),
        );
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        await settle();
        await fx.service.addBreakpoints(FILE, [{ lineNumber: 2 }]);
        await settle();
        expect(answers).toHaveLength(3);
        answers[0]([{ lineNumber: 1, column: 12 }]);
        await settle();
        expect(shown()).toEqual([]);
        answers[1]([{ lineNumber: 1, column: 18 }]);
        answers[2]([]);
        await settle();
        expect(shown()).toEqual([[0, 17, "debug-breakpoint-disabled", "debugIcon.breakpointDisabledForeground"]]);

        await fx.service.addBreakpoints(FILE, [{ lineNumber: 1, column: 12 }]);
        await settle();
        open = [];
        editorsChanged.fire();
        expect(editor.insertions).toEqual([]);
        for (const answer of answers.slice(3)) answer([{ lineNumber: 1, column: 18 }]);
        await settle();
        expect(editor.insertions).toEqual([]);
    });
});
