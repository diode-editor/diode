import { packRgb } from "../../common/colorUtils.ts";
import { DisplayLine } from "../../common/displayLine.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { abbreviatePath, truncateEnd } from "../../common/textTruncation.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import type { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { InputElement } from "../inputbox/inputElement.ts";

// ─── Styles ─────────────────────────────────────────────────────────────────

export interface IQuickPickStyles {
    readonly borderFg: number;
    readonly bg: number;
    readonly fg: number;
    readonly activeSelectionBg: number;
    readonly activeSelectionFg: number;
    readonly matchFg: number;
    readonly descriptionFg: number;
    readonly badgeFg: number;
    readonly shortcutFg: number;
    readonly hintFg: number;
    readonly titleFg: number;
    readonly promptFg: number;
    readonly validationErrorFg: number;
    readonly validationWarningFg: number;
    readonly validationInfoFg: number;
}

// Текущая (нетемизированная) палитра пикера; темизированных call-sites пока нет.
export const unthemedQuickPickStyles: IQuickPickStyles = {
    borderFg: packRgb(83, 83, 83),
    bg: packRgb(37, 37, 38),
    fg: packRgb(204, 204, 204),
    activeSelectionBg: packRgb(4, 57, 94),
    activeSelectionFg: packRgb(255, 255, 255),
    matchFg: packRgb(100, 200, 255),
    descriptionFg: packRgb(125, 125, 125),
    badgeFg: packRgb(150, 190, 100),
    shortcutFg: packRgb(128, 128, 128),
    hintFg: packRgb(100, 150, 200),
    titleFg: packRgb(230, 230, 230),
    promptFg: packRgb(140, 140, 140),
    validationErrorFg: packRgb(240, 100, 90),
    validationWarningFg: packRgb(255, 200, 0),
    validationInfoFg: packRgb(100, 150, 200),
};

// ─── Public types ────────────────────────────────────────────────────────────

export interface QuickPickItem {
    /** Nerd font icon character (e.g. a file icon like "\uf15b"). */
    icon?: string;
    /** Main display text. */
    label: string;
    /** Right-side text: file path, category, etc. */
    description?: string;
    /** Keyboard shortcut shown right-aligned, e.g. "Ctrl+Shift+P". */
    shortcut?: string;
    /** Action hint shown after description, e.g. "Configure Binding". */
    hint?: string;
    /** Marker badge, e.g. "recently used". */
    badge?: string;
    /** Byte-offset ranges in `label` to highlight as fuzzy-match hits. */
    labelMatchRanges?: readonly [number, number][];
    /** Byte-offset ranges in `description` to highlight as fuzzy-match hits. */
    descriptionMatchRanges?: readonly [number, number][];
}

// ─── Widget ──────────────────────────────────────────────────────────────────

/**
 * Quick-open / command-palette style picker.
 *
 * Renders a bordered box with:
 *   - top row: text input (query)
 *   - optional separator + scrollable item list below
 *
 * The widget does NOT perform any filtering itself — pass pre-filtered
 * `items` with `labelMatchRanges`/`descriptionMatchRanges` populated.
 *
 * Keyboard:
 *   ArrowDown/Up   — move selection (no wrap)
 *   Enter          — fire `onAccept(item, index)`
 *   Escape         — fire `onCancel()`
 *   All other keys — forwarded to the InputElement (typing)
 *
 * Usage:
 *   const picker = new QuickPickElement();
 *   picker.placeholder = "Go to file…";
 *   picker.onQueryChange = query => { picker.items = search(query); };
 *   picker.onAccept = (item) => openFile(item.description!);
 */
export type QuickPickAcceptMode = "item" | "value";
export type ValidationSeverity = "error" | "warning" | "info";

export class QuickPickElement extends TUIElement {
    public placeholder = "Type to search…";
    /** Maximum rows of the list to show at once (scrolls when exceeded). */
    public maxVisibleItems = 10;

    /** Optional title drawn centered into the top border (e.g. "Save As"). */
    public title: string | undefined = undefined;
    /**
     * Optional subtitle drawn on a dedicated row under the input (dim).
     * Used by the InputBox flavor. Overridden by `validationMessage` when set.
     */
    public prompt: string | undefined = undefined;
    /** Validation/error text shown under the input; blocks Enter when severity is "error". */
    public validationMessage: string | null = null;
    public validationSeverity: ValidationSeverity = "error";
    /**
     * How Enter is interpreted:
     *   "item"  — fire onAccept(item, index), only when the list is non-empty (default; QuickOpen).
     *   "value" — always fire onAcceptValue(getQuery()) — the InputBox flavor.
     */
    public acceptMode: QuickPickAcceptMode = "item";
    /** Fired by Enter when acceptMode === "value". */
    public onAcceptValue: ((value: string) => void) | null = null;
    /**
     * Desired width of the picker in columns.
     * When the element is laid out with loose constraints it will use this
     * value (clamped to [minWidth, maxWidth]).
     */
    public preferredWidth = 60;

    private styles: IQuickPickStyles = unthemedQuickPickStyles;

    public onQueryChange: ((query: string) => void) | null = null;
    public onAccept: ((item: QuickPickItem, index: number) => void) | null = null;
    public onCancel: (() => void) | null = null;
    /**
     * Fired when the highlighted (active) item changes via keyboard navigation —
     * used for live preview (e.g. the color-theme picker applies the theme as you
     * arrow through the list). NOT fired by `items =` / `refreshItems` /
     * `setActiveIndex` (those are programmatic repositioning, not user intent).
     */
    public onActiveItemChanged: ((item: QuickPickItem, index: number) => void) | null = null;

    public readonly inputElement: InputElement;

    private itemsValue: readonly QuickPickItem[] = [];
    private selectedIndexValue = 0;
    private scrollOffset = 0;

    public constructor() {
        super();
        this.focusable = true;

        this.inputElement = new InputElement();
        this.inputElement.showBorder = false;
        this.appendChild(this.inputElement);

        this.inputElement.onChange = (value) => {
            this.onQueryChange?.(value);
        };

        // Handle navigation keys that bubble up from the focused InputElement.
        // These keys are not consumed by InputElement.performDefaultAction, so they
        // bubble here. We preventDefault() to suppress further handling.
        this.addEventListener("keydown", (event) => {
            const keyEvent = event;
            switch (keyEvent.key) {
                case "ArrowDown":
                    event.preventDefault();
                    this.moveSelection(1);
                    break;
                case "ArrowUp":
                    event.preventDefault();
                    this.moveSelection(-1);
                    break;
                case "PageDown":
                    event.preventDefault();
                    this.moveSelection(Math.max(1, this.effectiveVisibleRows));
                    break;
                case "PageUp":
                    event.preventDefault();
                    this.moveSelection(-Math.max(1, this.effectiveVisibleRows));
                    break;
                case "Enter":
                    event.preventDefault();
                    // A hard validation error blocks accept in every mode.
                    if (this.validationMessage !== null && this.validationSeverity === "error") {
                        break;
                    }
                    if (this.acceptMode === "value") {
                        this.onAcceptValue?.(this.getQuery());
                    } else if (this.itemsValue.length > 0) {
                        this.onAccept?.(this.itemsValue[this.selectedIndexValue], this.selectedIndexValue);
                    }
                    break;
                case "Escape":
                    event.preventDefault();
                    this.onCancel?.();
                    break;
            }
        });
    }

    // ─── Mouse ──────────────────────────────────────────────────────────────

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "mousemove") {
            this.handleMouseMove(event as TUIMouseEvent);
        } else if (event.type === "click") {
            this.handleClick(event as TUIMouseEvent);
        } else {
            super.performDefaultAction(event);
        }
    }

    /** Follow the mouse: hovering a list row moves the selection onto it (VS Code behavior). */
    private handleMouseMove(event: TUIMouseEvent): void {
        const index = this.itemIndexFromLocalY(event.localY);
        if (index === null || index === this.selectedIndexValue) return;
        this.selectedIndexValue = index;
        this.markDirty();
    }

    /** Clicking a list row selects it and accepts it, mirroring Enter. */
    private handleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        const index = this.itemIndexFromLocalY(event.localY);
        if (index === null) return;
        this.selectedIndexValue = index;
        this.markDirty();
        if (this.validationMessage !== null && this.validationSeverity === "error") return;
        this.onAccept?.(this.itemsValue[index], index);
    }

    /**
     * Maps a y offset local to this element onto an item index, or null when it
     * falls outside the visible list rows (border, input, message, separator).
     */
    private itemIndexFromLocalY(localY: number): number | null {
        if (this.effectiveVisibleRows === 0) return null;
        const bodyTop = this.messageRow !== null ? 3 : 2;
        const firstRowY = bodyTop + 1; // border/input/[message]/separator then rows
        const row = localY - firstRowY;
        if (row < 0 || row >= this.effectiveVisibleRows) return null;
        return this.scrollOffset + row;
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    public get items(): readonly QuickPickItem[] {
        return this.itemsValue;
    }

    /** Observable state: current query, item labels and the active index. */
    public override inspectState(): Record<string, unknown> {
        return {
            query: this.getQuery(),
            activeIndex: this.selectedIndexValue,
            title: this.title,
            items: this.itemsValue.map((i) => i.label),
        };
    }

    public set items(value: readonly QuickPickItem[]) {
        this.itemsValue = value;
        this.selectedIndexValue = 0;
        this.scrollOffset = 0;
        this.markDirty();
    }

    /**
     * Replace the items WITHOUT jumping the cursor back to the top.
     *
     * Use this when the list is refreshed for the *same* query (e.g. the file
     * index grew in the background and produced more results) — resetting the
     * selection there would yank the cursor away from the user mid-navigation.
     *
     * The previously selected item is re-located by identity (label +
     * description, which uniquely identifies a file row). If it is gone, the
     * previous index is clamped into the new bounds. The selected row is kept
     * on-screen.
     */
    public refreshItems(value: readonly QuickPickItem[]): void {
        const hadPrevious = this.itemsValue.length > 0;
        const previous = this.itemsValue[this.selectedIndexValue];
        this.itemsValue = value;

        if (value.length === 0) {
            this.selectedIndexValue = 0;
            this.scrollOffset = 0;
            this.markDirty();
            return;
        }

        let next = hadPrevious ? value.findIndex((item) => sameItem(item, previous)) : -1;
        if (next < 0) {
            next = Math.min(this.selectedIndexValue, value.length - 1);
        }
        this.selectedIndexValue = Math.max(0, next);

        // Keep the scroll window valid and the selected row visible.
        const maxScroll = Math.max(0, value.length - this.maxVisibleItems);
        this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
        this.ensureVisible(this.selectedIndexValue);
        this.markDirty();
    }

    public get selectedIndex(): number {
        return this.selectedIndexValue;
    }

    public getQuery(): string {
        return this.inputElement.inputState.value;
    }

    public setQuery(value: string): void {
        this.inputElement.inputState.value = value;
        this.markDirty();
    }

    /** Delegate focus to the inner InputElement. */
    public override focus(): void {
        this.inputElement.focus();
    }

    public setStyles(styles: IQuickPickStyles): void {
        this.styles = styles;
        this.markDirty();
    }

    // ─── Layout ─────────────────────────────────────────────────────────────

    private get visibleItemCount(): number {
        return Math.min(this.itemsValue.length, this.maxVisibleItems);
    }

    /**
     * Сколько строк списка реально помещается в выделенную layout'ом высоту.
     * Разрыв цикличности с {@link totalHeight}: natural-высота считается ДО
     * layout (интринсики, visibleItemCount), фактическое окно — ПОСЛЕ, от
     * layoutSize. На низком терминале (loose от overlay с маленьким остатком)
     * окно меньше natural — рендер, хит-тест и скролл живут по нему.
     */
    private get effectiveVisibleRows(): number {
        if (this.visibleItemCount === 0) return 0;
        // top border + input + [message] + separator + bottom border
        const chrome = 4 + (this.messageRow !== null ? 1 : 0);
        return Math.max(0, Math.min(this.visibleItemCount, this.layoutSize.height - chrome));
    }

    /**
     * The message row shown under the input (InputBox flavor). A validation
     * message wins over the plain prompt; returns null when neither is set.
     */
    private get messageRow(): { text: string; fg: number } | null {
        if (this.validationMessage !== null) {
            const fg =
                this.validationSeverity === "warning"
                    ? this.styles.validationWarningFg
                    : this.validationSeverity === "info"
                      ? this.styles.validationInfoFg
                      : this.styles.validationErrorFg;
            return { text: this.validationMessage, fg };
        }
        if (this.prompt !== undefined) {
            return { text: this.prompt, fg: this.styles.promptFg };
        }
        return null;
    }

    private get totalHeight(): number {
        const listRows = this.visibleItemCount;
        // Extra row for the InputBox prompt / validation message, when present.
        const messageRows = this.messageRow !== null ? 1 : 0;
        if (listRows === 0) {
            // top border + input row + [message row] + bottom border
            return 3 + messageRows;
        }
        // top border + input row + [message row] + separator + list rows + bottom border
        return 4 + messageRows + listRows;
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return 20;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.preferredWidth;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.totalHeight;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.totalHeight;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const natural = new Size(this.getMaxIntrinsicWidth(1), this.getMaxIntrinsicHeight(0));
        const size = constraints.constrain(natural);

        super.performLayout(BoxConstraints.tight(size));

        // Единственная точка ресинка скролла с фактическим окном: высота могла
        // ужаться против natural, и старый scrollOffset/выделение могли выпасть
        // из видимого окна.
        const rows = this.effectiveVisibleRows;
        const maxScroll = Math.max(0, this.itemsValue.length - Math.max(rows, 1));
        this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
        this.ensureVisible(this.selectedIndexValue);

        // Position InputElement inside the top border, padded by 1 on each side.
        const inputWidth = Math.max(0, size.width - 2);
        this.layoutChild(this.inputElement, 1, 1, BoxConstraints.tight(new Size(inputWidth, 1)));

        return size;
    }

    // ─── Children ───────────────────────────────────────────────────────────

    // ─── Render ─────────────────────────────────────────────────────────────

    public override render(context: RenderContext): void {
        const w = this.layoutSize.width;
        // Use natural height when the parent allocates more vertical space than
        // needed (prevents a gap between the last item and the bottom border);
        // when allocated LESS (низкий терминал), рисуем строго в выделенном.
        const h = Math.min(this.totalHeight, this.layoutSize.height);
        if (w < 2 || h < 2) return; // не помещается даже рамка

        const visibleRows = this.effectiveVisibleRows;
        const hasItems = visibleRows > 0;

        // Row after the input (+ message row when present): separator/bottom border.
        const message = this.messageRow;
        const bodyTop = message !== null ? 3 : 2;

        // ── Background fill + frame ───────────────────────────────────────────
        // The separator between the input area and the list is a T-connector row
        // (├───┤); item rows re-draw their own side borders under the row bg.
        const separators = hasItems ? [bodyTop] : undefined;
        context.drawBox(0, 0, w, h, { fg: this.styles.borderFg, bg: this.styles.bg, fill: true, separators });

        // ── Top border title (optional, centered as ┤ title ├) ────────────────
        if (this.title !== undefined && this.title !== "") {
            this.renderTitle(context, w);
        }

        // ── Render InputElement (только если строка не легла на нижнюю рамку) ─
        // Give it an explicit placeholder since we own the visual chrome.
        if (h >= 3) {
            this.inputElement.placeholder = this.placeholder;
            const inputClip = new Rect(this.inputElement.globalPosition, this.inputElement.layoutSize);
            const inputOffset = new Offset(this.inputElement.localPosition.dx, this.inputElement.localPosition.dy);
            this.inputElement.render(context.withOffset(inputOffset).withClip(inputClip));
        }

        // ── Optional message row (InputBox prompt / validation) ───────────────
        if (message !== null && h >= 4) {
            this.renderMessageRow(context, w, 2, message);
        }

        // ── Item rows (frame + separator already drawn by drawBox above) ──────
        if (hasItems) {
            const hasIcons = this.itemsValue.some((item) => item.icon !== undefined);
            for (let i = 0; i < visibleRows; i++) {
                const itemIndex = this.scrollOffset + i;
                this.renderItemRow(context, w, bodyTop + 1 + i, itemIndex, hasIcons);
            }
        }
    }

    /** Draws the title centered into the top border row as ┤ title ├. */
    private renderTitle(context: RenderContext, w: number): void {
        const label = ` ${this.title} `;
        const labelWidth = new DisplayLine(label).displayWidth;
        // Need room for the two caps plus the border corners.
        if (labelWidth + 4 > w) return;
        const startX = Math.max(2, Math.floor((w - labelWidth) / 2));
        context.setCell(startX - 1, 0, { char: "┤", fg: this.styles.borderFg, bg: this.styles.bg });
        context.drawText(startX, 0, label, { fg: this.styles.titleFg, bg: this.styles.bg });
        context.setCell(startX + labelWidth, 0, { char: "├", fg: this.styles.borderFg, bg: this.styles.bg });
    }

    /** Draws the prompt / validation message row under the input. */
    private renderMessageRow(
        context: RenderContext,
        w: number,
        rowY: number,
        message: { text: string; fg: number },
    ): void {
        for (let x = 0; x < w; x++) {
            context.setCell(x, rowY, { char: " ", fg: message.fg, bg: this.styles.bg });
        }
        context.setCell(0, rowY, { char: "│", fg: this.styles.borderFg, bg: this.styles.bg });
        context.setCell(w - 1, rowY, { char: "│", fg: this.styles.borderFg, bg: this.styles.bg });
        const avail = Math.max(0, w - 3);
        const text =
            new DisplayLine(message.text).displayWidth <= avail ? message.text : truncateEnd(message.text, avail);
        context.drawText(2, rowY, text, { fg: message.fg, bg: this.styles.bg }, { maxWidth: avail });
    }

    private renderItemRow(context: RenderContext, w: number, rowY: number, itemIndex: number, hasIcons: boolean): void {
        const item = this.itemsValue[itemIndex];
        const isSelected = itemIndex === this.selectedIndexValue;
        const rowBg = isSelected ? this.styles.activeSelectionBg : this.styles.bg;
        const rowFg = isSelected ? this.styles.activeSelectionFg : this.styles.fg;

        // ── Row background ────────────────────────────────────────────────────
        // Fill only the interior; the border columns keep the box background so
        // the selection highlight never bleeds onto the frame (see issue #94).
        for (let x = 1; x < w - 1; x++) {
            context.setCell(x, rowY, { char: " ", fg: rowFg, bg: rowBg });
        }

        // ── Side borders ──────────────────────────────────────────────────────
        context.setCell(0, rowY, { char: "│", fg: this.styles.borderFg, bg: this.styles.bg });
        context.setCell(w - 1, rowY, { char: "│", fg: this.styles.borderFg, bg: this.styles.bg });

        let x = 2;

        // ── Icon column ───────────────────────────────────────────────────────
        if (hasIcons) {
            const icon = item.icon ?? " ";
            context.setCell(x, rowY, { char: icon, fg: rowFg, bg: rowBg });
            x += 2; // icon char + trailing space
        }

        // ── Layout budget ─────────────────────────────────────────────────────
        // The label (filename) has priority: it is shown in full whenever it
        // fits, and the description (file path) is shrunk to whatever space is
        // left so nothing overflows the picker border. The other metadata
        // fields (badge / shortcut / hint) are short and always shown whole.
        const contentRight = w - 2; // exclusive, inside right border
        const avail = Math.max(0, contentRight - x);

        interface RightPart {
            text: string;
            fg: number;
        }
        const metaBefore: RightPart[] = [];
        const metaAfter: RightPart[] = [];

        if (item.badge !== undefined) {
            metaBefore.push({ text: " ★ " + item.badge, fg: this.styles.badgeFg });
        }
        if (item.shortcut !== undefined) {
            metaAfter.push({
                text: "  " + item.shortcut,
                fg: isSelected ? this.styles.activeSelectionFg : this.styles.shortcutFg,
            });
        }
        if (item.hint !== undefined) {
            metaAfter.push({
                text: "  " + item.hint,
                fg: isSelected ? this.styles.activeSelectionFg : this.styles.hintFg,
            });
        }

        const metaWidth = [...metaBefore, ...metaAfter].reduce(
            (sum, p) => sum + new DisplayLine(p.text).displayWidth,
            0,
        );

        // Space shared between label and description, after fixed metadata.
        const shared = Math.max(0, avail - metaWidth);
        const labelNatural = new DisplayLine(item.label).displayWidth;

        // ── Label (priority) ──────────────────────────────────────────────────
        const labelFits = labelNatural <= shared;
        const labelText = labelFits ? item.label : truncateEnd(item.label, shared);
        const labelDraw = labelFits ? labelNatural : new DisplayLine(labelText).displayWidth;

        // ── Description (fills remaining space, abbreviated if needed) ─────────
        const DESC_SEPARATOR = "  ";
        const descParts: RightPart[] = [];
        const descBudget = labelFits ? shared - labelNatural : 0;
        const dirBudget = descBudget - DESC_SEPARATOR.length;
        if (item.description !== undefined && item.description !== "" && dirBudget >= 1) {
            const dir = item.description;
            const shown = new DisplayLine(dir).displayWidth <= dirBudget ? dir : abbreviatePath(dir, dirBudget);
            descParts.push({
                text: DESC_SEPARATOR + shown,
                fg: isSelected ? this.styles.activeSelectionFg : this.styles.descriptionFg,
            });
        }

        const matchSet = buildMatchSet(item.labelMatchRanges ?? []);
        context.drawText(
            x,
            rowY,
            labelText,
            { fg: rowFg, bg: rowBg },
            {
                maxWidth: labelDraw,
                getStyle: (offset) => {
                    if (matchSet.has(offset)) {
                        return { fg: isSelected ? this.styles.activeSelectionFg : this.styles.matchFg };
                    }
                    return undefined;
                },
            },
        );

        // ── Right parts (right-aligned, guaranteed within the border) ─────────
        const rightParts = [...metaBefore, ...descParts, ...metaAfter];
        const rightTotalWidth = rightParts.reduce((sum, p) => sum + new DisplayLine(p.text).displayWidth, 0);
        let rx = contentRight - rightTotalWidth;
        for (const part of rightParts) {
            const partWidth = new DisplayLine(part.text).displayWidth;
            context.drawText(rx, rowY, part.text, { fg: part.fg, bg: rowBg });
            rx += partWidth;
        }
    }

    // ─── Selection ───────────────────────────────────────────────────────────

    private moveSelection(delta: number): void {
        if (this.itemsValue.length === 0) return;
        const next = Math.max(0, Math.min(this.itemsValue.length - 1, this.selectedIndexValue + delta));
        if (next === this.selectedIndexValue) return;
        this.selectedIndexValue = next;
        this.ensureVisible(next);
        this.markDirty();
        this.onActiveItemChanged?.(this.itemsValue[next], next);
    }

    /**
     * Move the highlight to `index` programmatically (e.g. pre-select the current
     * theme when the picker opens). Clamped into range; keeps the row on-screen.
     * Does NOT fire {@link onActiveItemChanged} — this is not a user navigation.
     */
    public setActiveIndex(index: number): void {
        if (this.itemsValue.length === 0) return;
        const clamped = Math.max(0, Math.min(this.itemsValue.length - 1, index));
        this.selectedIndexValue = clamped;
        this.ensureVisible(clamped);
        this.markDirty();
    }

    private ensureVisible(index: number): void {
        const rows = this.effectiveVisibleRows;
        if (rows <= 0) return;
        if (index < this.scrollOffset) {
            this.scrollOffset = index;
        } else if (index >= this.scrollOffset + rows) {
            this.scrollOffset = index - rows + 1;
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Identity check used to keep the selection stable across `refreshItems`.
 * Items are rebuilt as fresh objects on every refresh, so we compare the
 * fields that uniquely identify a row: `label` + `description` (for file rows
 * that is basename + directory, i.e. the relative path).
 */
function sameItem(a: QuickPickItem, b: QuickPickItem): boolean {
    return a.label === b.label && a.description === b.description;
}

/**
 * Expands [start, end) range pairs into a flat Set of matched byte offsets,
 * for per-character colour lookups in `drawText.getStyle`.
 */
function buildMatchSet(ranges: readonly [number, number][]): Set<number> {
    const set = new Set<number>();
    for (const [start, end] of ranges) {
        for (let i = start; i < end; i++) {
            set.add(i);
        }
    }
    return set;
}
