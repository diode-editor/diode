import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { getCodeActions } from "../../../../editor/contrib/codeAction/codeAction.ts";
import { formatDocument } from "../../../../editor/contrib/format/format.ts";
import { documentRange } from "../../../../editor/contrib/smartSelect/lineText.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { applyFormattingEdits } from "../../../browser/parts/editor/applyFormattingEdits.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";

// Сначала source-действия (`editor.codeActionsOnSave`), затем формат: правки ложатся в буфер ДО записи.
// Настройка читается в момент сохранения.

/** Панель ищется по ресурсу снапшота: сохраняться может и неактивная вкладка. */
export interface IOnSaveParticipantHost {
    readonly configuration: IConfigurationService;
    readonly languageFeatures: ILanguageFeaturesService;
    paneForUri(uri: string): TextEditorPane | null;
}

/**
 * Форма VS Code: `true | "explicit" | "always"` включают вид (все сохранения diode ручные, так что
 * `"explicit"` ≡ `true`); массив — все виды включены. Порядок прогона — порядок ключей.
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
 * `only` матчится в субпроцессе иерархически (`source.fixAll` берёт и `source.fixAll.ruff`). Правки
 * применяет субпроцесс через `workspace.applyEdit` во время await, так что следующий вид читает
 * СВЕЖИЙ текст из панели — снапшот к тому моменту устарел.
 */
export function createCodeActionsOnSaveParticipant(host: IOnSaveParticipantHost): SaveParticipant {
    return async (snapshot) => {
        const target = { uri: Uri.parse(snapshot.uri), languageId: snapshot.languageId };
        if (!host.languageFeatures.codeActionProvider.has(target)) return [];
        for (const kind of enabledCodeActionKindsOnSave(host.configuration, snapshot.languageId)) {
            // Свежие границы и версия — из панели: действия прошлого вида могли уже править буфер.
            const pane = host.paneForUri(snapshot.uri);
            const items = await getCodeActions(
                host.languageFeatures.codeActionProvider,
                target,
                {
                    uri: snapshot.uri,
                    languageId: snapshot.languageId,
                    versionId: pane?.model.document.versionId ?? snapshot.versionId,
                    range: pane !== null ? documentRange(pane.model.document) : textRange(snapshot.text),
                    only: kind,
                },
                // Конвейер сохранения отмены не знает: участник дожидается ответа.
                CancellationTokenNone,
            );
            for (const { action, provider } of items) {
                // Неактивные не применяются (эталон берёт `validActions`).
                if (action.disabled !== undefined) continue;
                await provider.applyCodeAction(action.id, { onSave: true });
            }
        }
        return [];
    };
}

/**
 * Формат по свежему тексту (code actions до него могли править буфер); устаревший ответ отбрасывается.
 * Нет провайдера/панели — молчаливый no-op: сохранение не место для нотисов «нет форматтера».
 */
export function createFormatOnSaveParticipant(host: IOnSaveParticipantHost): SaveParticipant {
    return async (snapshot) => {
        if (!host.configuration.get("editor.formatOnSave", { overrideIdentifier: snapshot.languageId })) return [];
        const pane = host.paneForUri(snapshot.uri);
        if (pane === null) return [];
        const versionId = pane.model.document.versionId;
        const target = { uri: Uri.parse(snapshot.uri), languageId: snapshot.languageId };
        const edits = await formatDocument(
            host.languageFeatures,
            target,
            {
                uri: snapshot.uri,
                languageId: snapshot.languageId,
                versionId,
                tabSize: pane.viewState.tabSize,
                insertSpaces: pane.viewState.insertSpaces,
            },
            documentRange(pane.model.document),
            // Устаревший ответ отбрасывает сверка версии ниже; своей отмены у конвейера нет.
            CancellationTokenNone,
        );
        if (edits === null || edits.length === 0) return [];
        if (pane.model.document.versionId !== versionId) return [];
        applyFormattingEdits(pane, edits, "Format on Save");
        return [];
    };
}

/** Сохранение без вкладки. */
function textRange(text: string): IRange {
    const lines = text.split("\n");
    return createRange(0, 0, lines.length - 1, lines[lines.length - 1].length);
}
