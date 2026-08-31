import { DisplayLine } from "@tuidom/core/common/displayLine";

import { STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

/**
 * Нижняя граница ширины переноса: вьюпорт в пару колонок (сплит на узком
 * терминале) дал бы вырожденные фрагменты по графеме и проекцию длиной с
 * документ×строку. Ширина клампится здесь — у единственного места, где она
 * применяется, — а не у каждого источника (режимы `editor.wordWrap`).
 */
export const MIN_WRAP_WIDTH = 8;

/**
 * Offsets начал фрагментов строки при переносе по словам (без ведущего 0),
 * либо `null` — строка влезает целиком и не переносится.
 *
 * Один проход по слотам {@link DisplayLine} (табы по позиции и широкие графемы
 * считает движок — свой посимвольный сканер дублировал бы его unicode-логику):
 * перенос ПОСЛЕ пробельного прогона (пробелы остаются в хвосте предыдущего
 * фрагмента, как в VS Code), слово длиннее ширины режется жёстко по границе
 * графемы (широкая пара не рвётся). Пробельный слот сам переноса не вызывает —
 * хвостовые пробелы висят за краем и клипятся отрисовкой, а не уезжают на
 * следующий фрагмент.
 *
 * Упрощение против VS Code: `wordWrapBreakBefore/AfterCharacters` (перенос по
 * пунктуации) не реализованы — только whitespace и жёсткая резка; CJK-текст без
 * пробелов режется по графемам. Хвост за {@link STOP_RENDERING_LINE_AFTER} не
 * сканируется — усечённая строка переносится только в разобранном префиксе.
 */
export function computeLineBreakOffsets(lineContent: string, tabSize: number, wrapWidth: number): number[] | null {
    const width = Math.max(MIN_WRAP_WIDTH, wrapWidth);
    const dl = new DisplayLine(lineContent, tabSize, STOP_RENDERING_LINE_AFTER);
    // Fast path — чистая оптимизация: без него влезающая строка проходит цикл,
    // ни один слот не переполняет ширину, и результат — тот же null.
    // Stryker disable next-line ConditionalExpression,EqualityOperator: см. выше
    if (dl.displayWidth <= width) return null;

    const breaks: number[] = [];
    // Дисплейная колонка, с которой начинается текущий фрагмент.
    let fragStartCol = 0;
    // Кандидат переноса: offset слота, следующего за последним пробельным, и
    // его колонка; -1 — в текущем фрагменте пробелов ещё не было.
    let candidateOffset = -1;
    let candidateCol = 0;
    let col = 0;
    for (const slot of dl.slots) {
        const slotEnd = col + slot.displayWidth;
        if (slot.grapheme === " " || slot.grapheme === "\t") {
            candidateOffset = slot.offset + slot.length;
            candidateCol = slotEnd;
        } else {
            // Цикл, а не if: после переноса по кандидату слово может не влезть
            // и в новый фрагмент — тогда следом жёсткая резка.
            while (slotEnd - fragStartCol > width) {
                // Stryker disable next-line EqualityOperator: кандидат не бывает нулевым — перенос ставится ПОСЛЕ пробельного слота, то есть с offset >= 1
                if (candidateOffset >= 0) {
                    breaks.push(candidateOffset);
                    fragStartCol = candidateCol;
                    candidateOffset = -1;
                } else {
                    /* v8 ignore start -- защитный гард от зацикливания: непробельная графема шире всей ширины (width >= MIN_WRAP_WIDTH=8, графемы <= 2 колонок) недостижима */
                    // Stryker disable next-line all: недостижимый защитный гард, см. v8 ignore выше
                    if (col === fragStartCol) break;
                    /* v8 ignore stop */
                    breaks.push(slot.offset);
                    fragStartCol = col;
                }
            }
        }
        col = slotEnd;
    }
    return breaks.length > 0 ? breaks : null;
}
