import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../vs/editor/common/languages/tokenizationRegistry.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../vs/platform/undoRedo/common/undoRedoService.ts";
import { EditorComponent } from "../vs/workbench/browser/parts/editor/editorComponent.ts";
import { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";
import { TextFileModel } from "../vs/workbench/services/textfile/common/textFileModel.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../vs/workbench/services/themes/common/themeService.ts";

export type { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";

export interface IEditorPaneOverrides {
    readonly registry?: TokenizationRegistry;
    readonly languageService?: ILanguageService;
    readonly themeService?: ThemeService;
    readonly undoRedoService?: UndoRedoService;
}

/**
 * Обвязка юнит-тестов пары `TextFileModel` + `EditorComponent`: собирает пару так
 * же, как `EditorService.createAndWireEditor`, и отдаёт
 * {@link TextEditorPane} — сценарии работают с единой поверхностью пары.
 */
export function createEditorPane(overrides: IEditorPaneOverrides = {}): TextEditorPane {
    const themeService = overrides.themeService ?? new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const model = new TextFileModel(
        overrides.languageService ?? NULL_LANGUAGE_SERVICE,
        overrides.undoRedoService ?? new UndoRedoService(),
    );
    const component = new EditorComponent(
        overrides.registry ?? new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        model,
    );
    return new TextEditorPane(model, component);
}
