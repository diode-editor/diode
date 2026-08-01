import { DisplayLine } from "../../common/displayLine.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { truncateEnd } from "../../common/textTruncation.ts";
import { BORDER_THICKNESS } from "../../dom/borderStyle.ts";
import type { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

import { kindIcon } from "./completionItemKindIcon.ts";

// ─── Styles ──────────────────────────────────────────────────────────────────

// ─── Layout ───────────────────────────────────────────────────────────────────
// [│(0)][pad(1)][icon(2)][gap(3,4)][label…][…][pad(w-2)][│(w-1)]
const LABEL_X = 5;
const RIGHT_PAD = 1;
const MIN_WIDTH = 16;

/**
 * Элемент списка автодополнения (payload `data` непрозрачен для TUIDom — там
 * хранится core-item). `kind` — числовой `CompletionItemKind` для иконки.
 */
export interface CompletionListItem {
    readonly label: string;
    readonly detail?: string;
    readonly kind?: number;
    readonly data?: unknown;
}

/**
 * Компактный дропдаун автодополнения в стиле NvChad: рамка (углы `╭╮╰╯` —
 * единый стиль с остальными оверлеями), выбранный ряд подсвечивается фоном (без
 * указателей), 1-ячейка паддинга от рамки, колонка codicon-иконки типа.
 * Собственной строки ввода нет — фильтр внутренний (набор символов сужает
 * список, не трогая буфер редактора).
 *
 * Как в VS Code suggest widget попап **не забирает фокус** (`focusable = false`):
 * навигацией/принятием/скрытием управляет {@link import("../../../src/vs/workbench/contrib/suggest/browser/completionService.ts").CompletionService} через
 * публичные методы (клавиши приходят командами по `suggestWidgetVisible`), а
 * фильтрация идёт от префикса под кареткой редактора. Мышью: наведение
 * подсвечивает ряд, клик принимает пункт.
 */
export class CompletionListElement extends TUIElement {
    public maxVisibleItems = 10;
    public preferredWidth = 40;

    public onAccept: ((item: CompletionListItem) => void) | null = null;

    private allItems: readonly CompletionListItem[] = [];
    private filteredItems: readonly CompletionListItem[] = [];
    private filterValue = "";
    private selectedIndexValue = 0;
    private scrollOffset = 0;

    public constructor() {
        super();
        // Не фокусируемся: редактор сохраняет фокус и каретку (см. класс-док).
        this.focusable = false;
        this.addEventListener("mousemove", (event) => {
            this.handleMouseMove(event);
        });
        this.addEventListener("click", (event) => {
            this.handleClick(event);
        });
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /** Задаёт полный набор элементов; переприменяет текущий фильтр (fresh). */
    public setItems(items: readonly CompletionListItem[]): void {
        this.allItems = items;
        this.applyFilter(false);
    }

    /** Задаёт фильтр «начисто» (пустой результат сворачивает список). */
    public setFilter(value: string): void {
        this.filterValue = value;
        this.applyFilter(false);
    }

    /**
     * Инкрементальное сужение по мере набора: если новый префикс не совпал ни с
     * чем — **оставляем последний непустой список** (как в VS Code), а не
     * сворачиваем попап.
     */
    public refineFilter(value: string): void {
        this.filterValue = value;
        this.applyFilter(true);
    }

    /** Видимые (отфильтрованные) элементы. */
    public get items(): readonly CompletionListItem[] {
        return this.filteredItems;
    }

    public get selectedIndex(): number {
        return this.selectedIndexValue;
    }

    public getSelectedItem(): CompletionListItem | null {
        return this.filteredItems[this.selectedIndexValue] ?? null;
    }

    // ─── Filtering ───────────────────────────────────────────────────────────

    private applyFilter(keepLastNonEmpty: boolean): void {
        const needle = this.filterValue.toLowerCase();
        const next =
            needle === ""
                ? this.allItems
                : this.allItems.filter((item) => matchText(item).toLowerCase().includes(needle));
        // «Последний непустой»: при доборе не сворачиваем список до нуля.
        if (keepLastNonEmpty && next.length === 0 && this.filteredItems.length > 0) return;
        this.filteredItems = next;
        this.selectedIndexValue = 0;
        this.scrollOffset = 0;
        this.markDirty();
    }

    // ─── Sizing ──────────────────────────────────────────────────────────────

    private get visibleItemCount(): number {
        return Math.min(this.filteredItems.length, this.maxVisibleItems);
    }

    private get contentWidth(): number {
        let max = 0;
        for (const item of this.filteredItems) {
            const labelW = new DisplayLine(item.label).displayWidth;
            const detailW =
                item.detail !== undefined && item.detail !== "" ? 2 + new DisplayLine(item.detail).displayWidth : 0;
            max = Math.max(max, labelW + detailW);
        }
        return max;
    }

    private get boxWidth(): number {
        // Левая рамка сидит внутри LABEL_X (см. схему колонок выше).
        const natural = LABEL_X + this.contentWidth + RIGHT_PAD + BORDER_THICKNESS;
        return Math.max(MIN_WIDTH, Math.min(this.preferredWidth, natural));
    }

    private get boxHeight(): number {
        return this.visibleItemCount + BORDER_THICKNESS * 2; // рамка сверху/снизу
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
        const w = this.layoutSize.width;
        const h = this.boxHeight;

        // Фон + рамка (единый стиль углов с остальными оверлеями). Рамку рисуем
        // только здесь; ряды заливают лишь внутреннюю область, чтобы фон
        // выделения не залезал на боковые рамки.
        context.drawBox(0, 0, w, h, {
            fg: this.styleVar("editorSuggestWidget.border"),
            bg: this.styleVar("editorSuggestWidget.background"),
            fill: true,
        });

        // Ряды
        for (let i = 0; i < this.visibleItemCount; i++) {
            this.renderRow(context, w, BORDER_THICKNESS + i, this.scrollOffset + i);
        }
    }

    private renderRow(context: RenderContext, w: number, rowY: number, itemIndex: number): void {
        const item = this.filteredItems[itemIndex];
        const isSelected = itemIndex === this.selectedIndexValue;
        const rowBg = isSelected
            ? this.styleVar("editorSuggestWidget.selectedBackground")
            : this.styleVar("editorSuggestWidget.background");
        const rowFg = isSelected
            ? this.styleVar("editorSuggestWidget.selectedForeground")
            : this.styleVar("editorSuggestWidget.foreground");

        // Фон ряда только во внутренней области [1, w-1) — боковые рамки (их
        // нарисовал drawBox) не трогаем, иначе фон выделения залезает на рамку.
        for (let x = 1; x < w - 1; x++) context.setCell(x, rowY, { char: " ", fg: rowFg, bg: rowBg });

        // Иконка типа
        const icon = kindIcon(item.kind);
        context.drawText(2, rowY, icon, {
            fg: isSelected ? rowFg : this.styleVar("editorSuggestWidget.iconForeground"),
            bg: rowBg,
        });

        // Правый блок: detail (dim, right-aligned)
        const contentRight = w - 1 - RIGHT_PAD; // exclusive
        let rightWidth = 0;
        if (item.detail !== undefined && item.detail !== "") {
            const detailText = "  " + item.detail;
            const detailW = new DisplayLine(detailText).displayWidth;
            if (LABEL_X + 1 + detailW <= contentRight) {
                context.drawText(contentRight - detailW, rowY, detailText, {
                    fg: isSelected ? rowFg : this.styleVar("editorSuggestWidget.detailForeground"),
                    bg: rowBg,
                });
                rightWidth = detailW;
            }
        }

        // Label (приоритет, усечение по остатку)
        const labelAvail = Math.max(0, contentRight - rightWidth - LABEL_X);
        const labelNatural = new DisplayLine(item.label).displayWidth;
        const labelText = labelNatural <= labelAvail ? item.label : truncateEnd(item.label, labelAvail);
        context.drawText(LABEL_X, rowY, labelText, { fg: rowFg, bg: rowBg }, { maxWidth: labelAvail });
    }

    // ─── Navigation (driven by CompletionService via commands) ─────────────

    public selectNext(): void {
        this.moveSelection(1);
    }

    public selectPrevious(): void {
        this.moveSelection(-1);
    }

    public selectNextPage(): void {
        this.moveSelection(Math.max(1, this.visibleItemCount));
    }

    public selectPreviousPage(): void {
        this.moveSelection(-Math.max(1, this.visibleItemCount));
    }

    // ─── Mouse ────────────────────────────────────────────────────────────────

    /**
     * Индекс пункта под локальной Y, или `null`, если это рамка/за пределами
     * видимых строк. `visibleItemCount` + `scrollOffset` гарантируют, что
     * возвращённый индекс всегда в пределах `filteredItems`.
     */
    private rowAt(localY: number): number | null {
        const row = localY - BORDER_THICKNESS; // строка 0 — верхняя рамка
        if (row < 0 || row >= this.visibleItemCount) return null;
        return this.scrollOffset + row;
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        const index = this.rowAt(event.localY);
        if (index === null || index === this.selectedIndexValue) return;
        this.selectedIndexValue = index;
        this.markDirty();
    }

    private handleClick(event: TUIMouseEvent): void {
        const index = this.rowAt(event.localY);
        if (index === null) return;
        this.selectedIndexValue = index;
        this.markDirty();
        this.onAccept?.(this.filteredItems[index]);
    }

    private moveSelection(delta: number): void {
        if (this.filteredItems.length === 0) return;
        const next = Math.max(0, Math.min(this.filteredItems.length - 1, this.selectedIndexValue + delta));
        if (next === this.selectedIndexValue) return;
        this.selectedIndexValue = next;
        this.ensureVisible(next);
        this.markDirty();
    }

    private ensureVisible(index: number): void {
        if (index < this.scrollOffset) {
            this.scrollOffset = index;
        } else if (index >= this.scrollOffset + this.visibleItemCount) {
            this.scrollOffset = index - this.visibleItemCount + 1;
        }
    }
}

/** Текст, по которому фильтруем: label (detail не участвует в фильтрации). */
function matchText(item: CompletionListItem): string {
    return item.label;
}
