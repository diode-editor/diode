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

/** Фокусируемая заглушка контента вкладки. */
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

/** Часть с одной вкладкой; `rooted` — под корнем с менеджером фокуса или без него. */
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

describe("AuxiliaryBarComponent — ключи контекста", () => {
    it("без фокуса вовсе auxiliaryBarFocus ложен", () => {
        const { component } = scene("none");
        const contextKeys = new ContextKeyService();
        component.updateContextKeys(contextKeys, null);
        expect(contextKeys.get("auxiliaryBarFocus")).toBe(false);
    });
});

describe("AuxiliaryBarFocusContribution — края", () => {
    it("часть вне дерева или корень без менеджера фокуса: скрытие — no-op", () => {
        for (const rooted of ["none", "bare"] as const) {
            const { service, focusEditor } = scene(rooted);
            service.setVisible(true);
            service.setVisible(false);
            expect(focusEditor).not.toHaveBeenCalled();
        }
    });

    it("фокуса нет — скрытие его никуда не переносит", () => {
        const { service, focusEditor } = scene("focus");
        service.setVisible(true);
        service.setVisible(false);
        expect(focusEditor).not.toHaveBeenCalled();
    });

    it("показ части фокус её контента не отпускает, скрытие — отпускает", () => {
        const { service, focusEditor, content, focusManager } = scene("focus");
        focusManager!.setFocus(content);
        service.setVisible(true);
        expect(focusEditor).not.toHaveBeenCalled();
        service.setVisible(false);
        expect(focusEditor).toHaveBeenCalledTimes(1);
    });
});
