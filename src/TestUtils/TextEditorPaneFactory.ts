import type { Uri } from "../vs/base/common/uri.ts";
import type { LanguageFeatureRegistry } from "../vs/editor/common/languageFeatureRegistry.ts";
import type { FoldingRangeProvider } from "../vs/editor/common/languages/iFoldingSource.ts";
import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../vs/editor/common/languages/tokenizationRegistry.ts";
import type { ILargeFileOptions } from "../vs/editor/common/model/largeFileOptions.ts";
import type { DocumentSemanticTokensFeature } from "../vs/editor/contrib/semanticTokens/browser/documentSemanticTokens.ts";
import type { IFileService } from "../vs/platform/files/common/files.ts";
import type { IRandomAccessFileOpener } from "../vs/platform/files/common/iRandomAccessFile.ts";
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
    readonly foldingProviders?: LanguageFeatureRegistry<FoldingRangeProvider>;
    /** Defaults to the real disk. */
    readonly files?: IFileService;
    /** Absent — TextMate only. */
    readonly semanticTokens?: DocumentSemanticTokensFeature;
    /**
     * Loaded into the model BEFORE the component is built, as `EditorService.openUri` does (the registry
     * loads the file first). `pane.openFile` after the build is the reload path (`isFlush`), which the
     * component treats differently: folds are recomputed at once instead of after the delay.
     */
    readonly file?: Uri;
    /** The thresholds of the large-file mode, applied to the model before {@link file} is loaded. */
    readonly largeFileOptions?: ILargeFileOptions;
    /** Absent — a large file is read into memory; with it, a file above the size threshold stays on disk. */
    readonly randomAccessFiles?: IRandomAccessFileOpener;
}

/** Builds the pair the same way as `TextEditorPaneBuilder.build`. */
export function createEditorPane(overrides: IEditorPaneOverrides = {}): TextEditorPane<TextFileModel> {
    const themeService = overrides.themeService ?? new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const model = new TextFileModel(
        overrides.languageService ?? NULL_LANGUAGE_SERVICE,
        overrides.undoRedoService ?? new UndoRedoService(),
        overrides.files ?? diskFileService(),
    );
    if (overrides.largeFileOptions !== undefined) {
        const options = overrides.largeFileOptions;
        model.largeFileOptions = () => options;
    }
    model.randomAccessFiles = overrides.randomAccessFiles ?? null;
    if (overrides.file !== undefined) model.openFile(overrides.file);
    const component = new EditorComponent(
        overrides.registry ?? new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        model,
        undefined,
        overrides.foldingProviders,
        overrides.semanticTokens,
    );
    return new TextEditorPane(model, component);
}
