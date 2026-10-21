import { Disposable } from "../../../base/common/lifecycle.ts";
import type { IWorkbenchContribution } from "../../common/iWorkbenchContribution.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";

import type { PaneCompositePartComponent } from "./paneCompositePartComponent.ts";
import type { PaneCompositePartService } from "./paneCompositePartService.ts";

/**
 * Скрытая часть оставляет `activeElement` на hidden-виджете, и тот продолжает
 * получать клавиатуру — ввод уходил в невидимый шелл. Как VS Code
 * (`focusPanelOrEditor`), отдаём фокус редактору, а без редакторов — снимаем.
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
        this.register(
            partService.onDidChangeActiveView(() => {
                this.releaseFocusFromPart();
            }),
        );
    }

    private releaseFocusFromPart(): void {
        const focusManager = this.partComponent.view.getRoot()?.focusManager ?? null;
        if (focusManager === null) return;
        const active = focusManager.activeElement;
        if (active === null) return;
        if (!active.getAncestorPath().includes(this.partComponent.view)) return;
        this.editorService.focusEditor();
        // Клавиатура уйдёт диспатчеру команд на body.
        if (focusManager.activeElement === active) focusManager.setFocus(null);
    }
}
