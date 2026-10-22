import { Uri } from "../../../base/common/uri.ts";
import type { IGutterChangeDecoration } from "../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IEditorDecorationsService } from "../common/iEditorDecorationsService.ts";

export class EditorDecorationsServiceAdapter implements IEditorDecorationsService {
    private readonly group: IEditorService;

    public constructor(group: IEditorService) {
        this.group = group;
    }

    public setGutterChangeDecorations(uri: string, decorations: readonly IGutterChangeDecoration[]): void {
        // All groups: the same file in a neighboring split is also its tab.
        for (const editor of this.group.getEditors()) {
            if (editor.uri.toString() === uri) {
                editor.setExtensionGutterChangeDecorations(decorations);
            }
        }
    }
}
