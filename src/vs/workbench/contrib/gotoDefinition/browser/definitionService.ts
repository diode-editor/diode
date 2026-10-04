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

/**
 * Логика Go to Definition. По команде (`editor.action.revealDefinition` / F12)
 * запрашивает цели у подошедших документу провайдеров реестра
 * `ILanguageFeaturesService.definitionProvider` для позиции каретки и раскрывает
 * первую: в том же файле — прыжок
 * каретки, в другом — открытие ресурса и прыжок (паттерн
 * `ProblemsComponent.revealMarker`).
 */
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
     * Раскрывает определение символа под кареткой активного редактора. No-op,
     * если нет активного редактора или провайдеры ничего не вернули.
     *
     * Ответ, пришедший после правки документа или ухода каретки, не применяется
     * (upstream `goToCommands.ts` — `EditorStateCancellationTokenSource(Value |
     * Position)`): медленный провайдер (jdtls на холодном старте) иначе уносит
     * человека в другой файл задним числом.
     */
    public async revealDefinition({ toSide = false }: { toSide?: boolean } = {}): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        const state = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Value | EditorStateFlag.Position);
        const ticket = this.latest.start(state.token);
        const caret = editor.viewState.selections[0].active;
        let locations: readonly ICoreDefinitionLocation[];
        // Сам переход двигает каретку — следить за состоянием после ответа
        // незачем. Снятие подписок заодно отцепляет и билет (он слушает токен
        // состояния). Уборка подписок отработавшего запроса ненаблюдаема: забытая
        // подписка лишь отменила бы уже никому не нужный токен.
        // Stryker disable BlockStatement: см. выше — мутант пустого finally
        try {
            locations = await getDefinitions(this.languageFeatures.definitionProvider, editor, {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                text: editor.getText(),
                line: caret.line,
                character: caret.character,
            });
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
     * Довозит каретку до цели: кросс-файлово — через открытие ресурса группой.
     * Весь переход обёрнут в {@link IJumpRecorder.jumpAsync}: история кладёт
     * точку вызова и точку определения, а промежуточное «открыли файл в начале» —
     * нет. Именно `jumpAsync`, а не `jump`: цель может оказаться недисковым
     * ресурсом (`jdt:` у Java, исходник из JDK), который открывается через
     * провайдера схемы, и снять точку назначения можно только после этого.
     */
    private revealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        return this.jumps.jumpAsync(() => this.doRevealLocation(location, toSide));
    }

    private async doRevealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        // Сравнивать с `location.uri` как со строкой нельзя: провайдер присылает
        // её в своём написании, а `Uri` нормализует процентное кодирование —
        // у `jdt:`-целей с их огромным query эти две строки НИКОГДА не совпадут.
        // Поднимаем ресурс один раз и дальше сравниваем нормализованное с
        // нормализованным.
        const uri = Uri.parse(location.uri);
        const key = uri.toString();
        // Открываем безусловно — даже если цель в том же файле: дедуп по ресурсу
        // живёт в `openUri` и работает в пределах группы, а второй такой же
        // проверки здесь ему не нужно. `group: "beside"` (Ctrl+K F12) оставляет
        // исходную группу на месте и раскрывает цель в соседней справа.
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
