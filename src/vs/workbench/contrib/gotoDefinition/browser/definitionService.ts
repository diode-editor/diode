import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    EditorStateCancellationTokenSource,
    EditorStateFlag,
} from "../../../browser/parts/editor/editorStateCancellation.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";

import { getDefinitions } from "./goToSymbol.ts";

export const DefinitionServiceDIToken = token<DefinitionService>("DefinitionService");

export class DefinitionService {
    public static dependencies = [EditorServiceDIToken, JumpRecorderDIToken, LanguageFeaturesServiceDIToken] as const;

    /** Повторный F12 перебивает прежний запрос: прыгает только последний. */
    private readonly latest = new LatestRequest();

    public constructor(
        private readonly group: IEditorService,
        private readonly jumps: IJumpRecorder,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {}

    /**
     * Ответ после правки или ухода каретки не применяется (upstream `EditorStateCancellationTokenSource`):
     * медленный провайдер (jdtls на холодном старте) иначе уносит человека в другой файл задним числом.
     */
    public async revealDefinition({ toSide = false }: { toSide?: boolean } = {}): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        const state = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Value | EditorStateFlag.Position);
        const ticket = this.latest.start(state.token);
        const caret = editor.viewState.selections[0].active;
        let locations: readonly ICoreDefinitionLocation[];
        // Уборка подписок отработавшего запроса ненаблюдаема: забытая подписка лишь
        // отменила бы уже никому не нужный токен.
        // Stryker disable BlockStatement: см. выше — мутант пустого finally
        try {
            locations = await getDefinitions(
                this.languageFeatures.definitionProvider,
                editor,
                {
                    uri: editor.uri.toString(),
                    languageId: editor.languageId,
                    versionId: editor.model.document.versionId,
                    line: caret.line,
                    character: caret.character,
                },
                ticket.token,
            );
        } finally {
            // Stryker disable next-line CallExpression: см. выше
            state.dispose();
        }
        // Stryker restore BlockStatement
        if (ticket.isStale()) return;
        const target = locations.at(0);
        if (target === undefined) return;
        await this.revealLocation(target, toSide);
    }

    /**
     * `jumpAsync`, а не `jump`: недисковая цель (`jdt:`) открывается через провайдера схемы, и точку
     * назначения можно снять только после этого — без промежуточного «открыли файл в начале».
     */
    private revealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        return this.jumps.jumpAsync(() => this.doRevealLocation(location, toSide));
    }

    private async doRevealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        // Не сравнивать со строкой `location.uri`: `Uri` нормализует процентное кодирование, и у
        // `jdt:`-целей с огромным query строки НИКОГДА не совпадут.
        const uri = Uri.parse(location.uri);
        const key = uri.toString();
        // Открываем безусловно, даже в том же файле: дедуп по ресурсу живёт в `openUri`.
        await this.group.openUri(uri, toSide ? { group: "beside" } : {});
        const editor = this.group.getActiveEditor();
        // Ресурс мог не открыться: недисковую цель отдаёт провайдер схемы, а его
        // может не быть (человек уже увидел сообщение — см. `onDidFailOpen`).
        // Stryker disable next-line OptionalChaining: без активного редактора сюда не попасть — `revealDefinition` выходит раньше, чем спросит провайдеров; `?.` держим страховкой для будущих вызывающих
        if (editor?.uri.toString() !== key) return;
        editor.goToPosition(location.range.start.line, location.range.start.character);
        editor.revealRange(location.range);
    }
}
