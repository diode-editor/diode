import type { IPosition } from "../../common/core/iPosition.ts";
import { createRange } from "../../common/core/iRange.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import { createTextEdit } from "../../common/core/iTextEdit.ts";
import { getLeadingWhitespace } from "../../common/languages/autoIndent.ts";

/**
 * Построчное комментирование (VS Code `LineCommentCommand`): анализ набора
 * строк и план правок для toggle/add/remove. Чистые функции без `EditorViewState`
 * — сюда входят только содержимое строк и токен комментария, наружу выходят
 * `ITextEdit`-ы и дескрипторы сдвигов для ремапа выделений.
 */

export type LineCommentMode = "toggle" | "add" | "remove";

/**
 * Сдвиг текста внутри одной строки: вставка (`delta > 0`) или удаление
 * (`delta < 0`) `|delta|` символов начиная с `column`. По нему ремапится
 * выделение после применения правок ({@link remapPositionForShifts}).
 */
export interface ILineShift {
    readonly line: number;
    readonly column: number;
    readonly delta: number;
}

export interface ILineCommentPlan {
    readonly edits: readonly ITextEdit[];
    readonly shifts: readonly ILineShift[];
}

interface ILineInfo {
    readonly line: number;
    readonly indentLength: number;
    readonly isBlank: boolean;
    readonly isCommented: boolean;
    /** Длина маркера с хвостовым пробелом, если он есть — столько снимает remove. */
    readonly markerLength: number;
}

function analyzeLine(content: string, token: string, line: number): ILineInfo {
    const indentLength = getLeadingWhitespace(content).length;
    const isBlank = indentLength === content.length;
    const isCommented = !isBlank && content.startsWith(token, indentLength);
    const markerLength = token.length + (isCommented && content[indentLength + token.length] === " " ? 1 : 0);
    return { line, indentLength, isBlank, isCommented, markerLength };
}

/**
 * План правок построчного комментирования для набора строк одного выделения.
 * Семантика VS Code:
 *
 *  - пустые (whitespace-only) строки пропускаются — и при анализе, и при
 *    вставке; но если пустые ВСЕ строки, комментируются все;
 *  - toggle снимает маркеры, только когда закомментирована КАЖДАЯ значимая
 *    строка, иначе добавляет;
 *  - вставка идёт единой колонкой — минимальным отступом значимых строк
 *    (маркеры выравниваются, а не прыгают по отступам);
 *  - маркер вставляется с пробелом (`"// "`), снимается вместе с одним
 *    пробелом после него, если тот есть.
 *
 * `null` — правок нет (remove на строках без маркеров).
 */
export function planLineComments(
    getLineContent: (line: number) => string,
    lines: readonly number[],
    lineComment: string,
    mode: LineCommentMode,
): ILineCommentPlan | null {
    const infos = lines.map((line) => analyzeLine(getLineContent(line), lineComment, line));

    // «Все строки пустые → комментируем все» — только у toggle (как в VS Code:
    // ForceAdd/ForceRemove пустые строки игнорируют всегда).
    const allBlank = infos.every((info) => info.isBlank);
    const considered = allBlank && mode === "toggle" ? infos : infos.filter((info) => !info.isBlank);
    if (considered.length === 0) return null;

    const shouldRemove = mode === "remove" || (mode === "toggle" && considered.every((info) => info.isCommented));

    const edits: ITextEdit[] = [];
    // Stryker disable next-line ArrayDeclaration: аккумулятор сдвигов; лишняя запись в нём
    // не наблюдаема — у неё нет строки, и remapPositionForShifts пропускает такую (shift.line !== pos.line)
    const shifts: ILineShift[] = [];

    if (shouldRemove) {
        for (const info of considered) {
            if (!info.isCommented) continue;
            edits.push(
                createTextEdit(
                    createRange(info.line, info.indentLength, info.line, info.indentLength + info.markerLength),
                    "",
                ),
            );
            shifts.push({ line: info.line, column: info.indentLength, delta: -info.markerLength });
        }
        return edits.length > 0 ? { edits, shifts } : null;
    }

    const insertColumn = Math.min(...considered.map((info) => info.indentLength));
    const marker = lineComment + " ";
    for (const info of considered) {
        edits.push(createTextEdit(createRange(info.line, insertColumn, info.line, insertColumn), marker));
        shifts.push({ line: info.line, column: insertColumn, delta: marker.length });
    }
    return { edits, shifts };
}

/**
 * Ремапит позицию через набор построчных сдвигов ({@link ILineShift}).
 * Конвенция та же, что у `shiftIndent` в `EditorViewState`: точка на колонке 0
 * заякорена (вставка в начало строки не утаскивает каретку с начала), точка
 * левее сдвига не трогается, внутри удалённого куска — прижимается к его
 * началу, правее — едет на дельту.
 */
export function remapPositionForShifts(pos: IPosition, shifts: readonly ILineShift[]): IPosition {
    let character = pos.character;
    for (const shift of shifts) {
        if (shift.line !== pos.line) continue;
        // Stryker disable next-line EqualityOperator: нулевой сдвиг недостижим — маркер
        // непустой (резолв конфигурации отбрасывает пустой lineComment), так что `>= 0` эквивалентен
        if (shift.delta > 0) {
            if (character !== 0 && character >= shift.column) character += shift.delta;
        } else {
            const removedEnd = shift.column - shift.delta;
            // Stryker disable next-line ConditionalExpression,EqualityOperator: на границе
            // (character === column) обе ветки дают column — точка прижимается туда же, где и стоит
            if (character > shift.column) {
                // Stryker disable next-line EqualityOperator: при character === removedEnd обе ветки
                // дают column (removedEnd + delta === column) — граница куска принадлежит обеим
                character = character >= removedEnd ? character + shift.delta : shift.column;
            }
        }
    }
    return { line: pos.line, character };
}
