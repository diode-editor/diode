// The debug hover on the whole workbench with the synthetic debugger, whose program's sources are real files here:
// Ctrl+K Ctrl+I over a variable of the stop shows its value, a value with children as a tree under it that the
// keyboard and the mouse expand; Escape closes it; an extension's evaluatable expression provider names the
// expression; without a session the chord is Add Cursors to Line Ends.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Point } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { ViewModel } from "../common/debugViewModel.ts";

import { DebugHoverWidgetDIToken } from "./debugHover.ts";
import { DebugServiceDIToken } from "./debugService.ts";

/** Line 27 is where the synthetic program stops: the locals of `accumulate` on it. */
const SOURCE = [
    ...Array.from({ length: 26 }, (_, i) => `// line ${String(i + 1)}`),
    "    total = nums.size() + count + p.x;",
    "    int unknown_name = 0;",
].join("\n");

describe("Debug hover", () => {
    let root: string;
    let main: string;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-debug-hover-")));
        main = path.join(root, "src", "main.cpp");
        fs.mkdirSync(path.dirname(main));
        fs.writeFileSync(main, SOURCE);
        t = await createDebugViewletHarness(root, root);
    });

    afterEach(async () => {
        await t.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    });

    function editor(): TextEditorPane {
        const active = t.h.container.get(EditorServiceDIToken).getActiveEditor();
        if (active === null) throw new Error("no active editor");
        return active;
    }

    /** Stops on line 27 and puts the cursor on `word` of that line. */
    async function stopAt(word: string, line = 27): Promise<void> {
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.h.container.get(EditorServiceDIToken).getActiveEditor()?.uri.fsPath).toBe(main);
        });
        const text = SOURCE.split("\n")[line - 1];
        editor().goToPosition(line - 1, text.indexOf(word) + 1);
        editor().focusEditor();
    }

    function showHover(): void {
        t.h.testApp.sendKey("Ctrl+k");
        t.h.testApp.sendKey("Ctrl+i");
    }

    function hoverVisible(): boolean {
        return t.h.container.get(DebugHoverWidgetDIToken).isVisible();
    }

    function click(cell: Point): void {
        for (const action of ["press", "release"] as const) {
            const token: MouseToken = {
                kind: "mouse",
                button: "left",
                action,
                x: cell.x + 1,
                y: cell.y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            };
            t.h.testApp.backend.simulateMouse(token);
        }
    }

    it("over nums: size=1000 over its chunks; Right expands a chunk, the arrows walk it, Escape closes", async () => {
        await stopAt("nums");
        showHover();

        await vi.waitFor(() => {
            expect(t.screen()).toContain("size=1000");
            expect(t.screen()).toContain("[0..99]");
        });
        expect(hoverVisible()).toBe(true);
        // The tree is in a box with the hover colors, the value above a separator.
        const title = t.find("size=1000");
        const chunk = t.find("[0..99]");
        expect(chunk.y).toBe(title.y + 2);
        expect(t.lines()[title.y + 1]).toContain("──");
        // The cursor's row is the tree's selection, the others are on the hover's background.
        expect(t.h.testApp.backend.getBgAt(chunk)).toBe(t.vars()["list.activeSelectionBackground"]);
        expect(t.h.testApp.backend.getBgAt(t.find("[100..199]"))).toBe(t.vars()["editorHoverWidget.background"]);
        // At most the upstream tree's rows: ten chunks fit.
        expect(t.screen()).toContain("[900..999]");

        // The tree has the focus: the keys are its own.
        t.h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[0]: -17");
        });
        // The tree grows to the floor of rows and scrolls past it.
        expect(t.screen()).not.toContain("[900..999]");
        for (let i = 0; i < 20; i++) t.h.testApp.sendKey("ArrowDown");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[19]: ");
        });
        expect(t.screen()).not.toContain("[0]: -17");
        // Upstream's floor of the tree: 15 rows, [5] to [19] with the cursor on the last.
        expect(t.lines().filter((row) => /│ +\[\d+\]: /u.test(row))).toHaveLength(15);

        t.h.testApp.sendKey("Escape");
        expect(hoverVisible()).toBe(false);
        expect(t.screen()).not.toContain("[19]: ");
        // The focus is the editor's again: typing goes to the document.
        t.h.testApp.sendKey("x");
        expect(editor().model.document.getLineContent(26)).toContain("nxums");
    });

    it("a click on a chunk's chevron expands it", async () => {
        await stopAt("nums");
        showHover();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[100..199]");
        });

        const chunk = t.find("[100..199]");
        click(new Point(chunk.x - 2, chunk.y));

        await vi.waitFor(() => {
            expect(t.screen()).toContain("[100]: ");
        });
        expect(hoverVisible()).toBe(true);
    });

    it("over count: the plain value in the hover, Escape closes it", async () => {
        await stopAt("count");
        showHover();

        await vi.waitFor(() => {
            expect(hoverVisible()).toBe(true);
        });
        const box = t.lines().find((row) => /│0 *│/u.test(row));
        expect(box, "a box with the value 0").toBeDefined();
        t.h.testApp.sendKey("Escape");
        expect(hoverVisible()).toBe(false);
    });

    it("an adapter without evaluate for hovers: p.x is looked up in the scopes of the frame", async () => {
        await stopAt("x;");
        const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        if (session === undefined) throw new Error("no session");
        const capabilities = { ...session.capabilities, supportsEvaluateForHovers: false };
        vi.spyOn(session, "capabilities", "get").mockReturnValue(capabilities);
        const evaluate = vi.spyOn(session, "evaluate");

        showHover();

        await vi.waitFor(() => {
            expect(t.lines().some((row) => /│1\.5 *│/u.test(row))).toBe(true);
        });
        expect(evaluate).not.toHaveBeenCalled();
    });

    it("an adapter with evaluate for hovers gets the expression in the hover context at its location", async () => {
        await stopAt("count");
        const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        if (session === undefined) throw new Error("no session");
        const evaluate = vi.spyOn(session, "evaluate");

        showHover();

        await vi.waitFor(() => {
            expect(hoverVisible()).toBe(true);
        });
        const [expression, , context, location] = evaluate.mock.calls[0];
        expect([expression, context]).toEqual(["count", "hover"]);
        expect(location?.line).toBe(27);
        expect(location?.column).toBe(SOURCE.split("\n")[26].indexOf("count") + 1);
        expect(location?.source.path).toBe(main);
    });

    /** A language hover with a text of its own: where the debugger has no value, it shows. */
    function registerLanguageHover(): void {
        t.h.container.get(LanguageFeaturesServiceDIToken).hoverProvider.register("*", {
            provideHover: () => Promise.resolve({ contents: ["the language hover"] }),
        });
    }

    it("a name the debugger does not know: the language hover instead", async () => {
        registerLanguageHover();
        await stopAt("unknown_name", 28);
        showHover();

        await vi.waitFor(() => {
            expect(t.screen()).toContain("the language hover");
        });
        expect(hoverVisible()).toBe(false);
    });

    it("a file that is not the focused frame's: the language hover", async () => {
        registerLanguageHover();
        await stopAt("nums");
        const other = path.join(root, "other.cpp");
        fs.writeFileSync(other, "int nums = 0;\n");
        t.h.container.get(EditorServiceDIToken).openFile(other);
        editor().goToPosition(0, 5);
        editor().focusEditor();

        showHover();

        await vi.waitFor(() => {
            expect(t.screen()).toContain("the language hover");
        });
        expect(hoverVisible()).toBe(false);
    });

    it("an extension's evaluatable expression provider names the expression", async () => {
        const provided: unknown[] = [];
        const registration = t.h.container
            .get(LanguageFeaturesServiceDIToken)
            .evaluatableExpressionProvider.register("*", {
                provideEvaluatableExpression: (request) => {
                    provided.push(request.position);
                    return Promise.resolve({ range: createRange(26, 4, 26, 9), expression: "p" });
                },
            });
        await stopAt("total");
        showHover();

        await vi.waitFor(() => {
            expect(t.screen()).toContain("{x:1.5, y:-2}");
            expect(t.screen()).toContain("y: -2");
        });
        expect(provided).toEqual([{ line: 26, character: 5 }]);
        registration.dispose();
    });

    it("no focused frame in debug mode: the language hover", async () => {
        registerLanguageHover();
        await stopAt("nums");
        const viewModel = t.h.container.get(DebugServiceDIToken).getViewModel() as ViewModel;
        viewModel.setFocus(undefined, undefined, viewModel.focusedSession, false);

        showHover();

        await vi.waitFor(() => {
            expect(t.screen()).toContain("the language hover");
        });
        expect(hoverVisible()).toBe(false);
    });

    it("from the palette without an editor: nothing to hover", async () => {
        await stopAt("nums");
        await t.h.commands.execute("workbench.action.closeAllEditors");
        expect(t.h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();

        await t.h.commands.execute("editor.debug.action.showDebugHover");

        expect(hoverVisible()).toBe(false);
    });

    it("a continue closes the hover", async () => {
        await stopAt("nums");
        showHover();
        await vi.waitFor(() => {
            expect(hoverVisible()).toBe(true);
        });

        await t.h.container.get(DebugServiceDIToken).getViewModel().focusedThread?.continue();

        await vi.waitFor(() => {
            expect(hoverVisible()).toBe(false);
        });
    });

    // The debug keys are global (upstream's when is the debug state only): with the focus in the hover, F10 steps
    // and Shift+F5 stops, as they do from the editor or the Debug Console.
    it("F10 with the focus in the hover steps over: the program runs on and the hover closes", async () => {
        await stopAt("nums");
        showHover();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("size=1000");
        });
        const thread = t.h.container.get(DebugServiceDIToken).getViewModel().focusedThread;
        if (thread === undefined) throw new Error("no thread");
        const next = vi.spyOn(thread, "next");

        t.h.testApp.sendKey("F10");

        await vi.waitFor(() => {
            expect(next).toHaveBeenCalled();
            expect(t.screen()).not.toContain("size=1000");
        });
    });

    it("Shift+F5 with the focus in the hover stops the session", async () => {
        await stopAt("nums");
        showHover();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("size=1000");
        });

        t.h.testApp.sendKey("Shift+F5");

        await vi.waitFor(() => {
            expect(t.h.container.get(DebugServiceDIToken).getModel().getSessions()).toHaveLength(0);
            expect(t.screen()).not.toContain("size=1000");
        });
    });

    it("without a session the chord is not the debug hover's: nothing opens, no Tab is typed", () => {
        t.h.container.get(EditorServiceDIToken).openFile(main);
        editor().focusEditor();

        showHover();

        expect(hoverVisible()).toBe(false);
        expect(editor().model.document.getLineContent(0)).toBe("// line 1");
    });
});
