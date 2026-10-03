import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const FocusTrackerDIToken = token<FocusTracker>("FocusTracker");

export type FocusChangeListener = (active: TUIElement | null) => void;

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

    private readonly listeners = new Set<FocusChangeListener>();

    public onDidChangeFocus(listener: FocusChangeListener): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** Фокус сменился; `active` — новый сфокусированный элемент (или `null`). */
    public fire(active: TUIElement | null): void {
        for (const listener of [...this.listeners]) listener(active);
    }

    public dispose(): void {
        this.listeners.clear();
    }
}
