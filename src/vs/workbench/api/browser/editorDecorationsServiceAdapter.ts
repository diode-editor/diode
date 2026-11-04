import type { IExtensionTextDecorationSet } from "../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IGutterChangeDecoration } from "../../../editor/common/model/iGutterChangeDecoration.ts";
import type { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IEditorDecorationsService } from "../common/iEditorDecorationsService.ts";

export class EditorDecorationsServiceAdapter implements IEditorDecorationsService {
    private readonly group: IEditorService;

    public constructor(group: IEditorService) {
        this.group = group;
    }

    public setGutterChangeDecorations(uri: string, decorations: readonly IGutterChangeDecoration[]): void {
        for (const editor of this.editorsOf(uri)) editor.setExtensionGutterChangeDecorations(decorations);
    }

    public setExtensionTextDecorations(uri: string, set: IExtensionTextDecorationSet): void {
        for (const editor of this.editorsOf(uri)) editor.setExtensionTextDecorations(set);
    }

    /** All groups: the same file in a neighboring split is also its tab. */
    private editorsOf(uri: string): TextEditorPane[] {
        return this.group.getEditors().filter((editor) => editor.uri.toString() === uri);
    }
}
