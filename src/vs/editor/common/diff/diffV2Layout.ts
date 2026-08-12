import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import type {
    IExternalDecorations,
    IRangeBackgroundDecoration,
    IViewZoneDecoration,
    IViewZoneLine,
} from "../model/iEditorDecoration.ts";
import type { IViewZone } from "../viewModel/iViewZone.ts";

import type { DiffInnerRanges } from "./diffInnerRanges.ts";
import type { DiffSide } from "./diffSide.ts";
import { collapsedRowLabel } from "./diffSide.ts";
import type { IUnchangedRegion } from "./diffViewModel.ts";
import type { DetailedLineRangeMapping } from "./rangeMapping.ts";

/**
 * Раскладка диффа v2 (docs/TODO/DiffEditable.md, PR-3): из результата движка
 * (`changes` + свёртка unchanged + intra-line) собрать для КАЖДОЙ стороны —
 * настоящего редактора — зоны-филлеры, фолд-регионы и внешние декорации.
 * Чистая логика без TUI: тестируется как DiffViewModel.
 *
 * Инвариант (гейт панели): при одинаковом состоянии свёртки у обеих сторон
 * одинаковое число строк вью — зоны компенсируют разницу длин изменённых
 * блоков, свёрнутые куски одинаковой длины по построению (unchanged), плашки
 * парные.
 */

/** Заполнитель зоны-филлера — тот же, что был у рисованной смотрелки. */
export const DIFF_FILLER_CHAR = "░";

/** Текст плашки при пустом диффе (US-11): весь файл — один unchanged-кусок. */
export const IDENTICAL_NOTICE = "The files are identical";

export interface IDiffV2SideLayout {
    readonly zones: readonly IViewZone[];
    readonly foldingRegions: readonly IFoldingRegion[];
    readonly decorations: IExternalDecorations;
}

export interface IDiffV2Layout {
    readonly original: IDiffV2SideLayout;
    readonly modified: IDiffV2SideLayout;
}

export function computeDiffV2Layout(
    changes: readonly DetailedLineRangeMapping[],
    regions: readonly IUnchangedRegion[],
    innerRanges: DiffInnerRanges,
    lineCounts: { readonly original: number; readonly modified: number },
): IDiffV2Layout {
    return {
        original: computeSide("original", changes, regions, innerRanges, lineCounts.original),
        modified: computeSide("modified", changes, regions, innerRanges, lineCounts.modified),
    };
}

function computeSide(
    side: DiffSide,
    changes: readonly DetailedLineRangeMapping[],
    regions: readonly IUnchangedRegion[],
    innerRanges: DiffInnerRanges,
    lineCount: number,
): IDiffV2SideLayout {
    const zones: IViewZone[] = [];
    const zoneDecorations: IViewZoneDecoration[] = [];
    const lineBackgrounds: { startLine: number; endLine: number; colorToken: string }[] = [];
    const gutterMarkers: { line: number; char: string }[] = [];
    const rangeBackgrounds: {
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        colorToken: string;
    }[] = [];

    const lineToken = side === "original" ? "diffEditor.removedLineBackground" : "diffEditor.insertedLineBackground";
    const marker = side === "original" ? "-" : "+";

    for (const change of changes) {
        const own = side === "original" ? change.original : change.modified;
        const other = side === "original" ? change.modified : change.original;
        // 1-based LineRange → 0-based [start..endExcl).
        const start = own.startLineNumber - 1;
        const endExclusive = own.endLineNumberExclusive - 1;
        const ownLength = endExclusive - start;
        const otherLength = other.endLineNumberExclusive - other.startLineNumber;

        // Зона-филлер напротив избытка строк другой стороны; при чистой
        // вставке/удалении (own пуст) якорь — строка перед местом изменения.
        if (otherLength > ownLength) {
            const afterLine = endExclusive - 1;
            zones.push({ afterLine, size: otherLength - ownLength });
            zoneDecorations.push({ afterLine, fillChar: DIFF_FILLER_CHAR, colorToken: "diffEditor.diagonalFill" });
        }

        if (ownLength > 0) {
            lineBackgrounds.push({ startLine: start, endLine: endExclusive - 1, colorToken: lineToken });
            for (let line = start; line < endExclusive; line++) {
                gutterMarkers.push({ line, char: marker });
            }
            for (let line = start; line < endExclusive; line++) {
                for (const span of innerRanges.get(side, line)) {
                    rangeBackgrounds.push({
                        range: { start: { line, character: span.start }, end: { line, character: span.end } },
                        colorToken:
                            side === "original"
                                ? "diffEditor.removedTextBackground"
                                : "diffEditor.insertedTextBackground",
                    });
                }
            }
        }
    }

    // Пустой дифф (US-11): нотис-зона перед первой строкой обеих сторон —
    // содержимое видно, сообщение говорит главное. Живой дифф вернёт зоны
    // изменений, как только стороны разойдутся.
    if (changes.length === 0) {
        zones.push({ afterLine: -1, size: 1 });
        zoneDecorations.push({
            afterLine: -1,
            text: IDENTICAL_NOTICE,
            colorToken: "diffEditor.unchangedRegionForeground",
        });
    }

    const foldingRegions: IFoldingRegion[] = [];
    for (const region of regions) {
        if (region.hiddenLineCount <= 0) continue;
        const regionStart = side === "original" ? region.originalStartLine : region.modifiedStartLine;
        const firstHidden = regionStart + region.visibleTop;
        const lastHidden = regionStart + region.lineCount - region.visibleBottom - 1;
        // Заголовок фолда — строка над первой скрытой: тогда прячется РОВНО
        // весь скрытый кусок. Кусок с начала файла заголовка выше не имеет —
        // первая строка остаётся видимой (осознанный компромисс).
        const headerLine = Math.max(0, firstHidden - 1);
        const endLine = Math.min(lastHidden, lineCount - 1);
        if (endLine <= headerLine) continue;
        foldingRegions.push({ startLine: headerLine, endLine, isCollapsed: true });
        // Плашка «⋯ N unchanged lines»: зона с якорем на скрытой строке —
        // выживает после заголовка свернувшего региона; при развороте панель
        // пересчитает раскладку и плашка исчезнет.
        const placeholderAnchor = Math.max(headerLine, firstHidden);
        zones.push({ afterLine: placeholderAnchor, size: 1 });
        zoneDecorations.push({
            afterLine: placeholderAnchor,
            text: collapsedRowLabel(endLine - headerLine),
            colorToken: "diffEditor.unchangedRegionForeground",
        });
    }

    return {
        zones,
        foldingRegions,
        decorations: {
            lineBackgrounds,
            rangeBackgrounds,
            gutterMarkers,
            zones: zoneDecorations,
        },
    };
}

/**
 * Inline-раскладка (узкий терминал, DiffEditable PR-6): ОДИН редактор —
 * modified на всю ширину; удалённые строки original показываются
 * «зонами-призраками» с их текстом на фоне removed перед своим ганком (механика
 * upstream inline view). Фоны added, intra-line и маркеры `+` — как у
 * modified-стороны side-by-side; свёртка unchanged — по modified-координатам,
 * плашки без парности. Выравнивать нечего — филлеров нет.
 *
 * Плашка свёрнутого куска и призрак соседнего ганка могут делить якорь
 * (`setViewZones` сливает такие зоны) — содержимое склеивает
 * {@link mergeZoneDecorationsByAnchor} на выходе панели, ПОСЛЕ фильтрации
 * плашек по свёрнутости.
 */
export function computeInlineLayout(
    changes: readonly DetailedLineRangeMapping[],
    regions: readonly IUnchangedRegion[],
    innerRanges: DiffInnerRanges,
    lineCount: number,
    originalLines: readonly string[],
): IDiffV2SideLayout {
    const zones: IViewZone[] = [];
    const zoneDecorations: IViewZoneDecoration[] = [];
    const lineBackgrounds: { startLine: number; endLine: number; colorToken: string }[] = [];
    const gutterMarkers: { line: number; char: string }[] = [];
    const rangeBackgrounds: IRangeBackgroundDecoration[] = [];

    // Плашки свёртки — ПЕРВЫМИ в списке декораций: при склейке общего якоря
    // плашка обязана встать НАД призраком (порядок массива = порядок строк).
    const foldingRegions: IFoldingRegion[] = [];
    for (const region of regions) {
        if (region.hiddenLineCount <= 0) continue;
        const firstHidden = region.modifiedStartLine + region.visibleTop;
        const lastHidden = region.modifiedStartLine + region.lineCount - region.visibleBottom - 1;
        const headerLine = Math.max(0, firstHidden - 1);
        const endLine = Math.min(lastHidden, lineCount - 1);
        if (endLine <= headerLine) continue;
        foldingRegions.push({ startLine: headerLine, endLine, isCollapsed: true });
        const placeholderAnchor = Math.max(headerLine, firstHidden);
        zones.push({ afterLine: placeholderAnchor, size: 1 });
        zoneDecorations.push({
            afterLine: placeholderAnchor,
            text: collapsedRowLabel(endLine - headerLine),
            colorToken: "diffEditor.unchangedRegionForeground",
        });
    }

    for (const change of changes) {
        const modStart = change.modified.startLineNumber - 1;
        const modEndExclusive = change.modified.endLineNumberExclusive - 1;
        const origStart = change.original.startLineNumber - 1;
        const origEndExclusive = change.original.endLineNumberExclusive - 1;

        // Призрак удалённых строк — перед местом изменения (`-1` у ганка в
        // начале файла нормализует setViewZones: зона перед первой строкой).
        if (origEndExclusive > origStart) {
            const afterLine = modStart - 1;
            const lines = originalLines.slice(origStart, origEndExclusive).map((text) => ({
                text,
                bgToken: "diffEditor.removedLineBackground",
            }));
            zones.push({ afterLine, size: lines.length });
            zoneDecorations.push({ afterLine, lines });
        }

        if (modEndExclusive > modStart) {
            lineBackgrounds.push({
                startLine: modStart,
                endLine: modEndExclusive - 1,
                colorToken: "diffEditor.insertedLineBackground",
            });
            for (let line = modStart; line < modEndExclusive; line++) {
                gutterMarkers.push({ line, char: "+" });
                for (const span of innerRanges.get("modified", line)) {
                    rangeBackgrounds.push({
                        range: { start: { line, character: span.start }, end: { line, character: span.end } },
                        colorToken: "diffEditor.insertedTextBackground",
                    });
                }
            }
        }
    }

    if (changes.length === 0) {
        zones.push({ afterLine: -1, size: 1 });
        zoneDecorations.push({
            afterLine: -1,
            text: IDENTICAL_NOTICE,
            colorToken: "diffEditor.unchangedRegionForeground",
        });
    }

    return {
        zones,
        foldingRegions,
        decorations: {
            lineBackgrounds,
            rangeBackgrounds,
            gutterMarkers,
            zones: zoneDecorations,
        },
    };
}

/**
 * Склейка зон-декораций с общим якорем в одну многострочную: `setViewZones`
 * сливает такие зоны (size суммируется), а рендер адресует декорации
 * `Map<якорь, декорация>` — без склейки вторая декорация молча пропала бы.
 * Порядок строк = порядок декораций в массиве; `text`-декорация становится
 * строкой со своим цветом.
 */
export function mergeZoneDecorationsByAnchor(decorations: readonly IViewZoneDecoration[]): IViewZoneDecoration[] {
    const byAnchor = new Map<number, IViewZoneDecoration[]>();
    for (const decoration of decorations) {
        const bucket = byAnchor.get(decoration.afterLine);
        if (bucket === undefined) byAnchor.set(decoration.afterLine, [decoration]);
        else bucket.push(decoration);
    }
    const merged: IViewZoneDecoration[] = [];
    for (const [afterLine, bucket] of byAnchor) {
        if (bucket.length === 1) {
            merged.push(bucket[0]);
            continue;
        }
        const lines: IViewZoneLine[] = [];
        for (const decoration of bucket) {
            if (decoration.lines !== undefined) lines.push(...decoration.lines);
            else if (decoration.text !== undefined) {
                lines.push({
                    text: decoration.text,
                    ...(decoration.colorToken !== undefined ? { colorToken: decoration.colorToken } : {}),
                });
            }
        }
        merged.push({ afterLine, lines });
    }
    return merged;
}
