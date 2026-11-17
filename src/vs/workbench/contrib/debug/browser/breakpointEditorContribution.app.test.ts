// Breakpoints and stack frames in the editor's glyph lane on the whole workbench with the synthetic debugger, whose
// program's sources are real files here: F9 and the lane's clicks, the glyph riding its line, the stop that opens
// the frame's file with the line highlighted, the unverified glyph of a file the adapter does not know.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { compositeOver } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import type { IBreakpoint } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

/** `int lineN = N;` on line N: a line's text names it. */
const SOURCE = Array.from({ length: 80 }, (_, i) => `int line${String(i + 1)} = ${String(i + 1)};`).join("\n");

describe("Breakpoints in the editor's glyph lane", () => {
    let root: string;
    let main: string;
    let t: IDebugViewletHarness;
    let registrations: IDisposable[];
    let synthetic: ReturnType<typeof registerSyntheticDebugger>;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-breakpoints-")));
        main = path.join(root, "src", "main.cpp");
        fs.mkdirSync(path.dirname(main));
        fs.writeFileSync(main, SOURCE);
        t = await createDebugViewletHarness(root);
        // The candidate locations of the synthetic adapter would split the lines' texts the tests look for.
        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.showInlineBreakpointCandidates", false);
        const adapters = t.h.container.get(DebugServiceDIToken).getAdapterManager();
        synthetic = registerSyntheticDebugger(adapters, NO_DELAY_TIMING, root);
        const adapterDisposal = {
            dispose: () => {
                for (const adapter of synthetic.factory.adapters) adapter.dispose();
            },
        };
        registrations = [synthetic, adapterDisposal];
    });

    afterEach(async () => {
        await t.dispose();
        for (const registration of registrations) registration.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    });

    function editors(): IEditorService {
        return t.h.container.get(EditorServiceDIToken);
    }

    function breakpoints(): readonly IBreakpoint[] {
        return t.h.container.get(DebugServiceDIToken).getModel().getBreakpoints();
    }

    /** Opens `file` with the cursor on `line` (1-based), its language allowed breakpoints. */
    async function open(file: string, line = 1): Promise<TextEditorPane> {
        editors().openFile(file);
        const editor = editors().getActiveEditor();
        if (editor === null) throw new Error(`${file} did not open`);
        registrations.push(
            t.h.container
                .get(DebugServiceDIToken)
                .getAdapterManager()
                .registerBreakpoints({ language: editor.languageId }),
        );
        editor.goToPosition(line - 1, 0);
        // The contribution redraws the lanes once per batch of changes.
        await new Promise((resolve) => setTimeout(resolve));
        return editor;
    }

    /**
     * The lane's cell on the screen row of the text `int lineN`: the line numbers are two columns wide, right-aligned,
     * and the lane is two columns left of them.
     */
    function laneOf(line: number): Point {
        const row = t.find(`int line${String(line)} =`);
        const text = t.lines()[row.y];
        const numberEnd = text.slice(0, row.x).trimEnd().length;
        return new Point(numberEnd - 4, row.y);
    }

    function glyphAt(line: number): string {
        const lane = laneOf(line);
        return t.lines()[lane.y][lane.x];
    }

    function fgAt(cell: Point): number | undefined {
        return t.h.testApp.backend.getFgAt(cell);
    }

    /** A press and release at a cell. */
    function click(
        cell: Point,
        button: MouseToken["button"] = "left",
        { shiftKey = false, altKey = false } = {},
    ): void {
        const token = (action: MouseToken["action"]): MouseToken => ({
            kind: "mouse",
            button,
            action,
            x: cell.x + 1,
            y: cell.y + 1,
            shiftKey,
            altKey,
            ctrlKey: false,
            raw: "",
        });
        t.h.testApp.backend.simulateMouse(token("press"));
        t.h.testApp.backend.simulateMouse(token("release"));
    }

    it("F9 sets a breakpoint on the cursor's line, drawn in the lane in its color; F9 again removes it", async () => {
        await open(main, 5);
        t.h.testApp.sendKey("F9");

        await vi.waitFor(() => {
            expect(glyphAt(5)).toBe("●");
        });
        expect(breakpoints().map((bp) => bp.lineNumber)).toEqual([5]);
        expect(fgAt(laneOf(5))).toBe(t.vars()["debugIcon.breakpointForeground"]);
        expect(glyphAt(4)).toBe(" ");

        t.h.testApp.sendKey("F9");
        await vi.waitFor(() => {
            expect(glyphAt(5)).toBe(" ");
        });
        expect(breakpoints()).toEqual([]);
    });

    it("F9 in a file whose language allows no breakpoints sets none", async () => {
        const notes = path.join(root, "notes.txt");
        fs.writeFileSync(notes, "int line1 = 1;\n");
        editors().openFile(notes);

        t.h.testApp.sendKey("F9");
        await Promise.resolve();

        expect(breakpoints()).toEqual([]);

        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.allowBreakpointsEverywhere", true);
        t.h.testApp.sendKey("F9");
        await vi.waitFor(() => {
            expect(breakpoints().map((bp) => bp.uri.fsPath)).toEqual([notes]);
        });
    });

    it("the glyph rides its line through an insertion above, and so does the breakpoint", async () => {
        const editor = await open(main, 5);
        t.h.testApp.sendKey("F9");
        await vi.waitFor(() => {
            expect(glyphAt(5)).toBe("●");
        });

        editor.viewState.document.applyEdits([createTextEdit(createRange(1, 0, 1, 0), "// two\n// lines\n")]);

        await vi.waitFor(() => {
            expect(breakpoints().map((bp) => bp.lineNumber)).toEqual([7]);
        });
        // `int line5` is on the 7th line now; its glyph went with it.
        expect(glyphAt(5)).toBe("●");
        expect(t.lines()[laneOf(5).y]).toContain(" 7 ");
    });

    it("a click on the empty lane adds, Shift+click disables and enables, a click removes", async () => {
        await open(main);
        click(laneOf(3));
        await vi.waitFor(() => {
            expect(glyphAt(3)).toBe("●");
        });

        click(laneOf(3), "left", { shiftKey: true });
        await vi.waitFor(() => {
            expect(breakpoints()[0].enabled).toBe(false);
        });
        expect(fgAt(laneOf(3))).toBe(t.vars()["debugIcon.breakpointDisabledForeground"]);

        click(laneOf(3), "left", { shiftKey: true });
        await vi.waitFor(() => {
            expect(breakpoints()[0].enabled).toBe(true);
        });

        click(laneOf(3));
        await vi.waitFor(() => {
            expect(breakpoints()).toEqual([]);
        });
        expect(glyphAt(3)).toBe(" ");
    });

    it("a middle click asks for a log message by `debug.gutterMiddleClickAction`; none does nothing", async () => {
        await open(main);
        click(laneOf(4), "middle");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Message to log when breakpoint is hit");
        });
        t.h.testApp.sendKey("Escape");

        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.gutterMiddleClickAction", "none");
        click(laneOf(4), "middle");
        await Promise.resolve();
        expect(t.screen()).not.toContain("Message to log");
        expect(breakpoints()).toEqual([]);
    });

    it("a stop opens the frame's file at its line: the line highlighted, the frame's glyph combined with the breakpoint's", async () => {
        await open(main, 27);
        t.h.testApp.sendKey("F9");
        await vi.waitFor(() => {
            expect(glyphAt(27)).toBe("●");
        });
        // Another file in the active group: the stop brings main.cpp back.
        const other = path.join(root, "other.cpp");
        fs.writeFileSync(other, "int other = 0;\n");
        editors().openFile(other);

        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.focusEditorOnBreak", false);
        await t.h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
            expect(editors().getActiveEditor()?.uri.fsPath).toBe(main);
            expect(glyphAt(27)).toBe("◉");
        });
        const vars = t.vars();
        const lane = laneOf(27);
        expect(fgAt(lane)).toBe(vars["debugIcon.breakpointCurrentStackframeForeground"]);
        // The whole row, past the text and away from the cursor.
        const bgAfter = (text: string): number | undefined =>
            t.h.testApp.backend.getBgAt(new Point(t.find(text).x + 20, t.find(text).y));
        expect(bgAfter("int line27 =")).toBe(
            compositeOver(vars["editor.stackFrameHighlightBackground"], vars["editor.background"]),
        );
        expect(bgAfter("int line28 =")).toBe(vars["editor.background"]);
        // The adapter verified the breakpoint: the plain dot is under the frame, no unverified circle anywhere.
        expect(breakpoints()[0].verified).toBe(true);

        // Another frame focused: its line in the focused frame's color, its glyph the focused frame's.
        const debugService = t.h.container.get(DebugServiceDIToken);
        const thread = debugService.getViewModel().focusedThread;
        // The rest of the frames come after the top one.
        const process = await vi.waitFor(() => {
            const frame = thread?.getCallStack().find((f) => f.name.startsWith("process("));
            expect(frame).toBeDefined();
            return frame;
        });
        await debugService.focusStackFrame(process, thread, undefined, { explicit: true });
        await vi.waitFor(() => {
            expect(fgAt(laneOf(47))).toBe(vars["debugIcon.breakpointStackframeForeground"]);
        });
        expect(glyphAt(47)).toBe("➜");
        expect(bgAfter("int line47 =")).toBe(
            compositeOver(vars["editor.focusedStackFrameHighlightBackground"], vars["editor.background"]),
        );
    });

    it("during a session a breakpoint the adapter cannot verify is the unverified circle", async () => {
        const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-breakpoints-other-")));
        const util = path.join(elsewhere, "util.cpp");
        fs.writeFileSync(util, SOURCE);
        try {
            // Below the debug toolbar, which covers the first rows of the group.
            await open(util, 10);
            t.h.testApp.sendKey("F9");
            await vi.waitFor(() => {
                expect(glyphAt(10)).toBe("●");
            });

            await t.h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
            await vi.waitFor(() => {
                expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
            });
            await editors().openUri(Uri.file(util));
            await vi.waitFor(() => {
                expect(glyphAt(10)).toBe("○");
            });
            expect(fgAt(laneOf(10))).toBe(t.vars()["debugIcon.breakpointUnverifiedForeground"]);
        } finally {
            fs.rmSync(elsewhere, { recursive: true, force: true });
        }
    });

    it("Alt+click on the empty lane asks for a condition: what is typed goes to the input, not into the file", async () => {
        const editor = await open(main);
        click(laneOf(5), "left", { altKey: true });
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Break when expression evaluates to true");
        });
        typeText(t.h.testApp, "x > 1");
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(breakpoints().map((b) => [b.lineNumber, b.condition])).toEqual([[5, "x > 1"]]);
        });
        expect(editor.viewState.document.getText()).toBe(SOURCE);
    });

    it("deleting a breakpoint's line leaves the lane and the breakpoints in agreement", async () => {
        const editor = await open(main, 5);
        t.h.testApp.sendKey("F9");
        await vi.waitFor(() => {
            expect(glyphAt(5)).toBe("●");
        });
        editor.viewState.document.applyEdits([createTextEdit(createRange(4, 0, 5, 0), "")]);
        await new Promise((resolve) => setTimeout(resolve));
        // Line 5 is now `int line6`: whatever happened to the breakpoint, the lane shows it where the model has it.
        const modelLines = breakpoints().map((b) => b.lineNumber);
        // Document lines 4, 5, 6 now hold the texts `int line4`, `int line6`, `int line7`.
        const glyphLines = [
            [4, 4],
            [5, 6],
            [6, 7],
        ]
            .filter(([, text]) => glyphAt(text) === "●")
            .map(([line]) => line);
        expect(glyphLines).toEqual(modelLines);
    });

    it("by default the stop focuses the frame's editor (`debug.focusEditorOnBreak`)", async () => {
        await open(main, 27);
        t.h.testApp.sendKey("F9");
        // The focus away from the editors before the stop.
        await t.h.commands.execute("workbench.view.explorer");
        await vi.waitFor(() => {
            expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("editorTextFocus")).toBe(false);
        });
        await t.h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("editorTextFocus")).toBe(true);
        });
    });

    it("a breakpoint moved by an edit goes to the adapter on the file's save", async () => {
        const editor = await open(main, 27);
        t.h.testApp.sendKey("F9");
        await t.h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
        });
        const [adapter] = synthetic.factory.adapters;
        const sentLines = () =>
            adapter.requests
                .filter((r) => r.command === "setBreakpoints")
                .map((r) =>
                    ((r.arguments as DebugProtocol.SetBreakpointsArguments).breakpoints ?? []).map((b) => b.line),
                );
        adapter.requests.length = 0;

        editor.viewState.document.applyEdits([createTextEdit(createRange(1, 0, 1, 0), "// two\n// lines\n")]);
        await vi.waitFor(() => {
            expect(breakpoints().map((bp) => bp.lineNumber)).toEqual([29]);
        });
        expect(sentLines()).toEqual([]);

        await t.h.commands.execute("workbench.action.files.save");
        await vi.waitFor(() => {
            expect(sentLines()).toEqual([[29]]);
        });
    });
});
