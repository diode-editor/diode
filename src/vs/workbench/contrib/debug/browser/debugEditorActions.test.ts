import { describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { NO_DELAY_TIMING, registerSyntheticDebugger } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { DebugModel } from "../common/debugModel.ts";

import { BreakpointInputDIToken, BreakpointWidgetContext } from "./breakpointInput.ts";
import {
    addLogPointAction,
    conditionalBreakpointAction,
    editBreakpointAction,
    toggleEditorBreakpointAction,
    triggerByBreakpointAction,
} from "./debugEditorActions.ts";

// F9 on the whole workbench is in `breakpointEditorContribution.app.test.ts`; here what it does over a fake editor.
describe("editor.debug.action.toggleBreakpoint", () => {
    it("without an active text editor does nothing", async () => {
        const canSetBreakpointsIn = vi.fn();
        const accessor = {
            get: (token: unknown) =>
                token === EditorServiceDIToken ? { getActiveEditor: () => null } : { canSetBreakpointsIn },
        } as unknown as ServiceAccessor;

        await toggleEditorBreakpointAction.run(accessor);

        expect(canSetBreakpointsIn).not.toHaveBeenCalled();
    });

    it("toggles the breakpoints of the cursors' lines in the editor's file, once per line", async () => {
        const fx = createDebugServiceFixture();
        registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING);
        fx.service.getAdapterManager().registerBreakpoints({ language: "cpp" });
        const file = Uri.file("/w/a.cpp");
        const other = Uri.file("/w/b.cpp");
        await fx.service.addBreakpoints(other, [{ lineNumber: 1 }]);
        await fx.service.addBreakpoints(file, [{ lineNumber: 3 }]);
        const editor = {
            uri: file,
            languageId: "cpp",
            viewState: { selections: [0, 0, 2].map((line) => ({ active: { line } })) },
        };
        const accessor = {
            get: (token: unknown) => (token === EditorServiceDIToken ? { getActiveEditor: () => editor } : fx.service),
        } as unknown as ServiceAccessor;

        await toggleEditorBreakpointAction.run(accessor);

        expect(
            fx.service
                .getModel()
                .getBreakpoints()
                .map((bp) => [bp.uri.path, bp.lineNumber]),
        ).toEqual([
            ["/w/a.cpp", 1],
            ["/w/b.cpp", 1],
        ]);
        fx.service.dispose();
    });
});

describe("the actions that open the breakpoint widget", () => {
    function setup(canSet: boolean, cursor: { line: number; column: number }) {
        const fx = createDebugServiceFixture();
        const file = Uri.file("/w/a.cpp");
        const show = vi.fn().mockResolvedValue(undefined);
        const editor = {
            uri: file,
            languageId: "cpp",
            primaryCursorLine: cursor.line,
            primaryCursorColumn: cursor.column,
        };
        const service = { canSetBreakpointsIn: () => canSet, getModel: () => fx.service.getModel() };
        const accessor = {
            get: (token: unknown) =>
                token === EditorServiceDIToken
                    ? { getActiveEditor: () => editor }
                    : token === BreakpointInputDIToken
                      ? { show }
                      : service,
        } as unknown as ServiceAccessor;
        return { fx, file, show, accessor };
    }

    it("open it at the cursor's line, the logpoint and the trigger at its column too, each in its kind", async () => {
        const { fx, file, show, accessor } = setup(true, { line: 4, column: 6 });
        await conditionalBreakpointAction.run(accessor);
        await addLogPointAction.run(accessor);
        await triggerByBreakpointAction.run(accessor);
        expect(show.mock.calls).toEqual([
            [file, 5, undefined, BreakpointWidgetContext.CONDITION],
            [file, 5, 7, BreakpointWidgetContext.LOG_MESSAGE],
            [file, 5, 7, BreakpointWidgetContext.TRIGGER_POINT],
        ]);
        fx.service.dispose();
    });

    it("do nothing where breakpoints cannot be set, or without an editor", async () => {
        const { fx, show, accessor } = setup(false, { line: 0, column: 0 });
        await conditionalBreakpointAction.run(accessor);
        await editBreakpointAction.run({
            get: (token: unknown) => (token === EditorServiceDIToken ? { getActiveEditor: () => null } : undefined),
        } as unknown as ServiceAccessor);
        expect(show).not.toHaveBeenCalled();
        fx.service.dispose();
    });

    it("Edit Breakpoint: the breakpoint of the cursor's line closest to the cursor, in the editor's file only", async () => {
        const { fx, file, show, accessor } = setup(true, { line: 2, column: 9 });
        await editBreakpointAction.run(accessor);
        expect(show).not.toHaveBeenCalled();

        const model = fx.service.getModel() as DebugModel;
        model.addBreakpoints(Uri.file("/w/other.cpp"), [{ lineNumber: 3, column: 10 }]);
        model.addBreakpoints(file, [
            { lineNumber: 3, column: 2 },
            { lineNumber: 3, column: 12 },
            { lineNumber: 3, column: 5 },
        ]);
        await editBreakpointAction.run(accessor);
        expect(show).toHaveBeenLastCalledWith(file, 3, 12);

        // A breakpoint of the whole line is as far as the cursor's column.
        const second = setup(true, { line: 3, column: 9 });
        (second.fx.service.getModel() as DebugModel).addBreakpoints(second.file, [
            { lineNumber: 4 },
            { lineNumber: 4, column: 30 },
        ]);
        await editBreakpointAction.run(second.accessor);
        expect(second.show).toHaveBeenLastCalledWith(second.file, 4, undefined);
        fx.service.dispose();
        second.fx.service.dispose();
    });
});
