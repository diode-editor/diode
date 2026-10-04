import { Uri } from "../../../base/common/uri.ts";
import type { IGutterChangeDecoration } from "../../../editor/common/model/iGutterChangeDecoration.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import type { IEditorDecorationsService } from "../common/iEditorDecorationsService.ts";

/**
 * Реализация {@link IEditorDecorationsService} поверх {@link EditorService}.
 * Живёт в слое Extensions (Workbench ничего не знает про host).
 *
 * Находит открытые редакторы по совпадению ресурса (образец —
 * `DiagnosticsService.editorsForResource`) и проталкивает набор в каждый.
 */
export class EditorDecorationsServiceAdapter implements IEditorDecorationsService {
    private readonly group: EditorService;

    public constructor(group: EditorService) {
        this.group = group;
    }

    public setGutterChangeDecorations(uri: string, decorations: readonly IGutterChangeDecoration[]): void {
        // Все группы: тот же файл в соседнем сплите — тоже его вкладка.
        for (const editor of this.group.getEditors()) {
            if (editor.uri.toString() === uri) {
                editor.setGutterChangeDecorations(decorations);
            }
        }
    }
}
