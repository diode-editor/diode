import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

import { wrapSignature, type ISignatureChunk } from "./signatureLayout.ts";

// ─── Layout ───────────────────────────────────────────────────────────────────
// [│(0)][pad(1)][текст…][pad(w-2)][│(w-1)] — раскладка HoverElement.
const TEXT_X = 2;
const RIGHT_PAD = 1;
const MIN_WIDTH = 20;
const DEFAULT_MAX_WIDTH = 70;
/** Кламп высоты v1: длинная документация обрезается, скролл — отдельной задачей. */
const DEFAULT_MAX_HEIGHT = 10;

/**
 * Что показывает попап. Разметку и поиск активного параметра делает
 * {@link import("./parameterHintsService.ts").ParameterHintsService} — сюда
 * приезжает готовый плоский текст и уже посчитанный диапазон.
 */
export interface IParameterHint {
    /** Метка сигнатуры целиком: `greet(name: string): void`. */
    readonly label: string;
    /** Диапазон активного параметра в метке, `[start, end)`; пустой — подсветки нет. */
    readonly activeSpan: readonly [number, number];
    /** Счётчик перегрузок `1/2`; `null`, когда сигнатура одна. */
    readonly counter: string | null;
    /** Блоки описания (параметра и сигнатуры) — плоский текст без markdown. */
    readonly documentation: readonly string[];
}

/** Строка контента попапа: кусок метки, разделитель или строка описания. */
interface IHintLine {
    readonly text: string;
    /** Офсет в метке сигнатуры, которому соответствует `text[prefixLength]`; `null` — это не метка. */
    readonly labelStart: number | null;
    /** Сколько первых символов строки — счётчик/отступ, а не метка. */
    readonly prefixLength: number;
    readonly separator: boolean;
}

/**
 * Попап подсказки параметров: рамка, счётчик перегрузок, метка сигнатуры с
 * подсвеченным активным параметром и описания под разделителем.
 *
 * Diode-специфичный элемент, поэтому живёт рядом со своим компонентом, а не в
 * tuidom (правило docs/arch/Workbench.md): посимвольная подсветка поверх
 * drawBox композицией примитивов не выражается — эталон `HoverElement`.
 * Фокус не забирает — как suggest и hover, живёт при активном редакторе.
 */
export class ParameterHintsElement extends TUIElement {
    /** Предельная ширина попапа; фактическая — по самой длинной строке. */
    public maxWidth = DEFAULT_MAX_WIDTH;
    public maxHeight = DEFAULT_MAX_HEIGHT;

    private hintValue: IParameterHint | null = null;
    /** Кэш раскладки: (ширина текста) → строки. Layout зовут на каждый кадр. */
    private linesCache: { width: number; lines: readonly IHintLine[] } | null = null;

    public constructor() {
        super();
        this.focusable = false;
    }

    /** Есть ли что показывать (пустой попап не занимает места). */
    public get isEmpty(): boolean {
        return this.hintValue === null;
    }

    /** Показываемая подсказка — для тестов и инспектора. */
    public get hint(): IParameterHint | null {
        return this.hintValue;
    }

    public setHint(hint: IParameterHint | null): void {
        this.hintValue = hint;
        this.linesCache = null;
        // Stryker disable next-line CallExpression: пометка на перерисовку ненаблюдаема юнитом (снапшот рендерит дерево заново); её путь проверяет кадр приложения
        this.markDirty();
    }

    /** Строки контента после раскладки — для тестов и измерения. */
    public linesFor(textWidth: number): readonly string[] {
        return this.layoutFor(textWidth).map((line) => line.text);
    }

    /** Отступ метки под счётчиком перегрузок: `1/2 ` слева от сигнатуры. */
    private labelIndentFor(hint: IParameterHint): number {
        return hint.counter === null ? 0 : hint.counter.length + 1;
    }

    private layoutFor(textWidth: number): readonly IHintLine[] {
        // Кэш раскладки: layout зовут на каждый кадр. Промах кэша даёт лишний
        // пересчёт, но не другой результат — поэтому наблюдаем он только по
        // стоимости (Stryker disable ниже).
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator,ObjectLiteral: промах кэша = лишний пересчёт с тем же результатом, ненаблюдаемо
        if (this.linesCache !== null && this.linesCache.width === textWidth) return this.linesCache.lines;
        const lines = this.buildLines(textWidth);
        // Stryker disable next-line ObjectLiteral: пустой кэш = вечный промах, см. выше
        this.linesCache = { width: textWidth, lines };
        return lines;
    }

    private buildLines(textWidth: number): readonly IHintLine[] {
        const hint = this.hintValue;
        if (hint === null) return [];
        const lines: IHintLine[] = [];
        const indent = this.labelIndentFor(hint);
        const chunks: readonly ISignatureChunk[] = wrapSignature(hint.label, Math.max(1, textWidth - indent));
        for (const [index, chunk] of chunks.entries()) {
            // Счётчик рисуется отдельно, поэтому в строку метки не входит —
            // зато её отступ одинаков на всех строках переноса.
            const prefix = index === 0 && hint.counter !== null ? hint.counter + " " : " ".repeat(indent);
            lines.push({
                text: prefix + chunk.text,
                labelStart: chunk.start,
                prefixLength: prefix.length,
                separator: false,
            });
        }
        for (const block of hint.documentation) {
            const wrapped = wrapText(block, textWidth).filter((text) => text !== "");
            if (wrapped.length === 0) continue;
            lines.push({ text: "", labelStart: null, prefixLength: 0, separator: true });
            for (const text of wrapped) lines.push({ text, labelStart: null, prefixLength: 0, separator: false });
        }
        return lines;
    }

    // ─── Sizing ──────────────────────────────────────────────────────────────

    private textWidthFor(hint: IParameterHint): number {
        const natural = Math.max(
            naturalWidth(hint.label) + this.labelIndentFor(hint),
            ...hint.documentation.map(naturalWidth),
            MIN_WIDTH - TEXT_X - RIGHT_PAD - BORDER_THICKNESS,
        );
        return Math.min(natural, this.maxWidth - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
    }

    private get boxWidth(): number {
        const hint = this.hintValue;
        if (hint === null) return 0;
        return TEXT_X + this.textWidthFor(hint) + RIGHT_PAD + BORDER_THICKNESS;
    }

    private get boxHeight(): number {
        const hint = this.hintValue;
        if (hint === null) return 0;
        const lines = this.layoutFor(this.textWidthFor(hint)).length;
        return Math.min(this.maxHeight, lines + BORDER_THICKNESS * 2);
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.boxWidth;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.boxWidth;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.boxHeight;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.boxHeight;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = constraints.constrain(new Size(this.boxWidth, this.boxHeight));
        super.performLayout(BoxConstraints.tight(size));
        return size;
    }

    // ─── Render ──────────────────────────────────────────────────────────────

    public override render(context: RenderContext): void {
        const hint = this.hintValue;
        // Stryker disable next-line ConditionalExpression: пустой попап раскладывается в 0×0, поэтому его отсекает и гейт размера ниже — этот выход лишь называет причину
        if (hint === null) return;
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        /* v8 ignore start -- defensive: непустой элемент не раскладывается в ноль */
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: ветка недостижима — см. v8 ignore выше
        if (w <= 0 || h <= 0) return;
        /* v8 ignore stop */

        const border = this.styleVar("editorHoverWidget.border");
        const background = this.styleVar("editorHoverWidget.background");
        const foreground = this.styleVar("editorHoverWidget.foreground");
        const highlight = this.styleVar("editorHoverWidget.highlightForeground");
        context.drawBox(0, 0, w, h, { fg: border, bg: background, fill: true });

        const textWidth = Math.max(0, w - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
        const lines = this.layoutFor(textWidth);
        const visible = Math.min(lines.length, Math.max(0, h - BORDER_THICKNESS * 2));
        const [spanStart, spanEnd] = hint.activeSpan;
        for (let i = 0; i < visible; i++) {
            const line = lines[i];
            const y = BORDER_THICKNESS + i;
            if (line.separator) {
                context.drawText(TEXT_X, y, "─".repeat(textWidth), { fg: border, bg: background });
                continue;
            }
            const labelStart = line.labelStart;
            context.drawText(
                TEXT_X,
                y,
                line.text,
                { fg: foreground, bg: background },
                {
                    // Stryker disable next-line ObjectLiteral: строки уже перенесены в textWidth — обрезка недостижима, ограничение стоит как страховка контракта drawText
                    maxWidth: textWidth,
                    ...(labelStart === null
                        ? {}
                        : {
                              getStyle: (offset: number) => {
                                  // Счётчик и отступ переноса — не метка: их офсеты
                                  // попали бы в диапазон параметра и подсветили пустоту.
                                  if (offset < line.prefixLength) return undefined;
                                  const inLabel = labelStart + offset - line.prefixLength;
                                  if (inLabel < spanStart || inLabel >= spanEnd) return undefined;
                                  return { fg: highlight, bg: background, style: StyleFlags.Bold };
                              },
                          }),
                },
            );
        }
    }
}

/** Ширина самой длинной строки текста как есть (до переноса). */
function naturalWidth(text: string): number {
    let max = 0;
    for (const line of text.split("\n")) max = Math.max(max, new DisplayLine(line).displayWidth);
    return max;
}
