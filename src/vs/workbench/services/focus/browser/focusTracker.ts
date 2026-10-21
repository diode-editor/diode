import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const FocusTrackerDIToken = token<FocusTracker>("FocusTracker");

/**
 * A standalone service with no dependencies rather than a workbench event: the workbench resolves
 * features on creation, so a feature subscribing to it would close a DI cycle.
 * `WorkbenchContextKeys.handleFocusChange` calls {@link fire} after updating context keys, so
 * subscribers see the fresh context.
 */
export class FocusTracker implements IDisposable {
    public static dependencies = [] as const;

    private readonly onDidChangeFocusEmitter = new Emitter<TUIElement | null>();

    public readonly onDidChangeFocus = this.onDidChangeFocusEmitter.event;

    public fire(active: TUIElement | null): void {
        this.onDidChangeFocusEmitter.fire(active);
    }

    public dispose(): void {
        this.onDidChangeFocusEmitter.dispose();
    }
}
