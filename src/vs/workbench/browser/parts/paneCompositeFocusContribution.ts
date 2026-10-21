import { Disposable } from "../../../base/common/lifecycle.ts";
import type { IWorkbenchContribution } from "../../common/iWorkbenchContribution.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";

import type { PaneCompositePartComponent } from "./paneCompositePartComponent.ts";
import type { PaneCompositePartService } from "./paneCompositePartService.ts";

/**
 * A hidden part leaves `activeElement` on the hidden widget, which keeps receiving
 * keyboard input — typing went into an invisible shell. Like VS Code
 * (`focusPanelOrEditor`), move focus to the editor, or clear it when no editors are open.
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
        // Keys go to the command dispatcher on body.
        if (focusManager.activeElement === active) focusManager.setFocus(null);
    }
}
