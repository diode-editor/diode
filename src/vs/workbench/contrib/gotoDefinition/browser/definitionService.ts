import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

export const DefinitionServiceDIToken = token<DefinitionService>("DefinitionService");

/**
 * Логика Go to Definition. По команде (`editor.action.revealDefinition` / F12)
 * запрашивает цели у `EditorService.definitionSource` (провайдеры расширений
 * через host) для позиции каретки и раскрывает первую: в том же файле — прыжок
 * каретки, в другом — открытие ресурса и прыжок (паттерн
 * `ProblemsComponent.revealMarker`).
 */
export class DefinitionService {
    public static dependencies = [EditorServiceDIToken] as const;

    public constructor(private readonly group: EditorService) {}

    /**
     * Раскрывает определение символа под кареткой активного редактора. No-op,
     * если нет активного редактора, источника или провайдеры ничего не вернули.
     */
    public async revealDefinition(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const source = this.group.definitionSource;
        if (source === undefined) return;

        const caret = editor.viewState.selections[0].active;
        const locations = await source({
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text: editor.getText(),
            line: caret.line,
            character: caret.character,
        });
        const target = locations[0];
        if (target === undefined) return;
        this.revealLocation(target);
    }

    /** Довозит каретку до цели: кросс-файлово — через открытие ресурса группой. */
    private revealLocation(location: ICoreDefinitionLocation): void {
        if (this.group.getActiveEditor()?.uri.toString() !== location.uri) {
            this.group.openUri(Uri.parse(location.uri));
        }
        const editor = this.group.getActiveEditor();
        /* v8 ignore start -- defensive: openUri always opens/activates an editor for the resource */
        if (editor === null || editor.uri.toString() !== location.uri) return;
        /* v8 ignore stop */
        editor.goToPosition(location.range.start.line, location.range.start.character);
        editor.revealRange(location.range);
    }
}
