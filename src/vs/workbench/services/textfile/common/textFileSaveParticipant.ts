import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";

import type { ISaveEdit, ISaveSnapshot, SaveParticipant } from "./iSaveParticipant.ts";
import type { TextFileModel } from "./textFileModel.ts";

/**
 * На одного участника. Порядок языковых RPC (5000 — холодный language server): молчащий
 * участник за RPC к host'у не должен вешать сохранение.
 */
const SAVE_PARTICIPANT_TIMEOUT_MS = 5000;

/** По истечении — пустой набор правок (сохраняем как есть). */
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
 * Аналог `TextFileSaveParticipant`. Участники последовательны: каждый получает СВЕЖИЙ
 * снапшот — предыдущий мог править буфер (code actions применяются субпроцессом через
 * `workspace.applyEdit` прямо во время await).
 */
export class TextFileSaveParticipant {
    public constructor(private readonly participants: (model: TextFileModel) => readonly SaveParticipant[]) {}

    /**
     * `null` — участников нет: запись в том же тике, без единого await. По таймауту
     * сохраняем как есть (как VS Code); доехавшие позже правки оставят буфер «грязным».
     */
    public participate(model: TextFileModel): Promise<void> | null {
        const participants = this.participants(model);
        return participants.length > 0 ? this.run(model, participants) : null;
    }

    private async run(model: TextFileModel, participants: readonly SaveParticipant[]): Promise<void> {
        const document = model.document;
        for (const participant of participants) {
            const snapshot: ISaveSnapshot = {
                uri: model.uri.toString(),
                languageId: document.languageId,
                versionId: document.versionId,
                isDirty: model.isModified,
                // Полный текст — только если участник его прочёл: почти никто не читает (will-save
                // расширений читает зеркало), а строка всего файла на каждого участника — цена размера.
                get text() {
                    return document.getText();
                },
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
 * Правки клампятся к текущим границам (во время await пользователь мог печатать) и
 * уходят одним undoable-батчем; EOL — отдельным undoable-элементом.
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
