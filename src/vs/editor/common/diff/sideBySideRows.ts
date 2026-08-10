import { TextDocument } from "../model/textDocument.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

import type { IDiffViewRow } from "./diffViewModel.ts";
import type { DiffSide, IDiffViewSides } from "./diffViewText.ts";
import { collapsedRowLabel } from "./diffViewText.ts";

/**
 * Спаренные строки side-by-side диффа: проекция {@link IDiffViewRow} на строки,
 * где удалённое и добавленное стоят друг напротив друга.
 *
 * Inline-вью кладёт блок изменения последовательно — сначала все удалённые
 * строки, потом все добавленные (D+A строк). Side-by-side спаривает их
 * поиндексно (max(D, A) строк): i-я удалённая напротив i-й добавленной, хвост
 * длинной стороны — напротив филлера. Кроме этого спаривания режимы совпадают,
 * поэтому модель ({@link DiffViewModel}) одна на оба, а здесь — только вторая
 * проекция её строк.
 */

/**
 * Строка side-by-side вью. У `changed` сторона со значением `null` — филлер:
 * на этой стороне строки нет, рисуется заполнитель ровно напротив пары.
 * `collapsed` — одна плашка на обе колонки.
 */
export type ISideBySideRow =
    | { readonly kind: "unchanged"; readonly originalLine: number; readonly modifiedLine: number }
    | { readonly kind: "changed"; readonly originalLine: number | null; readonly modifiedLine: number | null }
    | { readonly kind: "collapsed"; readonly hiddenLineCount: number; readonly regionIndex: number };

/** Номер строки на стороне `side`; `null` — филлер или плашка. */
export function sideLineOf(row: ISideBySideRow, side: DiffSide): number | null {
    if (row.kind === "collapsed") return null;
    return side === "original" ? row.originalLine : row.modifiedLine;
}

/**
 * Спаривает строки inline-вью в строки side-by-side.
 *
 * Линейный проход: накопленный ран `deleted` спаривается со следующим за ним
 * раном `added` ({@link DiffViewModel} кладёт их подряд на каждое изменение);
 * любой другой вид строки закрывает пару.
 */
export function buildSideBySideRows(rows: readonly IDiffViewRow[]): ISideBySideRow[] {
    const result: ISideBySideRow[] = [];
    let deleted: number[] = [];
    let added: number[] = [];

    const flush = (): void => {
        const length = Math.max(deleted.length, added.length);
        for (let i = 0; i < length; i++) {
            result.push({
                kind: "changed",
                originalLine: deleted.at(i) ?? null,
                modifiedLine: added.at(i) ?? null,
            });
        }
        deleted = [];
        added = [];
    };

    for (const row of rows) {
        switch (row.kind) {
            case "deleted":
                // Новый ран удалённых после добавленных — началось следующее
                // изменение; прежняя пара закрывается.
                if (added.length > 0) flush();
                deleted.push(row.originalLine);
                break;
            case "added":
                added.push(row.modifiedLine);
                break;
            default:
                flush();
                result.push(row);
                break;
        }
    }
    flush();
    return result;
}

/**
 * Текст одной стороны side-by-side вью, склеенный `\n` — готовое содержимое
 * синтетического документа стороны. Строк ровно столько же, сколько в
 * `sideRows`; у филлера — пустая строка, у плашки — её плейсхолдер (обе стороны
 * показывают один и тот же текст плашки, поэтому каретке есть куда встать в
 * любой из колонок).
 */
export function buildSideBySideText(
    sideRows: readonly ISideBySideRow[],
    side: DiffSide,
    sides: IDiffViewSides,
): string {
    const lines = sideRows.map((row) => {
        if (row.kind === "collapsed") return collapsedRowLabel(row.hiddenLineCount);
        const line = sideLineOf(row, side);
        if (line === null) return "";
        return sides[side][line] ?? "";
    });
    return lines.join("\n");
}

/**
 * Пара текстовых поверхностей side-by-side: по read-only
 * {@link EditorViewState} на сторону, тем же рецептом, что и inline
 * (`createDiffViewState`): plaintext, детект отступов выключен, tabSize явно
 * после конструктора.
 */
export function createSideBySideViewStates(
    sideRows: readonly ISideBySideRow[],
    sides: IDiffViewSides,
    tabSize: number,
): Record<DiffSide, EditorViewState> {
    const create = (side: DiffSide): EditorViewState => {
        const document = new TextDocument(buildSideBySideText(sideRows, side, sides), "plaintext");
        const viewState = new EditorViewState(document);
        viewState.readOnly = true;
        viewState.detectIndentation = false;
        viewState.tabSize = tabSize;
        return viewState;
    };
    return { original: create("original"), modified: create("modified") };
}

/**
 * Строка side-by-side вью, показывающая строку `fileLine` стороны `side`.
 * Строка скрыта в свёрнутом куске — возвращается его плашка; строки нет вовсе
 * (за концом файла) — последняя строка вью. Нужна переносу каретки и скролла
 * при смене режима: точна для всех видимых строк, для скрытых даёт ближайший
 * видимый якорь.
 */
export function sideBySideLineOf(sideRows: readonly ISideBySideRow[], side: DiffSide, fileLine: number): number {
    return viewLineOf(sideRows, (row) => sideLineOf(row, side), fileLine);
}

/** То же для inline-вью: строка `rows`, показывающая `fileLine` стороны `side`. */
export function inlineLineOf(rows: readonly IDiffViewRow[], side: DiffSide, fileLine: number): number {
    const lineOf = (row: IDiffViewRow): number | null => {
        switch (row.kind) {
            case "unchanged":
                return side === "original" ? row.originalLine : row.modifiedLine;
            case "deleted":
                return side === "original" ? row.originalLine : null;
            case "added":
                return side === "modified" ? row.modifiedLine : null;
            /* v8 ignore start -- недостижимо: viewLineOf отсекает collapsed до вызова lineOf */
            default:
                return null;
            /* v8 ignore stop */
        }
    };
    return viewLineOf(rows, lineOf, fileLine);
}

/**
 * Общий скан для обоих вью: строки стороны идут строго по возрастанию, поэтому
 * первая строка с номером `>= fileLine` — либо точное попадание, либо признак,
 * что `fileLine` скрыт перед ней (тогда якорь — предыдущая плашка, а без неё —
 * сама эта строка).
 */
function viewLineOf<T extends { readonly kind: string }>(
    rows: readonly T[],
    lineOf: (row: T) => number | null,
    fileLine: number,
): number {
    let lastCollapsed = -1;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.kind === "collapsed") {
            lastCollapsed = i;
            continue;
        }
        const line = lineOf(row);
        if (line === null) continue;
        if (line === fileLine) return i;
        if (line > fileLine) return lastCollapsed >= 0 ? lastCollapsed : i;
        lastCollapsed = -1;
    }
    // За концом видимых строк: хвостовая плашка, а без неё — последняя строка.
    if (lastCollapsed >= 0) return lastCollapsed;
    return Math.max(0, rows.length - 1);
}
