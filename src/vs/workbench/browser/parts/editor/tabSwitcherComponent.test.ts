import { Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { MruCycleState } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";

import type { IEditorPane } from "./iEditorPane.ts";
import { TabSwitcherComponent } from "./tabSwitcherComponent.ts";

// The full "model event → overlay session → frame" path is covered by
// workbench.tabSwitcher.test.ts; this file covers the component BEFORE attachHost
// (events in headless order must neither throw nor open a session).

function makePane(label: string): IEditorPane {
    return {
        uri: Uri.file(`/${label}`),
        label,
        view: {} as TUIElement,
        isModified: false,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState: (): IDisposable => ({ dispose: () => {} }),
        focusEditor() {},
        dispose() {},
    };
}

function stubEditorService(): {
    service: IEditorService;
    fireCycle: (state: MruCycleState | null) => void;
    fireActiveGroup: () => void;
} {
    let cycleListener: ((state: MruCycleState | null) => void) | null = null;
    let groupListener: (() => void) | null = null;
    const service = {
        onDidChangeMruCycle(cb: (state: MruCycleState | null) => void): IDisposable {
            cycleListener = cb;
            return { dispose: () => {} };
        },
        onDidActiveGroupChange(cb: () => void): IDisposable {
            groupListener = cb;
            return { dispose: () => {} };
        },
        displayName: (pane: IEditorPane) => pane.label,
    } as unknown as IEditorService;
    return {
        service,
        fireCycle: (state) => cycleListener?.(state),
        fireActiveGroup: () => groupListener?.(),
    };
}

describe("TabSwitcherComponent — without an attached host", () => {
    it("cycle events before attachHost do not open a session and do not throw", () => {
        const { service, fireCycle, fireActiveGroup } = stubEditorService();
        const component = new TabSwitcherComponent(service, service as unknown as IEditorGroupsService);

        expect(component.isOpen()).toBe(false);
        expect(component.view.id).toBe("tabSwitcher");

        fireCycle({ panes: [makePane("a.ts"), makePane("b.ts")], pointer: 1 });
        expect(component.isOpen()).toBe(false);
        // The list still reflects the state; the session just has nowhere to open.
        expect(component.view.inspectState()).toMatchObject({ items: ["a.ts", "b.ts"], currentIndex: 1 });

        fireCycle(null);
        fireActiveGroup();
        expect(component.isOpen()).toBe(false);

        component.dispose();
    });
});

describe("TabSwitcherComponent — overlay session", () => {
    function withHost() {
        const { service, fireCycle, fireActiveGroup } = stubEditorService();
        const component = new TabSwitcherComponent(service, service as unknown as IEditorGroupsService);
        const body = new BodyElement();
        const testApp = TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        testApp.render();
        return { component, body, testApp, fireCycle, fireActiveGroup };
    }

    const cycle = (pointer: number) => ({ panes: [makePane("a.ts"), makePane("b.ts")], pointer });

    it("a cycle step opens the session, the end of the cycle closes it", () => {
        const { component, fireCycle } = withHost();

        const keys = new ContextKeyService();
        const visibleKey = (): unknown => {
            component.updateContextKeys(keys);
            return keys.get("tabSwitcherVisible");
        };
        fireCycle(cycle(1));
        expect(component.isOpen()).toBe(true);
        expect(visibleKey()).toBe(true);

        fireCycle(null);
        expect(component.isOpen()).toBe(false);
        expect(visibleKey()).toBe(false);

        component.dispose();
    });

    it("changing the active group dismisses the open list", () => {
        const { component, fireCycle, fireActiveGroup } = withHost();

        fireCycle(cycle(1));
        expect(component.isOpen()).toBe(true);

        fireActiveGroup();

        expect(component.isOpen()).toBe(false);
        component.dispose();
    });

    it("dispose removes the session from the layer — the overlay does not outlive the component", () => {
        const { component, body, fireCycle } = withHost();
        fireCycle(cycle(0));
        expect(body.overlayLayer.getItems().some((item) => item.element === component.view)).toBe(true);

        component.dispose();

        expect(body.overlayLayer.getItems().some((item) => item.element === component.view)).toBe(false);
        expect(component.isOpen()).toBe(false);
    });
});
