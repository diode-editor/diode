import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { DetailedLineRangeMapping } from "../../../../editor/common/diff/rangeMapping.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";

/**
 * Единственная точка стыка координат (docs/arch/Editor.md): upstream `LineRange` — с 1 и
 * `endExclusive`, наш `IRange` гуттера — с 0 и `end.line` включительно. Адаптер, а не
 * миграция ядра: место вызова одно (долг — docs/TODO/Diff.md).
 */

/** Уже резолвнутые темой в packed-RGB. */
export interface IQuickDiffColors {
    readonly added: number;
    readonly modified: number;
    readonly deleted: number;
}

/**
 * Вид ханка — по пустоте диапазонов, как у upstream. У удаления своей строки нет: оно
 * рисуется граничной строкой НАД местом удаления, а в начале файла — первой строкой.
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
