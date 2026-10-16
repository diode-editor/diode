import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { LanguageConfigurationServiceDIToken } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { standardTokenTypeAt } from "../../../../editor/common/languages/standardTokenType.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { IsCodeAt } from "../../../../editor/contrib/smartSelect/bracketSelections.ts";
import {
    type ISelectionRangesOptions,
    provideSelectionRanges,
} from "../../../../editor/contrib/smartSelect/smartSelect.ts";
import { SmartSelectController } from "../../../../editor/contrib/smartSelect/smartSelectController.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

export const SmartSelectServiceDIToken = token<SmartSelectService>("SmartSelectService");

/**
 * Expand / Shrink Selection активного редактора (upstream
 * `editor/contrib/smartSelect`). Иерархии выделений дают selection-range-
 * провайдеры реестра (`ILanguageFeaturesService.selectionRangeProvider` —
 * language server'ы расширений) плюс встроенные: слова всегда, скобки языка —
 * когда языковых провайдеров нет. Стек ступеней живёт по контроллеру на
 * редактор и забывается любой посторонней сменой выделения.
 */
export class SmartSelectService {
    public static dependencies = [
        EditorServiceDIToken,
        LanguageFeaturesServiceDIToken,
        LanguageConfigurationServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    private readonly controllers = new WeakMap<EditorViewState, SmartSelectController>();

    public constructor(
        private readonly editors: IEditorService,
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly languageConfiguration: ILanguageConfigurationService,
        private readonly configuration: IConfigurationService,
    ) {}

    /** Шаг вширь (`forward`) или обратно вглубь; без активного редактора — no-op. */
    public run(forward: boolean): Promise<void> {
        const editor = this.editors.getActiveEditor();
        if (editor === null) return Promise.resolve();
        const viewState = editor.viewState;
        let controller = this.controllers.get(viewState);
        if (controller === undefined) {
            controller = new SmartSelectController(viewState);
            this.controllers.set(viewState, controller);
        }
        return controller.run(forward, (positions) => this.compute(editor, viewState, positions));
    }

    private async compute(
        editor: TextEditorPane,
        viewState: EditorViewState,
        positions: readonly IPosition[],
    ): Promise<IRange[][]> {
        const document = viewState.document;
        const { brackets } = await this.languageConfiguration.ensureLoaded(document.languageId);
        return provideSelectionRanges(
            {
                document,
                uri: editor.uri.toString(),
                positions,
                providers: this.languageFeatures.selectionRangeProvider.ordered(editor),
                brackets,
                isCodeAt: codeAt(viewState, positions),
                options: this.options(document.languageId),
            },
            CancellationTokenNone,
        );
    }

    /** `editor.smartSelect.*` с языковой секцией; читается на каждый запрос. */
    private options(languageId: string): ISelectionRangesOptions {
        const read = (key: string): boolean =>
            this.configuration.get(`editor.smartSelect.${key}`, { overrideIdentifier: languageId }) !== false;
        return {
            selectLeadingAndTrailingWhitespace: read("selectLeadingAndTrailingWhitespace"),
            selectSubwords: read("selectSubwords"),
        };
    }
}

/**
 * Скобки в строках и комментариях пару не образуют (эталон судит по токенам
 * TextMate). Строки до самой нижней каретки размечаются, как у рендера; у
 * строк за фронтиром токенизации токенов нет — их скобки считаются кодом.
 */
function codeAt(viewState: EditorViewState, positions: readonly IPosition[]): IsCodeAt {
    const store = viewState.tokenStore;
    if (store === undefined) return () => true;
    store.tokenizeUpTo(Math.max(...positions.map((position) => position.line)));
    return (line, character) =>
        line >= store.invalidLineIndex || standardTokenTypeAt(store.getLineTokens(line), character) === "other";
}
