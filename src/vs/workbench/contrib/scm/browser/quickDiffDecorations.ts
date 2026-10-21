import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { DetailedLineRangeMapping } from "../../../../editor/common/diff/rangeMapping.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";

/**
 * Перевод результата перенесённого из upstream diff-движка в gutter-декорации
 * ядра — **единственная точка стыка двух систем координат** (см.
 * docs/arch/Editor.md, «Координаты: ядро 0-based, вендор 1-based»):
 *
 * | | upstream `LineRange` | наш `IRange` для гуттера |
 * |---|---|---|
 * | нумерация строк | с 1 | с 0 |
 * | правая граница | `endExclusive` | `end.line` **включительно** |
 *
 * Решение — адаптер здесь, а не миграция ядра на upstream-примитивы: место
 * вызова одно, а миграция затронула бы весь редактор. Долг записан в
 * docs/TODO/Diff.md, «Долг».
 */

/** Цвета баров, уже резолвнутые темой в packed-RGB. */
export interface IQuickDiffColors {
    readonly added: number;
    readonly modified: number;
    readonly deleted: number;
}

/**
 * Собирает бары гуттера по изменениям.
 *
 * Вид ханка выводится из пустоты диапазонов, как это делает и сам upstream:
 * пустой `original` — вставка, пустой `modified` — удаление, иначе правка.
 *
 * У удаления в новом файле нет ни одной своей строки, поэтому оно рисуется
 * **одной граничной строкой** ({@link IGutterChangeDecoration}) — той, что стоит
 * НАД местом удаления. Удаление в начале файла границы сверху не имеет, поэтому
 * прижимается к первой строке.
 */
export function toGutterDecorations(
    changes: readonly DetailedLineRangeMapping[],
    colors: IQuickDiffColors,
): IGutterChangeDecoration[] {
    const decorations: IGutterChangeDecoration[] = [];

    for (const change of changes) {
        if (change.modified.isEmpty) {
            const boundary = Math.max(0, change.modified.startLineNumber - 2);
            decorations.push({ range: createRange(boundary, 0, boundary, 0), color: colors.deleted });
            continue;
        }

        const firstLine = change.modified.startLineNumber - 1;
        const lastLine = change.modified.endLineNumberExclusive - 2;
        if (change.original.isEmpty) {
            decorations.push({ range: createRange(firstLine, 0, lastLine, 0), color: colors.added });
        } else {
            // VS Code рисует правку пунктиром, а вставку/удаление — сплошным.
            decorations.push({ range: createRange(firstLine, 0, lastLine, 0), color: colors.modified, dashed: true });
        }
    }

    return decorations;
}
