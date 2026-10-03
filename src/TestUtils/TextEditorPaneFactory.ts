import type { LanguageFeatureRegistry } from "../vs/editor/common/languageFeatureRegistry.ts";
import type { FoldingRangeProvider } from "../vs/editor/common/languages/iFoldingSource.ts";
import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../vs/editor/common/languages/tokenizationRegistry.ts";
import type { IFileService } from "../vs/platform/files/common/files.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../vs/platform/undoRedo/common/undoRedoService.ts";
import { EditorComponent } from "../vs/workbench/browser/parts/editor/editorComponent.ts";
import { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";
import { TextFileModel } from "../vs/workbench/services/textfile/common/textFileModel.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../vs/workbench/services/themes/common/themeService.ts";

import { diskFileService } from "./diskFileService.ts";

export type { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";

export interface IEditorPaneOverrides {
    readonly registry?: TokenizationRegistry;
    readonly languageService?: ILanguageService;
    readonly themeService?: ThemeService;
    readonly undoRedoService?: UndoRedoService;
    /** Реестр folding-провайдеров (как `ILanguageFeaturesService.foldingRangeProvider`). */
    readonly foldingProviders?: LanguageFeatureRegistry<FoldingRangeProvider>;
    /** Файловый сервис записи модели; по умолчанию — настоящий диск. */
    readonly files?: IFileService;
}

/**
 * Обвязка юнит-тестов пары `TextFileModel` + `EditorComponent`: собирает пару так
 * же, как `EditorService.createPaneForModel`, и отдаёт
 * {@link TextEditorPane} — сценарии работают с единой поверхностью пары.
 */
export function createEditorPane(overrides: IEditorPaneOverrides = {}): TextEditorPane<TextFileModel> {
    const themeService = overrides.themeService ?? new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const model = new TextFileModel(
        overrides.languageService ?? NULL_LANGUAGE_SERVICE,
        overrides.undoRedoService ?? new UndoRedoService(),
        overrides.files ?? diskFileService(),
    );
    const component = new EditorComponent(
        overrides.registry ?? new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        model,
        undefined,
        overrides.foldingProviders,
    );
    return new TextEditorPane(model, component);
}
