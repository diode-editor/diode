import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";

import type { ISaveEdit, ISaveSnapshot, SaveParticipant } from "./iSaveParticipant.ts";
import type { TextFileModel } from "./textFileModel.ts";

/**
 * Потолок ожидания ОДНОГО save-участника, мс. Тот же порядок, что таймауты
 * языковых RPC (5000 — холодный language server): участники живут за RPC к
 * subprocess extension host'у, и молчащий участник не должен вешать сохранение.
 */
const SAVE_PARTICIPANT_TIMEOUT_MS = 5000;

/**
 * Ограничивает ответ участника таймаутом: по истечении резолвится пустым
 * набором правок (сохраняем как есть), не дожидаясь зависшего промиса.
 */
function raceSaveParticipantTimeout(run: Promise<readonly ISaveEdit[]>): Promise<readonly ISaveEdit[]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            // Stryker disable next-line ArrayDeclaration: пустой набор — контракт таймаута; посторонний элемент без валидного kind всё равно молча отфильтруется гейтами applySaveEdits
            resolve([]);
        }, SAVE_PARTICIPANT_TIMEOUT_MS);
        run.then(
            (edits) => {
                clearTimeout(timer);
                resolve(edits);
            },
            (err: unknown) => {
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}

/**
 * Пайплайн save-участников (аналог upstream `TextFileSaveParticipant`): один
 * экземпляр на все модели, его держит владелец моделей (`EditorService`), а
 * модель зовёт перед записью на диск — и в `save`, и в `saveAs`.
 *
 * Состав пайплайна (`onWillSaveTextDocument`, code actions / формат on-save)
 * берётся у провайдера В МОМЕНТ сохранения: он зависит от живых настроек.
 * Участники исполняются последовательно: каждый получает СВЕЖИЙ снапшот
 * (предыдущий мог править буфер — code actions применяются субпроцессом через
 * `workspace.applyEdit` прямо во время await), его правки ложатся в буфер
 * (undoable) до вызова следующего.
 */
export class TextFileSaveParticipant {
    /**
     * @param participants — состав пайплайна для модели: часть участников зависит
     * от того, есть ли у её документа провайдер (code actions, форматтер).
     */
    public constructor(private readonly participants: (model: TextFileModel) => readonly SaveParticipant[]) {}

    /**
     * Прогоняет участников по модели. `null` — участников нет: вызывающий
     * пишет на диск в том же тике, без единого await (`save()` без await
     * остаётся синхронным).
     *
     * Участник ограничен {@link SAVE_PARTICIPANT_TIMEOUT_MS}: провайдеры живут
     * в subprocess extension host, и зависший участник не должен блокировать
     * запись — по таймауту сохраняем как есть (как VS Code). Правки, доехавшие
     * после, лягут в буфер обычным путём и просто оставят его «грязным».
     * Сбойный (бросивший) участник пропускается по той же причине.
     */
    public participate(model: TextFileModel): Promise<void> | null {
        const participants = this.participants(model);
        return participants.length > 0 ? this.run(model, participants) : null;
    }

    private async run(model: TextFileModel, participants: readonly SaveParticipant[]): Promise<void> {
        for (const participant of participants) {
            const snapshot: ISaveSnapshot = {
                uri: model.uri.toString(),
                languageId: model.document.languageId,
                versionId: model.document.versionId,
                isDirty: model.isModified,
                text: model.document.getText(),
                eol: model.document.eol,
                encoding: model.encoding,
            };
            try {
                const edits = await raceSaveParticipantTimeout(participant(snapshot));
                applySaveEdits(model, edits);
            } catch {
                // Сбойный участник не блокирует запись; следующий идёт своим чередом.
            }
        }
    }
}

/**
 * Применяет правки save-участника. Текстовые правки клампятся к текущим
 * границам документа (во время await пользователь мог печатать) и уходят одним
 * undoable-батчем; смена EOL — отдельным undoable-элементом (setEol).
 */
function applySaveEdits(model: TextFileModel, edits: readonly ISaveEdit[]): void {
    const textEdits: ITextEdit[] = [];
    for (const edit of edits) {
        if (edit.kind === "text") {
            textEdits.push(createTextEdit(clampRange(model, edit.range), edit.text));
        }
    }
    // Пустой батч не меняет ни текст, ни историю (`applyEdits` от него
    // отказывается) — гард лишь бережёт лишнюю перерисовку, мутант ненаблюдаем.
    // Stryker disable next-line ConditionalExpression,EqualityOperator: эквивалентен — см. выше
    if (textEdits.length > 0) {
        model.applyExternalEdits(textEdits, "editorconfig: pre-save");
    }
    for (const edit of edits) {
        if (edit.kind === "eol") model.setEol(edit.eol);
    }
}

/** Ограничивает диапазон текущими границами документа (строки и колонки). */
function clampRange(model: TextFileModel, range: IRange): IRange {
    const start = clampPosition(model, range.start.line, range.start.character);
    const end = clampPosition(model, range.end.line, range.end.character);
    return createRange(start.line, start.character, end.line, end.character);
}

function clampPosition(model: TextFileModel, line: number, character: number): { line: number; character: number } {
    const clampedLine = Math.min(Math.max(line, 0), model.document.lineCount - 1);
    const clampedChar = Math.min(Math.max(character, 0), model.document.getLineLength(clampedLine));
    return { line: clampedLine, character: clampedChar };
}
