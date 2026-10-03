import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { getCodeActions } from "../../../../editor/contrib/codeAction/codeAction.ts";
import { formatDocument } from "../../../../editor/contrib/format/format.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { applyFormattingEdits } from "../../../browser/parts/editor/applyFormattingEdits.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";

// ─── Save-участники поверх настроек (#196, хвост) ───────────
//
// `editor.codeActionsOnSave` и `editor.formatOnSave`: при сохранении сначала
// прогоняются source-действия провайдеров (fix all, organize imports), затем
// формат — правки ложатся в буфер ДО записи, на диск уходит уже поправленный
// текст. Оба участника читают настройку в момент сохранения (live) и при
// выключенной (дефолт) не делают ничего. Составляет пайплайн и втыкает его в
// модели `EditorService` (см. `collectSaveParticipants`).

/**
 * Зависимости участников. Провайдеры берутся из реестров по документу снапшота
 * в момент сохранения, панель ищется по его ресурсу — сохраняться может и
 * неактивная вкладка (Save при переключении, будущий Save All).
 */
export interface IOnSaveParticipantHost {
    readonly configuration: IConfigurationService;
    readonly languageFeatures: ILanguageFeaturesService;
    paneForUri(uri: string): TextEditorPane | null;
}

/**
 * Виды code actions, включённые на сохранение. Форма VS Code: объект
 * «kind → значение», где `true | "explicit" | "always"` включают вид, а
 * `false | "never"` выключают (все сохранения diode ручные, так что
 * `"explicit"` ≡ `true`); массив — все перечисленные виды включены. Порядок
 * прогона — порядок ключей в настройке. `languageId` — язык документа: значение
 * читается с его секцией `"[lang]"`.
 */
export function enabledCodeActionKindsOnSave(configuration: IConfigurationService, languageId?: string): string[] {
    const raw: unknown = configuration.get("editor.codeActionsOnSave", { overrideIdentifier: languageId });
    if (Array.isArray(raw)) {
        return raw.filter((kind): kind is string => typeof kind === "string");
    }
    if (typeof raw !== "object" || raw === null) return [];
    return Object.entries(raw)
        .filter(([, value]) => value === true || value === "explicit" || value === "always")
        .map(([kind]) => kind);
}

/**
 * Участник `editor.codeActionsOnSave`: для каждого включённого вида запрашивает
 * source-действия по ВСЕМУ документу (`only` матчится в субпроцессе
 * иерархически: `source.fixAll` берёт и `source.fixAll.ruff`) и применяет все
 * вернувшиеся по порядку. Правки применяет субпроцесс через `workspace.applyEdit`
 * прямо во время await — участнику нечего возвращать модели, а следующий вид
 * читает уже СВЕЖИЙ текст из панели (снапшот к тому моменту устарел).
 */
export function createCodeActionsOnSaveParticipant(host: IOnSaveParticipantHost): SaveParticipant {
    return async (snapshot) => {
        const target = { uri: Uri.parse(snapshot.uri), languageId: snapshot.languageId };
        // Провайдеров для документа нет — и настройку читать незачем.
        if (!host.languageFeatures.codeActionProvider.has(target)) return [];
        for (const kind of enabledCodeActionKindsOnSave(host.configuration, snapshot.languageId)) {
            const text = host.paneForUri(snapshot.uri)?.getText() ?? snapshot.text;
            const lines = text.split("\n");
            const items = await getCodeActions(host.languageFeatures.codeActionProvider, target, {
                uri: snapshot.uri,
                languageId: snapshot.languageId,
                text,
                // Source-действия применяются к целому файлу — диапазон всегда
                // полный, как у команд organizeImports/fixAll.
                range: createRange(0, 0, lines.length - 1, lines[lines.length - 1].length),
                only: kind,
            });
            for (const { action, provider } of items) {
                await provider.applyCodeAction(action.id);
            }
        }
        return [];
    };
}

/**
 * Участник `editor.formatOnSave`: запрашивает формат ВСЕГО документа по свежему
 * тексту (code actions до него могли править буфер) и применяет правки через
 * панель — общий с командой Format Document хвост схлопывает каретку на прежнее
 * место. Устаревший ответ (текст изменился за время RPC) отбрасывается — как у
 * команды. Нет провайдера/панели — молчаливый no-op: сохранение не место для
 * нотисов «нет форматтера».
 */
export function createFormatOnSaveParticipant(host: IOnSaveParticipantHost): SaveParticipant {
    return async (snapshot) => {
        if (!host.configuration.get("editor.formatOnSave", { overrideIdentifier: snapshot.languageId })) return [];
        const pane = host.paneForUri(snapshot.uri);
        if (pane === null) return [];
        const text = pane.getText();
        const target = { uri: Uri.parse(snapshot.uri), languageId: snapshot.languageId };
        const edits = await formatDocument(host.languageFeatures, target, {
            uri: snapshot.uri,
            languageId: snapshot.languageId,
            text,
            tabSize: pane.viewState.tabSize,
            insertSpaces: pane.viewState.insertSpaces,
        });
        if (edits === null || edits.length === 0) return [];
        if (pane.getText() !== text) return [];
        applyFormattingEdits(pane, edits, "Format on Save");
        return [];
    };
}
