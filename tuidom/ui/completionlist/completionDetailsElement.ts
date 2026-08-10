import { DisplayLine } from "../../common/displayLine.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { truncateEnd } from "../../common/textTruncation.ts";
import { BORDER_THICKNESS } from "../../dom/borderStyle.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

// ─── Layout ───────────────────────────────────────────────────────────────────
// [│(0)][pad(1)][текст…][pad(w-2)][│(w-1)]
const TEXT_X = 2;
const RIGHT_PAD = 1;
const MIN_WIDTH = 20;
const DEFAULT_MAX_WIDTH = 60;

/** Содержимое панели: сигнатура сверху, документация под ней. */
export interface CompletionDetailsContent {
    /** Сигнатура/тип пункта (`detail` или `labelDetails.detail`). */
    readonly detail?: string;
    /** Документация пункта. Markdown НЕ парсится — рендерера markdown нет. */
    readonly documentation?: string;
}

/**
 * Панель описания выбранного пункта автодополнения — соседка
 * {@link import("./completionListElement.ts").CompletionListElement} в
 * {@link import("./completionWidgetElement.ts").CompletionWidgetElement}.
 *
 * Показывает сигнатуру и документацию с переносом по словам. Содержимое
 * приходит извне уже догруженным (у LSP-источников описание доезжает отдельным
 * `resolve`-запросом), сама панель ничего не запрашивает. Фокус не забирает —
 * как и список, живёт при активном редакторе.
 */
export class CompletionDetailsElement extends TUIElement {
    /** Предельная ширина панели; высоту ограничивает владелец по высоте списка. */
    public maxWidth = DEFAULT_MAX_WIDTH;
    public maxHeight = 10;

    private detailValue = "";
    private documentationValue = "";
    /** Кэш переноса: (ширина текста) → строки. Layout зовут на каждый кадр. */
    private wrapCache: { width: number; lines: readonly string[] } | null = null;

    public constructor() {
        super();
        this.focusable = false;
    }

    /** Есть ли что показывать (пустая панель не занимает места). */
    public get isEmpty(): boolean {
        return this.detailValue === "" && this.documentationValue === "";
    }

    public setContent(content: CompletionDetailsContent | null): void {
        const detail = content?.detail ?? "";
        const documentation = content?.documentation ?? "";
        if (detail === this.detailValue && documentation === this.documentationValue) return;
        this.detailValue = detail;
        this.documentationValue = documentation;
        this.wrapCache = null;
        this.markDirty();
    }

    /** Строки контента после переноса — для тестов и измерения. */
    public linesFor(textWidth: number): readonly string[] {
        if (this.wrapCache !== null && this.wrapCache.width === textWidth) return this.wrapCache.lines;
        const lines: string[] = [];
        if (this.detailValue !== "") lines.push(...wrapText(this.detailValue, textWidth));
        // Пустая строка-разделитель нужна, только если есть обе части.
        if (this.detailValue !== "" && this.documentationValue !== "") lines.push("");
        if (this.documentationValue !== "") lines.push(...wrapText(this.documentationValue, textWidth));
        this.wrapCache = { width: textWidth, lines };
        return lines;
    }

    // ─── Sizing ──────────────────────────────────────────────────────────────

    private get textWidth(): number {
        const natural = Math.max(
            naturalWidth(this.detailValue),
            naturalWidth(this.documentationValue),
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
        if (this.isEmpty) return;
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        if (w <= 0 || h <= 0) return;

        context.drawBox(0, 0, w, h, {
            fg: this.styleVar("editorSuggestWidget.border"),
            bg: this.styleVar("editorSuggestWidget.background"),
            fill: true,
        });

        const textWidth = Math.max(0, w - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
        const lines = this.linesFor(textWidth);
        const visible = Math.min(lines.length, Math.max(0, h - BORDER_THICKNESS * 2));
        const detailLines = this.detailValue === "" ? 0 : wrapText(this.detailValue, textWidth).length;
        for (let i = 0; i < visible; i++) {
            // Сигнатура сверху — приглушённым цветом, как в правой колонке списка.
            const isDetail = i < detailLines;
            context.drawText(
                TEXT_X,
                BORDER_THICKNESS + i,
                lines[i],
                {
                    fg: this.styleVar(
                        isDetail ? "editorSuggestWidget.detailForeground" : "editorSuggestWidget.foreground",
                    ),
                    bg: this.styleVar("editorSuggestWidget.background"),
                },
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

/**
 * Перенос по словам в ширину `width`. Переводы строк источника сохраняются;
 * слово длиннее строки режется по ширине (усечения контента не происходит —
 * остаток уезжает на следующую строку).
 */
export function wrapText(text: string, width: number): string[] {
    if (width <= 0) return [];
    const result: string[] = [];
    for (const paragraph of text.split("\n")) {
        let current = "";
        for (const word of paragraph.split(/\s+/).filter((w) => w !== "")) {
            const candidate = current === "" ? word : `${current} ${word}`;
            if (new DisplayLine(candidate).displayWidth <= width) {
                current = candidate;
                continue;
            }
            if (current !== "") result.push(current);
            // Слово шире строки: режем его по ширине, пока помещается остаток.
            let rest = word;
            while (new DisplayLine(rest).displayWidth > width) {
                const head = truncateEnd(rest, width, "");
                // Символ шире строки (широкий CJK при width 1) — усечение даёт
                // пустую строку; режем принудительно, иначе цикл вечный.
                if (head === "") break;
                result.push(head);
                rest = rest.slice(head.length);
            }
            current = rest;
        }
        result.push(current);
    }
    return result;
}
