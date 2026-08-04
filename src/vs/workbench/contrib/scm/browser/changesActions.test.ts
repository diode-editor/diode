import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import {
    scmFocusChangesAction,
    scmFocusInputAction,
    scmOpenChangesAction,
    scmOpenFileAction,
    scmViewAsListAction,
    scmViewAsTreeAction,
    showScmAction,
} from "./changesActions.ts";
import { ChangesComponentDIToken, SCM_VIEWLET_ID } from "./changesComponent.ts";
import { ScmInputComponentDIToken } from "./scmInputComponent.ts";

// scm.action.openChanges покрыт сквозными тестами workbench.changes.test.ts
// (активация строки, untracked-фолбэк); здесь — пути резолва цели и view-mode.

function accessorWith(services: Map<unknown, unknown>): ServiceAccessor {
    return {
        get(token: unknown) {
            if (services.has(token)) return services.get(token);
            throw new Error("unexpected token");
        },
    } as unknown as ServiceAccessor;
}

describe("showScmAction", () => {
    it("reveals the SCM viewlet in the sidebar", () => {
        const sidebar = { showViewlet: vi.fn() };
        showScmAction.run(accessorWith(new Map([[SidebarServiceDIToken, sidebar]])));
        expect(sidebar.showViewlet).toHaveBeenCalledWith(SCM_VIEWLET_ID);
    });
});

describe("workbench.scm.focus / scm.action.focusChanges", () => {
    it("workbench.scm.focus показывает вьюлет без reveal-фокуса и фокусит input", () => {
        const sidebar = { showViewlet: vi.fn() };
        const input = { focus: vi.fn() };
        scmFocusInputAction.run(
            accessorWith(
                new Map<unknown, unknown>([
                    [SidebarServiceDIToken, sidebar],
                    [ScmInputComponentDIToken, input],
                ]),
            ),
        );
        expect(sidebar.showViewlet).toHaveBeenCalledWith(SCM_VIEWLET_ID, false);
        expect(input.focus).toHaveBeenCalledTimes(1);
    });

    it("scm.action.focusChanges висит на Down при scmInputFocus и фокусит список", () => {
        expect(scmFocusChangesAction.when).toBe("scmInputFocus");
        const component = { focus: vi.fn() };
        scmFocusChangesAction.run(accessorWith(new Map<unknown, unknown>([[ChangesComponentDIToken, component]])));
        expect(component.focus).toHaveBeenCalledTimes(1);
    });
});

describe("scm.action.openFile", () => {
    it("resolves the single target from the ScmContext open-context and hides itself on multi-select", () => {
        const single = { kind: "resource", uris: ["file:///repo/a.txt"], groups: ["worktree"] };
        expect(scmOpenFileAction.menus?.[0].args?.(single)).toEqual(["file:///repo/a.txt"]);
        expect(scmOpenFileAction.menus?.[0].visible?.(single)).toBe(true);

        const multi = { kind: "resource", uris: ["file:///a", "file:///b"], groups: ["worktree"] };
        expect(scmOpenFileAction.menus?.[0].visible?.(multi)).toBe(false);
        const folder = { kind: "folder", uris: ["file:///a"], groups: ["worktree"] };
        expect(scmOpenChangesAction.menus?.[0].visible?.(folder)).toBe(false);
    });

    it("opens the explicit uri argument", () => {
        const editors = { openUri: vi.fn() };
        const accessor = accessorWith(new Map<unknown, unknown>([[EditorServiceDIToken, editors]]));

        scmOpenFileAction.run(accessor, Uri.file("/repo/a.txt").toString());

        expect(editors.openUri).toHaveBeenCalledTimes(1);
        expect((editors.openUri.mock.calls[0][0] as Uri).fsPath).toBe("/repo/a.txt");
    });

    it("falls back to the cursor row of the changes list when no argument is given", () => {
        const editors = { openUri: vi.fn() };
        const component = { getCursorChange: () => ({ uri: Uri.file("/repo/b.txt") }) };
        const accessor = accessorWith(
            new Map<unknown, unknown>([
                [EditorServiceDIToken, editors],
                [ChangesComponentDIToken, component],
            ]),
        );

        scmOpenFileAction.run(accessor);

        expect((editors.openUri.mock.calls[0][0] as Uri).fsPath).toBe("/repo/b.txt");
    });

    it("is a no-op when there is no argument and no file row under the cursor", () => {
        const editors = { openUri: vi.fn() };
        const component = { getCursorChange: () => null };
        const accessor = accessorWith(
            new Map<unknown, unknown>([
                [EditorServiceDIToken, editors],
                [ChangesComponentDIToken, component],
            ]),
        );

        scmOpenFileAction.run(accessor);

        expect(editors.openUri).not.toHaveBeenCalled();
    });
});

describe("scm.action.openChanges", () => {
    it("is a no-op without argument and without a file row under the cursor", () => {
        const component = { getCursorChange: () => null };
        const accessor = accessorWith(new Map<unknown, unknown>([[ChangesComponentDIToken, component]]));

        expect(() => scmOpenChangesAction.run(accessor)).not.toThrow();
    });
});

describe("scm view-mode actions", () => {
    it("are available only while the SCM viewlet is visible", () => {
        expect(scmViewAsTreeAction.when).toBe("scmViewletVisible");
        expect(scmViewAsListAction.when).toBe("scmViewletVisible");
    });

    it("switch the view mode on ChangesComponent", () => {
        const component = { setViewMode: vi.fn() };
        const accessor = accessorWith(new Map<unknown, unknown>([[ChangesComponentDIToken, component]]));

        scmViewAsTreeAction.run(accessor);
        expect(component.setViewMode).toHaveBeenCalledWith("tree");

        scmViewAsListAction.run(accessor);
        expect(component.setViewMode).toHaveBeenCalledWith("flat");
    });
});
