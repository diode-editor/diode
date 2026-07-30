import { DisplayLine } from "../../../../tuidom/common/displayLine.ts";
import { StyleFlags } from "../../../../tuidom/common/styleFlags.ts";
import type { TUIKeyboardEvent } from "../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import type { TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { RenderContext, TUIElement } from "../../../../tuidom/dom/tuiElement.ts";
import type { IScrollable } from "../../../../tuidom/ui/scrollbar/iScrollable.ts";
import type { IDiffViewRow } from "../common/diff/diffViewModel.ts";
import type { ILineTokens } from "../common/languages/iLineTokens.ts";
import type { ResolvedTokenStyle } from "../common/languages/iTokenStyleResolver.ts";

import { packStyleFlags, TokenIndex } from "./editorElement.ts";

/** Сторона диффа, с которой берётся строка. */
export type DiffSide = "original" | "modified";

/**
 * Текст и токены для отрисовки — реализует владелец элемента (панель), потому
 * что документами и токен-сторами владеет он. Элемент про `TextDocument` и
 * тем более про git ничего не знает.
 */
export interface IDiffRowSource {
    getLine(side: DiffSide, line: number): string;
    /** Токены строки; `undefined` — рисуем без подсветки. */
    getLineTokens(side: DiffSide, line: number): ILineTokens | undefined;
    resolveTokenStyle(scopes: readonly string[]): ResolvedTokenStyle;
}

export interface IDiffViewStyles {
    readonly background: number;
    readonly foreground: number;
    readonly gutterBackground: number;
    readonly lineNumberForeground: number;
    readonly insertedLineBackground: number;
    readonly removedLineBackground: number;
    readonly unchangedRegionForeground: number;
}

export const unthemedDiffViewStyles: IDiffViewStyles = {
    background: 0x000000,
    foreground: 0xcccccc,
    gutterBackground: 0x000000,
    lineNumberForeground: 0x858585,
    insertedLineBackground: 0x373d29,
    removedLineBackground: 0x4b1818,
    unchangedRegionForeground: 0x8c8c8c,
};

/** Символ-плейсхолдер свёрнутого куска — он же метка в обеих колонках номеров. */
const ELLIPSIS = "⋯";

// Отступы гуттера повторяют редактор (`editorElement.ts`: GUTTER_LEFT_PADDING и
// FOLD_GAP_LEFT/RIGHT вокруг колонки чевронов), чтобы дифф читался как та же
// компонента, а не как отдельный виджет: номера не липнут к левому краю, а текст
// не липнет к маркеру.
const GUTTER_LEFT_PADDING = 2;
const GUTTER_RIGHT_PADDING = 2;

/**
 * Отрисовка inline-диффа: список {@link IDiffViewRow} с гуттером на два номера
 * строки (оригинал / изменённый) и маркером `-`/`+`.
 *
 * Парный к `editorElement.ts`, но **read-only**: ни курсора, ни выделения, ни
 * undo, ни folding — из-за них у редактора почти тысяча строк, а здесь их нет.
 * Общее с редактором — подсветка: те же `TokenIndex` и `packStyleFlags`, тот же
 * поцельный обход с `DisplayLine`, который корректно ведёт себя с широкими
 * символами и табами.
 */
export class DiffViewElement extends TUIElement implements IScrollable {
    private rowsValue: readonly IDiffViewRow[] = [];
    private source: IDiffRowSource | null = null;
    private stylesValue: IDiffViewStyles = unthemedDiffViewStyles;
    private scrollTopValue = 0;
    private numberWidth = 1;
    public tabSize = 4;

    public constructor() {
        super();
        this.focusable = true;
        this.addEventListener("wheel", (event) => {
            this.handleWheel(event);
        });
        this.addEventListener("keypress", (event) => {
            this.handleKeyPress(event);
        });
    }

    public setRows(rows: readonly IDiffViewRow[], source: IDiffRowSource): void {
        this.rowsValue = rows;
        this.source = source;
        this.numberWidth = computeNumberWidth(rows);
        this.scrollTopValue = 0;
        this.markDirty();
    }

    public get rows(): readonly IDiffViewRow[] {
        return this.rowsValue;
    }

    public setStyles(styles: IDiffViewStyles): void {
        this.stylesValue = styles;
        this.markDirty();
    }

    /** Ширина гуттера: `отступ + номер + зазор + номер + зазор + маркер + отступ`. */
    public get gutterWidth(): number {
        const separators = 2;
        const marker = 1;
        return GUTTER_LEFT_PADDING + this.numberWidth * 2 + separators + marker + GUTTER_RIGHT_PADDING;
    }

    public get contentHeight(): number {
        return this.rowsValue.length;
    }

    public get contentWidth(): number {
        return this.layoutSize.width;
    }

    public get scrollTop(): number {
        return this.scrollTopValue;
    }

    /**
     * Горизонтальной прокрутки пока нет: длинные строки обрезаются по правому
     * краю. Реализуется вместе с раскрытием свёрнутых кусков — оба жеста про
     * «показать больше» и просятся в один шаг (docs/TODO/Diff.md).
     */
    public readonly scrollLeft = 0;

    public scrollBy(lines: number): void {
        const maxTop = Math.max(0, this.rowsValue.length - this.layoutSize.height);
        const next = Math.min(Math.max(0, this.scrollTopValue + lines), maxTop);
        if (next === this.scrollTopValue) return;
        this.scrollTopValue = next;
        this.markDirty();
    }

    public override getMinIntrinsicWidth(): number {
        return this.gutterWidth;
    }

    public override getMaxIntrinsicWidth(): number {
        return Number.MAX_SAFE_INTEGER;
    }

    public override getMinIntrinsicHeight(): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(): number {
        return Math.max(1, this.rowsValue.length);
    }

    public render(context: RenderContext): void {
        const styles = this.stylesValue;
        const gutterW = this.gutterWidth;
        const contentCols = Math.max(0, this.layoutSize.width - gutterW);
        const height = this.layoutSize.height;

        for (let screenY = 0; screenY < height; screenY++) {
            const row = this.rowsValue.at(this.scrollTopValue + screenY);
            const bg = row === undefined ? styles.background : this.backgroundOf(row);

            // Фон на всю ширину — иначе цвет строки обрывался бы по концу текста.
            for (let x = 0; x < this.layoutSize.width; x++) {
                context.setCell(x, screenY, { char: " ", bg, width: 1 });
            }
            if (row === undefined) continue;

            this.renderGutter(context, screenY, row, bg);
            this.renderContent(context, screenY, row, gutterW, contentCols, bg);
        }
    }

    private backgroundOf(row: IDiffViewRow): number {
        switch (row.kind) {
            case "added":
                return this.stylesValue.insertedLineBackground;
            case "deleted":
                return this.stylesValue.removedLineBackground;
            default:
                return this.stylesValue.background;
        }
    }

    /** `<номер оригинала> <номер изменённого> <маркер> `. */
    private renderGutter(context: RenderContext, screenY: number, row: IDiffViewRow, bg: number): void {
        const styles = this.stylesValue;
        const w = this.numberWidth;
        const original = row.kind === "unchanged" || row.kind === "deleted" ? String(row.originalLine + 1) : "";
        const modified = row.kind === "unchanged" || row.kind === "added" ? String(row.modifiedLine + 1) : "";
        const marker = row.kind === "added" ? "+" : row.kind === "deleted" ? "-" : " ";

        const numberFg = styles.lineNumberForeground;
        const collapsed = row.kind === "collapsed";
        const left = GUTTER_LEFT_PADDING;
        context.drawText(left, screenY, (collapsed ? ELLIPSIS : original).padStart(w), { fg: numberFg, bg });
        context.drawText(left + w + 1, screenY, (collapsed ? ELLIPSIS : modified).padStart(w), { fg: numberFg, bg });
        context.drawText(left + w * 2 + 2, screenY, marker, { fg: styles.foreground, bg });
    }

    private renderContent(
        context: RenderContext,
        screenY: number,
        row: IDiffViewRow,
        gutterW: number,
        contentCols: number,
        bg: number,
    ): void {
        const styles = this.stylesValue;

        if (row.kind === "collapsed") {
            const label = `${ELLIPSIS} ${String(row.hiddenLineCount)} unchanged line${row.hiddenLineCount === 1 ? "" : "s"}`;
            context.drawText(
                gutterW,
                screenY,
                label,
                { fg: styles.unchangedRegionForeground, bg },
                {
                    maxWidth: contentCols,
                },
            );
            return;
        }

        const side: DiffSide = row.kind === "deleted" ? "original" : "modified";
        const line = row.kind === "deleted" ? row.originalLine : row.modifiedLine;
        const source = this.source;
        /* v8 ignore start -- defensive: строки без источника не выставляются (setRows принимает их вместе) */
        if (source === null) return;
        /* v8 ignore stop */

        const text = source.getLine(side, line);
        const displayLine = new DisplayLine(text, this.tabSize);
        const tokens = source.getLineTokens(side, line);
        const tokenIndex = tokens ? new TokenIndex(tokens, text.length) : null;

        // Поцельный обход, как в редакторе: только так корректно отрабатывают
        // широкие символы, табы и горизонтальный скролл по ДИСПЛЕЙНЫМ колонкам.
        let screenX = 0;
        while (screenX < contentCols) {
            const displayCol = screenX;
            const char = displayLine.charAtColumn(displayCol);
            /* v8 ignore start -- недостижимо без горизонтальной прокрутки: обход всегда перешагивает продолжающую колонку широкого символа. Станет достижимым вместе со scrollLeft */
            if (char === "") {
                screenX++;
                continue;
            }
            /* v8 ignore stop */
            const slot = displayLine.graphemeAtColumn(displayCol);
            const width = slot ? slot.displayWidth : 1;

            let fg = styles.foreground;
            let style: number = StyleFlags.None;
            if (tokenIndex && slot) {
                const token = tokenIndex.tokenAt(slot.offset);
                if (token) {
                    const resolved = source.resolveTokenStyle(token.scopes);
                    if (resolved.fg !== undefined) fg = resolved.fg;
                    style = packStyleFlags(resolved);
                }
            }

            if (slot?.grapheme === "\t") {
                for (let i = 0; i < width && screenX + i < contentCols; i++) {
                    context.setCell(gutterW + screenX + i, screenY, { char: " ", fg, bg, style, width: 1 });
                }
                screenX += width;
                continue;
            }
            if (width === 2 && screenX + 1 >= contentCols) {
                // Широкий символ не влезает у правого края — рисуем пробел.
                context.setCell(gutterW + screenX, screenY, { char: " ", fg, bg, style, width: 1 });
                screenX += 1;
                continue;
            }
            context.setCell(gutterW + screenX, screenY, { char, fg, bg, style, width });
            screenX += width;
        }
    }

    private handleWheel(event: TUIMouseEvent): void {
        // Горизонтальные направления игнорируем: длинные строки листаются
        // стрелками через scrollLeft, а колесом вбок в терминале почти не крутят.
        if (event.wheelDirection === "up") this.scrollBy(-3);
        else if (event.wheelDirection === "down") this.scrollBy(3);
        else return;
        event.stopPropagation();
    }

    private handleKeyPress(event: TUIKeyboardEvent): void {
        const page = Math.max(1, this.layoutSize.height - 1);
        switch (event.key) {
            case "ArrowDown":
                this.scrollBy(1);
                break;
            case "ArrowUp":
                this.scrollBy(-1);
                break;
            case "PageDown":
                this.scrollBy(page);
                break;
            case "PageUp":
                this.scrollBy(-page);
                break;
            case "Home":
                this.scrollBy(-this.rowsValue.length);
                break;
            case "End":
                this.scrollBy(this.rowsValue.length);
                break;
            default:
                return;
        }
        event.stopPropagation();
    }
}

/** Ширина колонки номера — по самому большому номеру строки в наборе. */
function computeNumberWidth(rows: readonly IDiffViewRow[]): number {
    let max = 0;
    for (const row of rows) {
        if (row.kind === "unchanged" || row.kind === "deleted") max = Math.max(max, row.originalLine + 1);
        if (row.kind === "unchanged" || row.kind === "added") max = Math.max(max, row.modifiedLine + 1);
    }
    return Math.max(1, String(max).length);
}
