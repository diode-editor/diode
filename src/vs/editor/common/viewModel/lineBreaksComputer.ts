import { DisplayLine } from "@tuidom/core/common/displayLine";

import { STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

/** Кламп здесь, у единственного места применения: вьюпорт в пару колонок дал бы вырожденные фрагменты. */
export const MIN_WRAP_WIDTH = 8;

/**
 * `null` — строка влезает целиком. Перенос ПОСЛЕ пробельного прогона (пробелы — в хвосте
 * фрагмента, как в VS Code), длинное слово режется по границе графемы; табы и широкие
 * графемы считает {@link DisplayLine}, а не свой сканер. Упрощение: без
 * `wordWrapBreakBefore/AfterCharacters`, хвост за {@link STOP_RENDERING_LINE_AFTER} не переносится.
 */
export function computeLineBreakOffsets(lineContent: string, tabSize: number, wrapWidth: number): number[] | null {
    const width = Math.max(MIN_WRAP_WIDTH, wrapWidth);
    const dl = new DisplayLine(lineContent, tabSize, STOP_RENDERING_LINE_AFTER);
    // Fast path — чистая оптимизация: без него влезающая строка проходит цикл,
    // ни один слот не переполняет ширину, и результат — тот же null.
    // Stryker disable next-line ConditionalExpression,EqualityOperator: см. выше
    if (dl.displayWidth <= width) return null;

    const breaks: number[] = [];
    let fragStartCol = 0;
    // -1 — в текущем фрагменте пробелов ещё не было.
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
