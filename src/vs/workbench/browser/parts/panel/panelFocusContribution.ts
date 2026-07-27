import { Disposable } from "../../../../../../tuidom/common/disposable.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import type { PanelComponent } from "./panelComponent.ts";
import { PanelComponentDIToken } from "./panelComponent.ts";
import type { PanelService } from "./panelService.ts";
import { PanelServiceDIToken } from "./panelService.ts";

export const PanelFocusContributionDIToken = token<PanelFocusContribution>("PanelFocusContribution");

/**
 * Владелец фокуса при уходе содержимого панели со сцены: панель прячут или
 * переключают вкладку, а `activeElement` остаётся на виджете, которого на
 * экране нет (он в дереве, но hidden) — и виджет продолжает получать
 * клавиатуру. Так ввод при скрытой панели уходил в невидимый шелл и там
 * выполнялся.
 *
 * Поэтому, как и VS Code, возвращаем фокус в редактор, если он был внутри
 * поддерева панели. Редакторов может не быть вовсе — тогда просто снимаем фокус:
 * главное, чтобы его не держал невидимый виджет.
 */
export class PanelFocusContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [PanelServiceDIToken, PanelComponentDIToken, EditorServiceDIToken] as const;

    public constructor(
        panelService: PanelService,
        private readonly panelComponent: PanelComponent,
        private readonly editorService: EditorService,
    ) {
        super();
        this.register(
            panelService.onDidChangeVisibility((visible) => {
                if (!visible) this.releaseFocusFromPanel();
            }),
        );
        // Смена вкладки: контент прежней вкладки уходит со сцены ровно так же.
        this.register(
            panelService.onDidChangeActiveView(() => {
                this.releaseFocusFromPanel();
            }),
        );
    }

    /** Если фокус внутри поддерева панели — отдать его редактору (иначе снять). */
    private releaseFocusFromPanel(): void {
        const focusManager = this.panelComponent.view.getRoot()?.focusManager ?? null;
        const active = focusManager?.activeElement ?? null;
        if (focusManager === null || active === null) return;
        if (!active.getAncestorPath().includes(this.panelComponent.view)) return;
        this.editorService.focusEditor();
        // Открытых редакторов нет — фокусу некуда идти, но и на скрытом виджете
        // ему делать нечего: клавиатура уйдёт диспатчеру команд на body.
        if (focusManager.activeElement === active) focusManager.setFocus(null);
    }
}
