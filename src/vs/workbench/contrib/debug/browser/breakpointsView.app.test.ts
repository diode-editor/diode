// BREAKPOINTS on the whole workbench: the rows of every kind with their checkbox and icon, Space, Delete and Enter
// through the real keybinding dispatcher, a click on a checkbox, the tree presentation, the title commands, and with
// the synthetic debugger the exception filters of the session, the unverified breakpoints and the hit one.

import { resolve } from "node:path";

import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { SYNTHETIC_PROGRAM_ROOT } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { BREAKPOINTS_VIEW_ID, DataBreakpointSetType, type IBreakpointData } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { type DebugViewletComponent, DebugViewletComponentDIToken } from "./debugViewlet.ts";

const repoRoot = process.cwd();
const sample = Uri.file(resolve(repoRoot, "e2e", "fixtures", "sample.ts"));
const mainCpp = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp`);

describe("BREAKPOINTS in the workbench", () => {
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        t = await createDebugViewletHarness(repoRoot);
        // BREAKPOINTS alone in the sidebar.
        const views = t.h.container.get(ViewsServiceDIToken);
        for (const id of views.getContainerViews("workbench.view.debug").map((v) => v.id)) {
            if (id !== BREAKPOINTS_VIEW_ID) views.setViewVisible(id, false);
        }
    });

    afterEach(async () => {
        await t.dispose();
    });

    function model(): DebugModel {
        return t.h.container.get(DebugServiceDIToken).getModel() as DebugModel;
    }

    async function addBreakpoints(uri: Uri, data: IBreakpointData[]): Promise<void> {
        model().addBreakpoints(uri, data);
        await t.h.container.get(DebugServiceDIToken).sendBreakpoints(uri);
    }

    function view(): DebugViewletComponent["breakpoints"] {
        return t.h.container.get(DebugViewletComponentDIToken).breakpoints;
    }

    /** The cursor on the row of the breakpoint at `line`, from the top with the arrow keys. */
    function cursorToLine(line: number): void {
        const tree = view().tree;
        tree.list.focus();
        tree.list.focusFirst();
        for (let i = 0; i < 20 && (tree.focused as { lineNumber?: number } | undefined)?.lineNumber !== line; i++) {
            t.h.testApp.sendKey("ArrowDown");
        }
        expect((tree.focused as { lineNumber?: number } | undefined)?.lineNumber).toBe(line);
    }

    /** A left click on the cell at `point` (the terminal's mouse coordinates are 1-based). */
    function click(point: Point): void {
        for (const action of ["press", "release"] as const) {
            t.h.testApp.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                action,
                x: point.x + 1,
                y: point.y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
    }

    it("a source breakpoint: checkbox, icon, file, folder and line; a condition and a log message in italics", async () => {
        await addBreakpoints(sample, [
            { lineNumber: 2 },
            { lineNumber: 3, condition: "answer > 1" },
            { lineNumber: 5, logMessage: "greeting {name}" },
        ]);

        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ● sample.ts e2e/fixtures");
        });
        const vars = t.vars();
        const plain = t.find("● sample.ts");
        expect(t.h.testApp.backend.getFgAt(plain)).toBe(vars["debugIcon.breakpointForeground"]);
        expect(t.h.testApp.backend.getFgAt(t.find("e2e/fixtures"))).toBe(vars.descriptionForeground);
        // The line on the right edge, muted: the row up to the sidebar frame's right line.
        const row = t.lines()[plain.y];
        expect(row.slice(0, row.indexOf("│", plain.x)).trimEnd()).toMatch(/ 2 *[█░▀▄]?$/u);
        expect(t.screen()).toContain("◆ sample.ts e2e/fixtures  if answer > 1");
        expect(t.screen()).toContain('◈ sample.ts e2e/fixtures  log "greeting {name}"');
        expect(t.h.testApp.backend.getFgAt(t.find("if answer"))).toBe(vars.descriptionForeground);
        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("breakpointsExist")).toBe(true);
    });

    it("Space disables the breakpoint under the cursor (the icon turns grey), Delete removes it", async () => {
        await addBreakpoints(sample, [{ lineNumber: 2 }, { lineNumber: 3 }]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ● sample.ts");
        });
        cursorToLine(3);
        t.h.container.get(WorkbenchContextKeysDIToken).update();
        const keys = t.h.container.get(ContextKeyServiceDIToken);
        expect(keys.getRaw("breakpointsFocused")).toBe(true);
        expect(keys.getRaw("breakpointItemType")).toBe("breakpoint");

        t.h.testApp.sendKey(" ");

        await vi.waitFor(() => {
            expect(
                model()
                    .getBreakpoints()
                    .find((bp) => bp.lineNumber === 3)?.enabled,
            ).toBe(false);
        });
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[ ] ● sample.ts");
        });
        expect(t.h.testApp.backend.getFgAt(t.find("[ ] ● sample.ts"))).not.toBe(
            t.vars()["debugIcon.breakpointDisabledForeground"],
        );
        const disabled = new Point(t.find("[ ] ● sample.ts").x + 4, t.find("[ ] ● sample.ts").y);
        expect(t.h.testApp.backend.getFgAt(disabled)).toBe(t.vars()["debugIcon.breakpointDisabledForeground"]);

        t.h.testApp.sendKey("Delete");

        await vi.waitFor(() => {
            expect(
                model()
                    .getBreakpoints()
                    .map((bp) => bp.lineNumber),
            ).toEqual([2]);
        });
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("[ ] ● sample.ts");
        });
    });

    it("a click on the checkbox toggles the breakpoint without opening it", async () => {
        await addBreakpoints(sample, [{ lineNumber: 2 }]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ● sample.ts");
        });

        click(t.find("[✓] ● sample.ts"));

        await vi.waitFor(() => {
            expect(model().getBreakpoints()[0].enabled).toBe(false);
        });
        expect(t.h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
    });

    it("Enter opens the file at the breakpoint's line; Ctrl+Enter beside the active editor", async () => {
        await addBreakpoints(sample, [{ lineNumber: 4 }]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ● sample.ts");
        });
        cursorToLine(4);

        t.h.testApp.sendKey("Enter");

        const editors = t.h.container.get(EditorServiceDIToken);
        await vi.waitFor(() => {
            expect(editors.getActiveEditor()?.uri.toString()).toBe(sample.toString());
        });
        expect(editors.getActiveEditor()?.viewState.selections[0].active.line).toBe(3);

        cursorToLine(4);
        t.h.testApp.sendKey("Alt+Enter");

        await vi.waitFor(() => {
            expect(editors.editorGroups.groups).toHaveLength(2);
        });
    });

    it("Add Function Breakpoint asks for the name; the row has the function icon", async () => {
        // The command waits for the name: not awaited here.
        void t.h.commands.execute("workbench.debug.viewlet.action.addFunctionBreakpointAction");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Function to break on");
        });
        typeText(t.h.testApp, "accumulate");
        t.h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ▲ accumulate");
        });
        expect(
            model()
                .getFunctionBreakpoints()
                .map((bp) => bp.name),
        ).toEqual(["accumulate"]);

        // An empty name adds nothing.
        void t.h.commands.execute("workbench.debug.viewlet.action.addFunctionBreakpointAction");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Function to break on");
        });
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("Function to break on");
        });
        expect(model().getFunctionBreakpoints()).toHaveLength(1);
    });

    it("the title commands: deactivate mutes every row, disable and enable all, remove all", async () => {
        // Enable and Disable All need a debugger, as upstream.
        t.registerDebugger();
        await addBreakpoints(sample, [{ lineNumber: 2 }, { lineNumber: 3 }]);
        await t.h.container.get(DebugServiceDIToken).addFunctionBreakpoint({ name: "main" });
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] ▲ main");
        });

        await t.h.commands.execute("workbench.debug.viewlet.action.toggleBreakpointsActivatedAction");

        await vi.waitFor(() => {
            expect(t.h.testApp.backend.getFgAt(t.find("sample.ts"))).toBe(t.vars().descriptionForeground);
        });
        const icon = new Point(t.find("▲ main").x, t.find("▲ main").y);
        expect(t.h.testApp.backend.getFgAt(icon)).toBe(t.vars()["debugIcon.breakpointDisabledForeground"]);
        // Still checked: deactivated, not disabled.
        expect(t.screen()).toContain("[✓] ▲ main");

        await t.h.commands.execute("workbench.debug.viewlet.action.toggleBreakpointsActivatedAction");
        await t.h.commands.execute("workbench.debug.viewlet.action.disableAllBreakpoints");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("[✓]");
        });
        await t.h.commands.execute("workbench.debug.viewlet.action.enableAllBreakpoints");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("[ ]");
        });

        await t.h.commands.execute("workbench.debug.viewlet.action.removeAllBreakpoints");

        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("sample.ts");
        });
        expect(t.screen()).not.toContain("main");
        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("breakpointsExist")).toBe(false);
    });

    it("the tree presentation groups by file: a three-state checkbox, the rows read the source lines", async () => {
        await addBreakpoints(sample, [{ lineNumber: 3 }, { lineNumber: 2, enabled: false }]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("sample.ts");
        });

        await t.h.commands.execute("workbench.debug.viewlet.action.toggleBreakpointsPresentation");

        expect(t.h.container.get(IConfigurationServiceDIToken).get("debug.breakpointsView.presentation")).toBe("tree");
        await vi.waitFor(() => {
            expect(t.screen()).toContain('const greeting = "hello";');
        });
        const folder = t.find("[-] sample.ts e2e/fixtures");
        const first = t.find('const greeting = "hello";');
        const second = t.find("const answer = 42;");
        // Sorted by line, under the file.
        expect(first.y).toBe(folder.y + 1);
        expect(second.y).toBe(folder.y + 2);
        expect(t.lines()[first.y]).toContain("[ ] ●");

        click(folder);

        await vi.waitFor(() => {
            expect(
                model()
                    .getBreakpoints()
                    .every((bp) => bp.enabled),
            ).toBe(true);
        });
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] sample.ts e2e/fixtures");
        });

        await t.h.commands.execute("workbench.debug.viewlet.action.toggleBreakpointsPresentation");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("const answer");
        });
    });

    it("with a session: the exception filters on top, an unverified breakpoint, the hit one under the cursor", async () => {
        await addBreakpoints(sample, [{ lineNumber: 2 }]);
        await addBreakpoints(mainCpp, [{ lineNumber: 27 }]);

        await t.startStopped();

        await vi.waitFor(() => {
            expect(t.screen()).toContain("[ ] C++: on throw");
        });
        const vars = t.vars();
        const throwFilter = t.find("[ ] C++: on throw");
        expect(t.find("[ ] C++: on catch").y).toBe(throwFilter.y + 1);
        // A file outside the program: not verified while debugging, the row muted.
        await vi.waitFor(() => {
            expect(t.screen()).toContain("○ sample.ts");
        });
        expect(t.h.testApp.backend.getFgAt(t.find("○ sample.ts"))).toBe(
            vars["debugIcon.breakpointUnverifiedForeground"],
        );
        expect(t.h.testApp.backend.getFgAt(at(t.find("○ sample.ts"), 2))).toBe(vars.descriptionForeground);
        expect(t.screen()).toContain("● main.cpp");
        await vi.waitFor(() => {
            expect((view().tree.focused as { lineNumber?: number } | undefined)?.lineNumber).toBe(27);
        });

        click(throwFilter);

        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] C++: on throw");
        });
        const adapter = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        expect(adapter).toBeDefined();
        expect(
            model()
                .getExceptionBreakpoints()
                .find((e) => e.filter === "cpp_throw")?.enabled,
        ).toBe(true);
    });
    it("the keys on rows they do not apply to do nothing; Delete removes a data breakpoint; the type of each row", async () => {
        // Reapply needs a session (inDebugMode), as upstream.
        await t.startStopped();
        model().addDataBreakpoint({
            description: "sum",
            src: { type: DataBreakpointSetType.Variable, dataId: "sum" },
            canPersist: false,
            accessTypes: undefined,
            accessType: "write",
        });
        model().addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, canPersist: false, address: 31n });
        await addBreakpoints(sample, [{ lineNumber: 2 }]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("0x1f");
        });
        const [data] = model().getDataBreakpoints();
        const [instruction] = model().getInstructionBreakpoints();
        const throwFilter = model()
            .getExceptionBreakpoints()
            .find((e) => e.filter === "cpp_throw");
        // Opening the view focuses its tree.
        t.h.container.get(ViewsServiceDIToken).openView(BREAKPOINTS_VIEW_ID, true);
        const keys = t.h.container.get(ContextKeyServiceDIToken);
        const typeOf = (element: unknown): unknown => {
            view().tree.reveal(element as never);
            t.h.container.get(WorkbenchContextKeysDIToken).update();
            expect(keys.getRaw("breakpointsFocused")).toBe(true);
            return keys.getRaw("breakpointItemType");
        };
        expect(typeOf(throwFilter)).toBe("exceptionBreakpoint");
        expect(typeOf(instruction)).toBe("instructionBreakpoint");

        // Delete and Open to the Side on an instruction breakpoint, as upstream: nothing.
        const activeEditor = t.h.container.get(EditorServiceDIToken).getActiveEditor();
        await t.h.commands.execute("debug.removeBreakpoint");
        await t.h.commands.execute("debug.openBreakpointToSide");
        expect(model().getInstructionBreakpoints()).toEqual([instruction]);
        expect(t.h.container.get(EditorServiceDIToken).getActiveEditor()).toBe(activeEditor);

        expect(typeOf(data)).toBe("dataBreakpoint");
        await t.h.commands.execute("debug.removeBreakpoint");
        expect(model().getDataBreakpoints()).toEqual([]);

        // Reapply All Breakpoints turns them on again after Deactivate.
        await t.h.commands.execute("workbench.debug.viewlet.action.toggleBreakpointsActivatedAction");
        expect(model().areBreakpointsActivated()).toBe(false);
        await t.h.commands.execute("workbench.debug.viewlet.action.reapplyBreakpointsAction");
        expect(model().areBreakpointsActivated()).toBe(true);
    });

    it("Space with no row under the cursor toggles nothing; a file row has its own type", async () => {
        await t.h.commands.execute("debug.toggleBreakpoint");
        expect(model().getBreakpoints()).toEqual([]);

        await addBreakpoints(sample, [{ lineNumber: 2 }]);
        await t.h.commands.execute("workbench.debug.viewlet.action.toggleBreakpointsPresentation");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("[✓] sample.ts e2e/fixtures");
        });
        t.h.container.get(ViewsServiceDIToken).openView(BREAKPOINTS_VIEW_ID, true);
        view().tree.list.focusFirst();
        t.h.container.get(WorkbenchContextKeysDIToken).update();
        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("breakpointItemType")).toBe("breakpointFolder");

        await t.h.commands.execute("debug.toggleBreakpoint");
        expect(model().getBreakpoints()[0].enabled).toBe(true);
    });
});

function at(point: Point, dx: number): Point {
    return new Point(point.x + dx, point.y);
}
