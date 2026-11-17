import { describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { NO_DELAY_TIMING, registerSyntheticDebugger } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { toggleEditorBreakpointAction } from "./debugEditorActions.ts";

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
