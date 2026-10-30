import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { truncateEnd } from "@tuidom/core/common/textTruncation";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { INHERITED_BG, INHERITED_FG } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { QuickPickAcceptMode, QuickPickItem, ValidationSeverity } from "../../../common/quickPickItem.ts";

import { CONTENT_PAD, QuickPickFrameElement } from "./quickPickFrameElement.ts";
import { buildItemRow, rowId } from "./quickPickRows.ts";

/** ASCII rather than `•`/`●`: dots have ambiguous terminal width (East Asian Ambiguous). */
export const MASK_CHAR = "*";

/**
 * Composite: {@link QuickPickFrameElement} draws the chrome, `InputElement` the query, `ListViewElement`
 * the results. It doesn't filter: `items` arrive already filtered, with `labelMatchRanges`. Lives in Diode,
 * not `@tuidom/elements`, because its API is in editor terms and the engine only holds general-purpose widgets.
 */
export class QuickPickElement extends TUIElement {
    public placeholder = "Type to search…";
    public maxVisibleItems = 10;

    /**
     * Passed to the frame immediately, not during layout: marking dirty mid-layout lands in the next frame,
     * so a title changed on the fly would lag one frame behind.
     */
    public get title(): string | undefined {
        return this.frame.title;
    }
    public set title(value: string | undefined) {
        this.frame.setTitle(value);
    }
    /** Overridden by {@link validationMessage}. */
    public prompt: string | undefined = undefined;
    /** Blocks Enter when severity is "error". */
    public validationMessage: string | null = null;
    public validationSeverity: ValidationSeverity = "error";
    /** `"item"`: onAccept only on a non-empty list; `"value"`: always onAcceptValue(getQuery()). */
    public acceptMode: QuickPickAcceptMode = "item";
    /** Enter accepts the checked set; the active row alone doesn't count as picked. */
    public canPickMany = false;
    /** The mask is presentation only: getQuery and validation see the real text, inspectState the mask. */
    public password = false;
    public onAcceptValue: ((value: string) => void) | null = null;
    public preferredWidth = 60;

    public onQueryChange: ((query: string) => void) | null = null;
    public onAccept: ((item: QuickPickItem, index: number) => void) | null = null;
    /** Fires for an empty checked set and for an empty list too. */
    public onAcceptMany: (() => void) | null = null;
    /** Enter on an empty list in "item" mode: upstream `QuickPick.onDidAccept` fires even with nothing picked. */
    public onAcceptEmpty: (() => void) | null = null;
    /** Only on user action (`Space`, click). */
    public onCheckedChange: (() => void) | null = null;
    public onCancel: (() => void) | null = null;
    /**
     * Only on user navigation (arrows, PageUp/Down), for live preview; doesn't fire on
     * `items =`, {@link refreshItems} or {@link setActiveIndex}.
     */
    public onActiveItemChanged: ((item: QuickPickItem, index: number) => void) | null = null;

    public readonly inputElement: InputElement;

    private readonly frame: QuickPickFrameElement;
    private readonly body: VFlexElement;
    private readonly inputRow: PaddingContainerElement;
    private readonly messageLabel: TextLabelElement;
    private readonly messageRow: PaddingContainerElement;
    /** Doesn't paint a background, so the frame's separator line shows through. */
    private readonly separatorRow: TUIElement;
    private readonly list: ListViewElement;

    private itemsValue: readonly QuickPickItem[] = [];
    /** By identity, not index: checks must survive a filter change. */
    private readonly checkedValue = new Set<QuickPickItem>();
    private selectedIndexValue = 0;
    /** -1 while no rows are built. */
    private rowsWidth = -1;
    private structureKey = "";
    /** The list passes the element to onSelect, not its index. */
    private rowElements: TUIElement[] = [];
    private suppressActiveNotification = false;

    public constructor() {
        super();
        this.focusable = true;
        this.style = { fg: "quickInput.foreground", bg: "quickInput.background" };

        this.inputElement = new InputElement();
        this.inputElement.showBorder = false;
        // The query line is part of the picker: it inherits the picker's colors, not input.*.
        this.inputElement.style = { fg: INHERITED_FG, bg: INHERITED_BG };
        this.inputElement.onChange = (value) => {
            this.onQueryChange?.(value);
        };
        this.inputRow = new PaddingContainerElement(this.inputElement, { left: CONTENT_PAD, right: CONTENT_PAD });

        this.messageLabel = new TextLabelElement("");
        this.messageRow = new PaddingContainerElement(this.messageLabel, { left: CONTENT_PAD, right: CONTENT_PAD });

        this.separatorRow = new TUIElement();

        this.list = new ListViewElement({ typeahead: false });
        // Focus stays in the query line: the list must not take it, and typeahead
        // would steal the query's own keystrokes to move the cursor.
        this.list.focusable = false;
        this.list.onSelect = (element) => {
            this.selectedIndexValue = this.rowElements.indexOf(element);
            this.notifyActive();
        };

        this.inputRow.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.messageRow.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.separatorRow.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.list.layoutStyle = { height: vflexFill(), width: "fill" };

        this.body = new VFlexElement();
        this.frame = new QuickPickFrameElement(this.body);
        this.appendChild(this.frame);

        this.syncStructure();
        this.addEventListener("keydown", (event) => {
            this.handleKeyDown(event.key, event);
        });
        this.addEventListener("mousemove", (event) => {
            this.handleMouseMove(event);
        });
        this.addEventListener("click", (event) => {
            this.handleClick(event);
        });
    }

    public get items(): readonly QuickPickItem[] {
        return this.itemsValue;
    }

    public set items(value: readonly QuickPickItem[]) {
        this.itemsValue = value;
        this.selectedIndexValue = 0;
        this.rebuildRows();
        this.moveCursorTo(0, { notify: false });
        this.list.scrollTop = 0;
        this.syncStructure();
    }

    /**
     * For the same query, without jumping the cursor to the top: the previous item is looked up by
     * label + description; if it's gone, the previous index is clamped.
     */
    public refreshItems(value: readonly QuickPickItem[]): void {
        if (this.selectedIndexValue < 0) {
            this.itemsValue = value;
            this.rebuildRows();
            this.clearCursorIfNoActive();
            // Stryker disable next-line CallExpression: rebuilding rows marks the list dirty, and `performLayout` starts with the same `syncStructure`, so the structure catches up before the frame
            this.syncStructure();
            return;
        }
        const hadPrevious = this.itemsValue.length > 0;
        const previous = this.itemsValue[this.selectedIndexValue];
        this.itemsValue = value;

        if (value.length === 0) {
            this.selectedIndexValue = 0;
            this.rebuildRows();
            this.syncStructure();
            return;
        }

        let next = hadPrevious ? value.findIndex((item) => sameItem(item, previous)) : -1;
        if (next < 0) next = Math.min(this.selectedIndexValue, value.length - 1);
        this.selectedIndexValue = Math.max(0, next);

        this.rebuildRows();
        this.moveCursorTo(this.selectedIndexValue, { notify: false });
        this.syncStructure();
    }

    /** `-1` when no row is active ({@link clearActive}). */
    public get selectedIndex(): number {
        return this.selectedIndexValue;
    }

    /** Upstream's `activeItems = []` state: Enter accepts the typed text ({@link onAcceptEmpty}). */
    public clearActive(): void {
        this.selectedIndexValue = -1;
        this.clearCursorIfNoActive();
    }

    /** In check order; sorting by list order is up to whoever supplied the list. */
    public get checkedItems(): ReadonlySet<QuickPickItem> {
        return this.checkedValue;
    }

    /**
     * Mandatory first step of every show: the widget is shared, and without a reset the previous show's
     * checkboxes and mask stuck around (Enter in the command palette went to onAcceptMany).
     */
    public resetFlavorState(): void {
        this.canPickMany = false;
        this.checkedValue.clear();
        this.onAcceptMany = null;
        this.onAcceptEmpty = null;
        this.onCheckedChange = null;
        this.password = false;
    }

    public setCheckedItems(items: Iterable<QuickPickItem>): void {
        this.checkedValue.clear();
        for (const item of items) this.checkedValue.add(item);
        this.rebuildKeepingView();
    }

    /** Doesn't fire {@link onActiveItemChanged}: this isn't user navigation. */
    public setActiveIndex(index: number): void {
        if (this.itemsValue.length === 0) return;
        const clamped = Math.max(0, Math.min(this.itemsValue.length - 1, index));
        this.selectedIndexValue = clamped;
        this.moveCursorTo(clamped, { notify: false });
    }

    /** Like the arrows: clamped at the list edges, fires {@link onActiveItemChanged}. */
    public moveActive(delta: number): void {
        this.moveSelection(delta);
    }

    public getQuery(): string {
        return this.inputElement.inputState.value;
    }

    /** `[start, end)` in graphemes; the cursor goes to `end`. Typing next replaces the selection. */
    public setQuerySelection(start: number, end: number): void {
        const state = this.inputElement.inputState;
        const length = new DisplayLine(state.value).slots.length;
        const to = Math.max(0, Math.min(length, end));
        const from = Math.max(0, Math.min(to, start));
        state.moveCursorToStart();
        for (let i = 0; i < from; i++) state.moveCursorRight();
        for (let i = from; i < to; i++) state.selectRight();
        // Stryker disable next-line CallExpression: without marking dirty, layout won't rerun and the selection is drawn only on the next frame — observable only in the live app (TestApp lays out every frame unconditionally); the gate is the quick-input e2e scenario (frame file-dialog-typed)
        this.markDirty();
    }

    public setQuery(value: string): void {
        this.inputElement.inputState.value = value;
        this.markDirty();
    }

    public override focus(): void {
        this.inputElement.focus();
    }

    /**
     * The query is reported as displayed — masked, so the secret never reaches the inspector or e2e snapshots.
     * Checked rows are reported too: otherwise checks are visible nowhere but in the frame.
     */
    public override inspectState(): Record<string, unknown> {
        return {
            query: this.visibleQuery,
            activeIndex: this.selectedIndexValue,
            title: this.title,
            items: this.itemsValue.map((item) => item.label),
            ...(this.canPickMany
                ? { checked: this.itemsValue.filter((item) => this.checkedValue.has(item)).map((item) => item.label) }
                : {}),
        };
    }

    /** One {@link MASK_CHAR} per grapheme cluster, matching how `InputElement` counts. */
    private get visibleQuery(): string {
        const query = this.getQuery();
        if (!this.password) return query;
        return MASK_CHAR.repeat(new DisplayLine(query).slots.length);
    }

    private get message(): { text: string; fg: string } | null {
        if (this.validationMessage !== null) {
            const fg =
                this.validationSeverity === "warning"
                    ? "editorWarning.foreground"
                    : this.validationSeverity === "info"
                      ? "editorInfo.foreground"
                      : "editorError.foreground";
            return { text: this.validationMessage, fg };
        }
        if (this.prompt !== undefined) {
            return { text: this.prompt, fg: "quickPick.promptForeground" };
        }
        return null;
    }

    private get visibleItemCount(): number {
        return Math.min(this.itemsValue.length, this.maxVisibleItems);
    }

    private get headerRows(): number {
        return 1 + (this.message !== null ? 1 : 0);
    }

    private get totalHeight(): number {
        const listRows = this.visibleItemCount;
        const chrome = BORDER_THICKNESS + this.headerRows;
        // Top border + header + [separator + rows] + bottom border.
        if (listRows === 0) return chrome + BORDER_THICKNESS;
        return chrome + 1 + listRows + BORDER_THICKNESS;
    }

    private syncStructure(): void {
        // Services set these fields, but the query line renders them, so copy them on every sync.
        this.inputElement.placeholder = this.placeholder;
        this.inputElement.maskChar = this.password ? MASK_CHAR : undefined;
        const message = this.message;
        const hasItems = this.visibleItemCount > 0;

        // Services set fields without setters, and syncStructure runs on every layout,
        // so the children are rebuilt only when the structure actually changed.
        const key = `${message === null ? "-" : message.fg}|${hasItems ? "list" : "-"}`;
        if (key !== this.structureKey) {
            this.structureKey = key;
            const children: TUIElement[] = [this.inputRow];
            if (message !== null) {
                this.messageLabel.style = { fg: message.fg };
                children.push(this.messageRow);
            }
            if (hasItems) {
                children.push(this.separatorRow);
                children.push(this.list);
            }
            this.body.replaceChildren(children);
            this.markDirty();
        }

        this.frame.setSeparatorRow(hasItems ? BORDER_THICKNESS + this.headerRows : null);
    }

    private rebuildRows(): void {
        const innerWidth = Math.max(0, this.preferredWidth - BORDER_THICKNESS * 2);
        this.rowsWidth = innerWidth;
        this.list.clear();
        this.rowElements = [];
        const hasIcons = this.itemsValue.some((item) => item.icon !== undefined);
        for (const [index, item] of this.itemsValue.entries()) {
            const row = buildItemRow(item, index, innerWidth, {
                hasIcons,
                ...(this.canPickMany ? { checked: this.checkedValue.has(item) } : {}),
            });
            this.rowElements.push(row);
            this.list.appendRow(row);
        }
    }

    /** Rows are immutable: without restoring scroll and cursor, a long list would jump on every `Space`. */
    private rebuildKeepingView(): void {
        const keepIndex = this.selectedIndexValue;
        const keepScroll = this.list.scrollTop;
        this.rebuildRows();
        this.list.scrollTop = keepScroll;
        this.clearCursorIfNoActive();
        // Stryker disable next-line ObjectLiteral: a missing `notify` reads as `!undefined`, i.e. exactly like `notify: false`
        this.moveCursorTo(keepIndex, { notify: false });
    }

    private moveCursorTo(index: number, opts: { notify: boolean }): void {
        if (index < 0 || index >= this.itemsValue.length) return;
        this.suppressActiveNotification = !opts.notify;
        try {
            this.list.setCursorTo(rowId(index));
        } finally {
            this.suppressActiveNotification = false;
        }
    }

    /** Rebuilding rows restores the list cursor, so a cleared active row has to be cleared again. */
    private clearCursorIfNoActive(): void {
        if (this.selectedIndexValue < 0) this.list.clearCursor();
    }

    private notifyActive(): void {
        if (this.suppressActiveNotification) return;
        this.onActiveItemChanged?.(this.itemsValue[this.selectedIndexValue], this.selectedIndexValue);
    }

    private handleKeyDown(key: string, event: { preventDefault(): void }): void {
        switch (key) {
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
                this.moveSelection(Math.max(1, this.visibleItemCount));
                break;
            case "PageUp":
                event.preventDefault();
                this.moveSelection(-Math.max(1, this.visibleItemCount));
                break;
            case " ":
                // Outside multi-select, Space is a query character: no preventDefault.
                if (this.canPickMany) {
                    event.preventDefault();
                    this.toggleChecked();
                }
                break;
            case "Enter":
                event.preventDefault();
                this.accept();
                break;
            case "Escape":
                event.preventDefault();
                this.onCancel?.();
                break;
        }
    }

    private moveSelection(delta: number): void {
        if (this.itemsValue.length === 0) return;
        // With no active row, arrows land on the list edge instead of stepping from -1.
        // Stryker disable next-line EqualityOperator: `delta` is never zero — arrows and pages step by at least 1
        const from = this.selectedIndexValue < 0 ? (delta > 0 ? -1 : this.itemsValue.length) : this.selectedIndexValue;
        const next = Math.max(0, Math.min(this.itemsValue.length - 1, from + delta));
        if (next === this.selectedIndexValue) return;
        this.moveCursorTo(next, { notify: true });
    }

    private toggleChecked(): void {
        if (this.selectedIndexValue < 0) return;
        const item = this.itemsValue.at(this.selectedIndexValue);
        if (item === undefined) return;
        if (!this.checkedValue.delete(item)) this.checkedValue.add(item);
        this.rebuildKeepingView();
        this.onCheckedChange?.();
    }

    private accept(): void {
        if (this.acceptMode === "value") {
            // The owner validates the accepted text itself: the message on screen may be the previous text's.
            this.onAcceptValue?.(this.getQuery());
            return;
        }
        if (this.validationMessage !== null && this.validationSeverity === "error") return;
        if (this.canPickMany) {
            // An empty checked set is an empty answer, not a cancel and not the row under the cursor.
            // Stryker disable next-line OptionalChaining: the show's owner sets the callback before opening; multi-select without onAcceptMany never happens in the app, the check is a safeguard
            this.onAcceptMany?.();
            return;
        }
        if (this.selectedIndexValue >= 0 && this.itemsValue.length > 0) {
            this.onAccept?.(this.itemsValue[this.selectedIndexValue], this.selectedIndexValue);
            return;
        }
        this.onAcceptEmpty?.();
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        const index = this.itemIndexFromEvent(event);
        if (index === null || index === this.selectedIndexValue) return;
        // Silently: hover isn't navigation and must not trigger the live preview.
        this.moveCursorTo(index, { notify: false });
    }

    /** In multi-select a click toggles the check: otherwise the first click would close the picker. */
    private handleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        const index = this.itemIndexFromEvent(event);
        if (index === null) return;
        event.preventDefault();
        this.moveCursorTo(index, { notify: false });
        if (this.canPickMany) {
            this.toggleChecked();
            return;
        }
        this.accept();
    }

    /** Takes geometry from the list itself instead of recomputing the header height by hand. */
    private itemIndexFromEvent(event: TUIMouseEvent): number | null {
        if (this.visibleItemCount === 0) return null;
        const row = event.screenY - this.list.globalPosition.y;
        // The list viewport is exactly as tall as the visible rows, so a hit inside it is
        // already a valid index — no second bounds check needed.
        if (row < 0 || row >= this.list.layoutSize.height) return null;
        return this.list.scrollTop + row;
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
        this.syncStructure();
        const natural = new Size(this.getMaxIntrinsicWidth(1), this.getMaxIntrinsicHeight(0));
        const size = constraints.constrain(natural);

        // Resize: label and description budgets were computed for the old width, so rebuild BEFORE laying out children.
        const innerWidth = Math.max(0, size.width - BORDER_THICKNESS * 2);
        if (this.itemsValue.length > 0 && innerWidth !== this.rowsWidth) {
            const keep = this.selectedIndexValue;
            this.rebuildRows();
            this.moveCursorTo(keep, { notify: false });
            this.clearCursorIfNoActive();
        }

        super.performLayout(BoxConstraints.tight(size));

        // Truncate the text rather than clip it: the trailing ellipsis must be visible.
        // `setText` only on change: it marks the tree dirty and we're inside layout —
        // an overlay with a `prompt` stayed layout-dirty and froze on its first frame.
        const message = this.message;
        if (message !== null) {
            const avail = Math.max(0, size.width - BORDER_THICKNESS * 2 - CONTENT_PAD * 2);
            const text = truncateEnd(message.text, avail);
            // Stryker disable next-line ConditionalExpression: the comparison is the fix — without it the tree stays dirty after every frame and the overlay freezes; observable only in a live frame, the gate is the `quick-input` demo scenario (e2e)
            if (this.messageLabel.getText() !== text) this.messageLabel.setText(text);
        }

        this.layoutChild(this.frame, 0, 0, BoxConstraints.tight(size));
        return size;
    }
}

/** Items are recreated on every refresh, so compare fields, not references. */
function sameItem(a: QuickPickItem, b: QuickPickItem): boolean {
    return a.label === b.label && a.description === b.description;
}
