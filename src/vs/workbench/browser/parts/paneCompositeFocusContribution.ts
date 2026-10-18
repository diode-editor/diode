import { Disposable } from "../../../base/common/lifecycle.ts";
import type { IWorkbenchContribution } from "../../common/iWorkbenchContribution.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";

import type { PaneCompositePartComponent } from "./paneCompositePartComponent.ts";
import type { PaneCompositePartService } from "./paneCompositePartService.ts";

/**
 * Владелец фокуса при уходе содержимого части (нижняя панель, вторичная
 * боковая панель) со сцены: часть прячут или переключают вкладку, а
 * `activeElement` остаётся на виджете, которого на экране нет (он в дереве,
 * но hidden) — и виджет продолжает получать клавиатуру. Так ввод при скрытой
 * панели уходил в невидимый шелл и там выполнялся.
 *
 * Поэтому, как и VS Code (`focusPanelOrEditor` на скрытии части), возвращаем
 * фокус в редактор, если он был внутри поддерева части. Редакторов может не
 * быть вовсе — тогда просто снимаем фокус: главное, чтобы его не держал
 * невидимый виджет.
 */
export class PaneCompositeFocusContribution extends Disposable implements IWorkbenchContribution {
    protected constructor(
        partService: PaneCompositePartService,
        private readonly partComponent: PaneCompositePartComponent,
        private readonly editorService: IEditorService,
    ) {
        super();
        this.register(
            partService.onDidChangeVisibility((visible) => {
                if (!visible) this.releaseFocusFromPart();
            }),
        );
        // Смена вкладки: контент прежней вкладки уходит со сцены ровно так же.
        this.register(
            partService.onDidChangeActiveView(() => {
                this.releaseFocusFromPart();
            }),
        );
    }

    /** Если фокус внутри поддерева части — отдать его редактору (иначе снять). */
    private releaseFocusFromPart(): void {
        const focusManager = this.partComponent.view.getRoot()?.focusManager ?? null;
        const active = focusManager?.activeElement ?? null;
        if (focusManager === null || active === null) return;
        if (!active.getAncestorPath().includes(this.partComponent.view)) return;
        this.editorService.focusEditor();
        // Открытых редакторов нет — фокусу некуда идти, но и на скрытом виджете
        // ему делать нечего: клавиатура уйдёт диспатчеру команд на body.
        if (focusManager.activeElement === active) focusManager.setFocus(null);
    }
}
