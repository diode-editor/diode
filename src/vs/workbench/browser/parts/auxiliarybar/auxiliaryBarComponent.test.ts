import { FocusManager } from "@tuidom/core/dom/events/focusManager";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";

import { AuxiliaryBarComponent } from "./auxiliaryBarComponent.ts";
import { AuxiliaryBarFocusContribution } from "./auxiliaryBarFocusContribution.ts";
import { AuxiliaryBarService } from "./auxiliaryBarService.ts";

class FocusableContent extends TUIElement {
    public constructor() {
        super();
        this.focusable = true;
    }
}

interface IScene {
    readonly service: AuxiliaryBarService;
    readonly component: AuxiliaryBarComponent;
    readonly focusEditor: ReturnType<typeof vi.fn>;
    readonly content: FocusableContent;
}

function scene(rooted: "none" | "bare" | "focus"): IScene & { readonly focusManager: FocusManager | null } {
    const service = new AuxiliaryBarService();
    const content = new FocusableContent();
    service.addView({ id: "a", title: "A" });
    service.setViewContent("a", content);
    const component = new AuxiliaryBarComponent(service, new CommandRegistry());
    const focusEditor = vi.fn();
    new AuxiliaryBarFocusContribution(service, component, { focusEditor } as unknown as IEditorService);
    let focusManager: FocusManager | null = null;
    if (rooted !== "none") {
        const root = new BodyElement();
        root.setContent(component.view);
        root.setAsRoot();
        if (rooted === "focus") {
            focusManager = new FocusManager(root);
            root.focusManager = focusManager;
        }
    }
    return { service, component, focusEditor, content, focusManager };
}

describe("AuxiliaryBarComponent — context keys", () => {
    it("with no focus at all auxiliaryBarFocus is false", () => {
        const { component } = scene("none");
        const contextKeys = new ContextKeyService();
        component.updateContextKeys(contextKeys, null);
        expect(contextKeys.get("auxiliaryBarFocus")).toBe(false);
    });
});

describe("AuxiliaryBarFocusContribution — edge cases", () => {
    // setupFiles turns a listener exception into a test failure, so "no-op" here also means "no error".
    it("part outside the tree or root without a focus manager: hiding is a no-op", () => {
        for (const rooted of ["none", "bare"] as const) {
            const { service, focusEditor } = scene(rooted);
            service.setVisible(true);
            service.setVisible(false);
            expect(focusEditor).not.toHaveBeenCalled();
        }
    });

    it("no focus — hiding does not move it anywhere", () => {
        const { service, focusEditor } = scene("focus");
        service.setVisible(true);
        service.setVisible(false);
        expect(focusEditor).not.toHaveBeenCalled();
    });

    it("showing the part keeps focus on its content, hiding releases it", () => {
        const { service, focusEditor, content, focusManager } = scene("focus");
        focusManager!.setFocus(content);
        service.setVisible(true);
        expect(focusEditor).not.toHaveBeenCalled();
        service.setVisible(false);
        expect(focusEditor).toHaveBeenCalledTimes(1);
    });
});
