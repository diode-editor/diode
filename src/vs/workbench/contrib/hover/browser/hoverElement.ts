import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

// ─── Layout ───────────────────────────────────────────────────────────────────
// [│(0)][pad(1)][текст…][pad(w-2)][│(w-1)] — раскладка CompletionDetailsElement.
const TEXT_X = 2;
const RIGHT_PAD = 1;
const MIN_WIDTH = 20;
const DEFAULT_MAX_WIDTH = 70;
/** Кламп высоты v1: длинный hover обрезается, скролл — отдельной задачей. */
const DEFAULT_MAX_HEIGHT = 12;

/** Результат переноса: строки + номера строк-разделителей между блоками. */
interface IWrappedLines {
    readonly lines: readonly string[];
    readonly separators: ReadonlySet<number>;
}

/**
 * Попап hover'а: рамка + плоский текст с переносом по словам. Блоки (по одному
 * на провайдера) разделяются горизонтальной линией. Markdown сюда уже не
 * доезжает — его стрипает HoverService; рендерера markdown нет (docs/TODO/LSP.md).
 *
 * Diode-специфичный элемент, поэтому живёт рядом со своим компонентом, а не в
 * tuidom (правило docs/arch/Workbench.md): посимвольный render поверх drawBox
 * композицией примитивов не выражается — эталон `quickPickFrameElement.ts`.
 * Фокус не забирает — как suggest, живёт при активном редакторе.
 */
export class HoverElement extends TUIElement {
    /** Предельная ширина попапа; фактическая — по самой длинной строке. */
    public maxWidth = DEFAULT_MAX_WIDTH;
    public maxHeight = DEFAULT_MAX_HEIGHT;

    private blocksValue: readonly string[] = [];
    /** Кэш переноса: (ширина текста) → строки. Layout зовут на каждый кадр. */
    private wrapCache: { width: number; wrapped: IWrappedLines } | null = null;

    public constructor() {
        super();
        this.focusable = false;
    }

    /** Есть ли что показывать (пустой попап не занимает места). */
    public get isEmpty(): boolean {
        return this.blocksValue.length === 0;
    }

    /** Блоки контента — по одному на провайдера, плоский текст без разметки. */
    public setBlocks(blocks: readonly string[]): void {
        this.blocksValue = blocks.filter((block) => block.trim() !== "");
        this.wrapCache = null;
        // Stryker disable next-line CallExpression: пометка на перерисовку ненаблюдаема юнитом (снапшот рендерит дерево заново); её путь проверяет кадр приложения
        this.markDirty();
    }

    /** Строки контента после переноса — для тестов и измерения. */
    public linesFor(textWidth: number): readonly string[] {
        return this.wrappedFor(textWidth).lines;
    }

    private wrappedFor(textWidth: number): IWrappedLines {
        // Кэш переноса: layout зовут на каждый кадр. Промах кэша даёт лишний
        // пересчёт, но не другой результат — поэтому наблюдаем он только по
        // стоимости (Stryker disable ниже).
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator,ObjectLiteral: промах кэша = лишний пересчёт с тем же результатом, ненаблюдаемо
        if (this.wrapCache !== null && this.wrapCache.width === textWidth) return this.wrapCache.wrapped;
        const lines: string[] = [];
        const separators = new Set<number>();
        for (const [index, block] of this.blocksValue.entries()) {
            if (index > 0) {
                separators.add(lines.length);
                lines.push("─".repeat(Math.max(0, textWidth)));
            }
            lines.push(...wrapText(block, textWidth));
        }
        const wrapped: IWrappedLines = { lines, separators };
        // Stryker disable next-line ObjectLiteral: пустой кэш = вечный промах, см. выше
        this.wrapCache = { width: textWidth, wrapped };
        return wrapped;
    }

    // ─── Sizing ──────────────────────────────────────────────────────────────

    private get textWidth(): number {
        const natural = Math.max(
            ...this.blocksValue.map(naturalWidth),
            MIN_WIDTH - TEXT_X - RIGHT_PAD - BORDER_THICKNESS,
        );
        return Math.min(natural, this.maxWidth - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
    }

    private get boxWidth(): number {
        if (this.isEmpty) return 0;
        return TEXT_X + this.textWidth + RIGHT_PAD + BORDER_THICKNESS;
    }

    private get boxHeight(): number {
        if (this.isEmpty) return 0;
        const lines = this.linesFor(this.textWidth).length;
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
        // Stryker disable next-line ConditionalExpression: пустой попап раскладывается в 0×0, поэтому его отсекает и гейт размера ниже — этот выход лишь называет причину
        if (this.isEmpty) return;
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        /* v8 ignore start -- defensive: непустой элемент не раскладывается в ноль */
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: ветка недостижима — см. v8 ignore выше
        if (w <= 0 || h <= 0) return;
        /* v8 ignore stop */

        const border = this.styleVar("editorHoverWidget.border");
        const background = this.styleVar("editorHoverWidget.background");
        context.drawBox(0, 0, w, h, { fg: border, bg: background, fill: true });

        const textWidth = Math.max(0, w - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
        const { lines, separators } = this.wrappedFor(textWidth);
        const visible = Math.min(lines.length, Math.max(0, h - BORDER_THICKNESS * 2));
        for (let i = 0; i < visible; i++) {
            // Линия-разделитель блоков — цветом рамки, текст — своим.
            context.drawText(
                TEXT_X,
                BORDER_THICKNESS + i,
                lines[i],
                {
                    fg: separators.has(i) ? border : this.styleVar("editorHoverWidget.foreground"),
                    bg: background,
                },
                // Stryker disable next-line ObjectLiteral: строки уже перенесены в textWidth — обрезка недостижима, ограничение стоит как страховка контракта drawText
                { maxWidth: textWidth },
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
