import { Disposable } from "@tuidom/all/common/disposable";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { EditorService, EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { ExplorerService, ExplorerServiceDIToken } from "./explorerService.ts";

export const AutoRevealContributionDIToken = token<AutoRevealContribution>("AutoRevealContribution");

/**
 * Автоподсветка активного файла в дереве Explorer'а при смене активного
 * редактора (`explorer.autoReveal`). Сам gate по настройке и reveal живут в
 * {@link ExplorerService.autoRevealActiveFile}; contribution лишь связывает
 * смену активного редактора с этим вызовом.
 */
export class AutoRevealContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [EditorServiceDIToken, ExplorerServiceDIToken] as const;

    public constructor(
        private readonly editorService: EditorService,
        private readonly explorerService: ExplorerService,
    ) {
        super();
        this.register(
            this.editorService.onActiveEditorChanged(() => {
                this.explorerService.autoRevealActiveFile(
                    this.editorService.getActiveTabEditor()?.absoluteFilePath ?? null,
                );
            }),
        );
    }
}
