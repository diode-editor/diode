import { describe, expect, it, vi } from "vitest";

import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { toggleEditorBreakpointAction } from "./debugEditorActions.ts";

// F9 on the whole workbench is in `breakpointEditorContribution.app.test.ts`; here only what it does without an editor.
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
});
