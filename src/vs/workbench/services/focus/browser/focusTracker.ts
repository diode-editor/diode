import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const FocusTrackerDIToken = token<FocusTracker>("FocusTracker");

/**
 * Смена фокуса в дереве workbench как событие. Фичи подписываются сами (попапы
 * редактора гаснут, когда фокус ушёл с редактора), вместо того чтобы центр
 * знал каждую из них поимённо. Источник — `WorkbenchContextKeys.handleFocusChange`
 * (capture-листенеры focus/blur корневой view): он сначала освежает контекст-ключи,
 * потом зовёт {@link fire}, так что подписчик видит уже свежий контекст.
 *
 * Отдельный сервис без зависимостей, а не событие на самом центре: центр
 * резолвит фичи-контрибьюторы при своём создании, и подписка фичи на центр
 * замкнула бы граф DI в цикл.
 */
export class FocusTracker implements IDisposable {
    public static dependencies = [] as const;

    private readonly onDidChangeFocusEmitter = new Emitter<TUIElement | null>();

    public readonly onDidChangeFocus = this.onDidChangeFocusEmitter.event;

    /** Фокус сменился; `active` — новый сфокусированный элемент (или `null`). */
    public fire(active: TUIElement | null): void {
        this.onDidChangeFocusEmitter.fire(active);
    }

    public dispose(): void {
        this.onDidChangeFocusEmitter.dispose();
    }
}
