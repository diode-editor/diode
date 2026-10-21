import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const FocusTrackerDIToken = token<FocusTracker>("FocusTracker");

/**
 * Отдельный сервис без зависимостей, а не событие центра: центр резолвит фичи при создании,
 * и подписка фичи на него замкнула бы DI в цикл. `WorkbenchContextKeys.handleFocusChange`
 * зовёт {@link fire} после обновления контекст-ключей — подписчик видит свежий контекст.
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
