import type { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIContextMenuEvent, TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { HFlexElement, hflexFill, hflexFit } from "@tuidom/elements/layout/hFlexElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { onUnexpectedError } from "../../../../base/common/errors.ts";

/** A piece of a row with its own colors: upstream's `renderVariable` paints `name: value` in several. */
export interface IRowSpan {
    readonly text: string;
    readonly fg?: StyleColor;
    readonly bg?: StyleColor;
    /** Italic for an unavailable value, as upstream's `.unavailable`. */
    readonly style?: StyleFlags;
    /** An inline control (upstream's checkbox of a breakpoint): a click on it does this instead of picking the row. */
    readonly onClick?: () => void;
    /**
     * A link in the text (upstream's `LinkDetector`): a click on its cells does this instead of picking the row. Unlike
     * {@link onClick} it stays in the row's one text, so it wraps with it.
     */
    readonly link?: () => void;
}

/** Upstream's `IAsyncDataSource` with the renderer folded in: what the tree asks of its owner. */
export interface ILazyTreeSource<T> {
    getRoots(): readonly T[] | Promise<readonly T[]>;
    getChildren(element: T): readonly T[] | Promise<readonly T[]>;
    /** Stable identity across reads: the cursor and the expansion follow it. */
    getKey(element: T): string;
    hasChildren(element: T): boolean;
    /** Expanded on first sight unless the user collapsed it (upstream auto-expands the first scope). */
    isInitiallyExpanded?(element: T): boolean;
    renderRow(element: T): readonly IRowSpan[];
    /**
     * A part pinned to the right edge, as upstream's badges: a thread's state, a breakpoint's line, the source of a
     * console line. It keeps its width and a column before it; the row's text is cut first.
     */
    renderRowEnd?(element: T): readonly IRowSpan[];
    /** Typeahead text; the joined spans when omitted. */
    getLabel?(element: T): string;
}

/** Upstream's input box over a row of a debug view (`renderInputBox`): Set Value, a watch expression. */
export interface IRowEdit {
    readonly value: string;
    /** The adapter's answer to the last try, shown after the input in the error color. */
    readonly error?: string;
    /** Enter and leaving the input finish with `success`, Escape without; once per edit. */
    onDone(value: string, success: boolean): void;
}

export interface ILazyTreeOptions {
    /** Prefix of row ids, unique per view: rows are addressed as `<idPrefix>:<key>`. */
    readonly idPrefix: string;
    /** The console mode: a refresh keeps the last row in view if it was in view. */
    readonly stickyTail?: boolean;
    /**
     * Rows wrap to the list's width (rows of `height: "auto"`), read on every rebuild; otherwise a row is one line and
     * its text is cut.
     */
    readonly wrap?: () => boolean;
}

/** The child row of an expanded node whose children are on their way. */
export const LOADING_LABEL = "Loading...";
const PLACEHOLDER_SUFFIX = "#loading";

export function spansText(spans: readonly IRowSpan[]): string {
    return spans.map((span) => span.text).join("");
}

function spansLabel(spans: readonly IRowSpan[]): TextLabelElement {
    const label = new TextLabelElement(spansText(spans));
    let offset = 0;
    for (const span of spans) {
        // UTF-16 units, as the label indexes its chars.
        for (const _unit of span.text.split("")) label.setCharStyle(offset++, span);
    }
    // The link of the piece under the mouse; there is no piece under the cells past the text.
    const linkAt = (event: TUIEventBase): (() => void) | undefined => {
        const { screenX, screenY } = event as TUIMouseEvent;
        let at = label.offsetAt(screenX - label.globalPosition.x, screenY - label.globalPosition.y) ?? Infinity;
        return spans.find((span) => (at -= span.text.length) < 0)?.link;
    };
    label.addEventListener("click", (event) => {
        const open = linkAt(event);
        if (open === undefined) return;
        event.preventDefault();
        open();
    });
    // The pair of a double click on a link must not open the row either.
    label.addEventListener("dblclick", (event) => {
        if (linkAt(event) !== undefined) event.preventDefault();
    });
    return label;
}

/** A span the user clicks: the list hands the click to the row, and the consumed click picks no row. */
function clickableLabel(span: IRowSpan, onClick: () => void): TextLabelElement {
    const label = spansLabel([span]);
    label.addEventListener("click", (event) => {
        event.preventDefault();
        onClick();
    });
    // The pair of a double click must not open the row either.
    label.addEventListener("dblclick", (event) => {
        event.preventDefault();
    });
    return label;
}

/**
 * One label for a plain row; a row with inline controls or a right part is a flex of labels. The right part keeps
 * its width and a column before it, as upstream cuts the text before the badge: the last text run is the flex's
 * fill child, which gets what the controls and the right part leave, is cut when that is too little, and pushes the
 * right part to the edge when there is room.
 */
function buildRow(spans: readonly IRowSpan[], end: readonly IRowSpan[], wrap: boolean): TUIElement {
    // A row with links is a flex too: the list hands a click only to the descendants of the row's element.
    // Stryker disable next-line ConditionalExpression: a row without links as a flex paints the same, as below
    const linked = spans.some((span) => span.link !== undefined);
    // Stryker disable next-line ConditionalExpression,LogicalOperator,ArrowFunction,EqualityOperator,BlockStatement: a row of plain spans as the flex's one fill child paints the same columns; one label is the cheaper element for the hundreds of rows a debug view rebuilds
    if (end.length === 0 && spans.every((span) => span.onClick === undefined) && !linked) {
        const label = spansLabel(spans);
        label.wrap = wrap;
        return label;
    }
    const row = new HFlexElement();
    let run: IRowSpan[] = [];
    for (const span of spans) {
        if (span.onClick === undefined) {
            run.push(span);
            continue;
        }
        // An empty run is an empty label: it takes no columns.
        row.addChild(spansLabel(run), { width: hflexFit(), height: 1 });
        run = [];
        row.addChild(clickableLabel(span, span.onClick), { width: hflexFit(), height: 1 });
    }
    // A wrapped text is as tall as its lines; the controls and the right part stay on its first line.
    const text = spansLabel(run);
    text.wrap = wrap;
    row.addChild(text, { width: hflexFill(), height: wrap ? "fill" : 1 });
    if (end.length > 0) row.addChild(spansLabel([{ text: " " }, ...end]), { width: hflexFit(), height: 1 });
    return row;
}

/** The input of an edited row, the error of the last try after it. */
function editRow(input: InputElement, error: string | undefined): TUIElement {
    const row = new HFlexElement();
    row.addChild(input, { width: hflexFill(), height: 1 });
    if (error !== undefined) {
        row.addChild(spansLabel([{ text: ` ${error}`, fg: "list.errorForeground" }]), { width: hflexFit(), height: 1 });
    }
    return row;
}

/**
 * A lazily loaded tree of colored rows over {@link ListViewElement} — upstream's `AsyncDataTree` for the debug
 * views. The list brings the hierarchy, chevrons, keyboard, typeahead and the `list.*` commands; this control owns
 * the data: which nodes are expanded, the children read so far, and the rebuild that keeps the cursor (by key) and
 * the scroll position. Every change of the data is one {@link ListViewElement.clear} and a fresh set of rows: the
 * debug views hold hundreds of rows, not the thousands the search results stream in.
 */
export class LazyTreeControl<T> {
    public readonly list = new ListViewElement();
    /** The view body: one column of padding on each side and a scrollbar. */
    public readonly element: TUIElement = new PaddingContainerElement(new ScrollBarDecorator(this.list), {
        left: 1,
        right: 1,
    });
    public onActivate: (element: T) => void = () => undefined;
    /** The cursor moved to a row by the user; a rebuild or {@link reveal} moving it says nothing. */
    public onSelect: (element: T) => void = () => undefined;
    /**
     * A right click or Shift+F10 on a row (the click has already put the cursor there); `undefined` for one on no row,
     * as upstream's tree hands over a `null` element (the console's menu opens on its empty space too).
     */
    public onContextMenu: (element: T | undefined, screenX: number, screenY: number) => void = () => undefined;
    /** The rows on screen were built anew: a toggle, a load landing, a refresh (upstream's `onDidChangeContentHeight`). */
    public onDidChangeRows: () => void = () => undefined;
    /** The list has handed the current context menu event to a row. */
    private contextMenuOnRow = false;

    private roots: readonly T[] = [];
    /** The user's word on a node; a node without one follows {@link ILazyTreeSource.isInitiallyExpanded}. */
    private readonly expansion = new Map<string, boolean>();
    /** Children read for expanded nodes; a missing entry of an expanded node is a load to start. */
    private children = new Map<string, readonly T[]>();
    /** Pending loads of single nodes: a load lands only while it is still the one in this map. */
    private loading = new Map<string, object>();
    /** The data behind the rows on screen by row id: a row the list hands over may be one a rebuild has just replaced. */
    private readonly items = new Map<string, T>();
    /** Row id → parent row id of every row on screen: a cursor whose row went away falls back to its parent. */
    private parentOf = new Map<string, string | undefined>();
    private refreshToken = {};
    private rebuildScheduled = false;
    /** The tree itself moves the cursor: not the user's pick. */
    private movingCursor = false;
    private revealTail = false;
    /** The row being edited and its input, kept across rebuilds so the typed text and the focus survive them. */
    private editing: { readonly key: string; readonly edit: IRowEdit; readonly input: InputElement } | undefined;
    // Stryker disable next-line BooleanLiteral: equivalent — rebuild() sets it before any input of an edit can blur
    private rebuilding = false;

    public constructor(
        private readonly source: ILazyTreeSource<T>,
        private readonly options: ILazyTreeOptions,
    ) {
        this.list.onCollapsedChanged = (row, collapsed) => {
            this.onCollapsedChanged(row, collapsed);
        };
        this.list.onActivate = (row) => {
            const item = this.items.get(String(row.id));
            if (item !== undefined) this.onActivate(item);
        };
        this.list.onSelect = (row) => {
            const item = this.items.get(String(row.id));
            if (!this.movingCursor && item !== undefined) this.onSelect(item);
        };
        this.list.onContextMenu = (row, screenX, screenY) => {
            this.contextMenuOnRow = true;
            this.onContextMenu(this.items.get(String(row.id)), screenX, screenY);
        };
        // The list says nothing of a click on no row: its listener runs before the list's own handling, and the
        // microtask after it tells whether a row got the event.
        this.list.addEventListener("contextmenu", (event) => {
            const { screenX, screenY } = event as TUIContextMenuEvent;
            this.contextMenuOnRow = false;
            queueMicrotask(() => {
                if (!this.contextMenuOnRow) this.onContextMenu(undefined, screenX, screenY);
            });
        });
    }

    /**
     * Puts an input over the element's row (upstream's `renderInputBox`) and focuses it: Enter or leaving it ends the
     * edit with its text, Escape without; the list gets the focus back. A rebuild keeps the input with what is typed.
     * `false` when the tree does not show the element (both debug views hear of every selected expression).
     */
    public edit(element: T, edit: IRowEdit): boolean {
        const key = this.source.getKey(element);
        if (!this.parentOf.has(`${this.options.idPrefix}:${key}`)) return false;
        // The open edit gives way without a rebuild of its own: the one below puts its row back.
        const previous = this.editing;
        const input = new InputElement();
        input.inputState.value = edit.value;
        input.inputState.selectAll();
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== "Escape") return;
            // Stryker disable next-line CallExpression: equivalent — the input does nothing of its own with Enter or Escape, and the event goes no further than its row
            event.preventDefault();
            this.finishEdit(event.key === "Enter");
        });
        input.addEventListener("blur", () => {
            // A rebuild takes the row off the list for a moment; that is not the user leaving it.
            if (!this.rebuilding) this.finishEdit(true);
        });
        this.editing = { key, edit, input };
        this.rebuild();
        input.focus();
        previous?.edit.onDone(previous.input.inputState.value, false);
        return true;
    }

    private finishEdit(success: boolean): void {
        const editing = this.editing;
        if (editing === undefined) return;
        this.editing = undefined;
        const hadFocus = editing.input.isFocused;
        this.rebuild();
        if (hadFocus) this.list.focus();
        editing.edit.onDone(editing.input.inputState.value, success);
    }

    public get focused(): T | undefined {
        return this.items.get(String(this.list.getCursorElement()?.id));
    }

    /** The elements of the rows the tree shows (the children of expanded nodes), top to bottom. */
    public get shownItems(): readonly T[] {
        return [...this.items.values()];
    }

    /**
     * Reads the roots and every expanded node anew, then swaps the rows in one go. `revealTail` scrolls to the last row
     * (upstream's `revealLastElement`) even if a later refresh overtakes this one.
     */
    public async refresh(options: { readonly revealTail?: boolean } = {}): Promise<void> {
        if (options.revealTail === true) this.revealTail = true;
        const token = {};
        this.refreshToken = token;
        const children = new Map<string, readonly T[]>();
        const visit = async (items: readonly T[]): Promise<void> => {
            // Only the open nodes: a console holds thousands of rows without children.
            const open = items.filter(
                (item) => this.source.hasChildren(item) && this.isExpanded(item, this.source.getKey(item)),
            );
            await Promise.all(
                open.map(async (item) => {
                    const key = this.source.getKey(item);
                    const read = await this.source.getChildren(item);
                    children.set(key, read);
                    await visit(read);
                }),
            );
        };
        const roots = await this.source.getRoots();
        await visit(roots);
        if (this.refreshToken !== token) return;
        this.roots = roots;
        this.children = children;
        this.loading = new Map();
        this.rebuild();
    }

    /** Upstream's `expand` of a node whose children appeared later (a lazy variable once evaluated): reads them now. */
    public expand(element: T): void {
        const key = this.source.getKey(element);
        // Another tree's node (both debug views hear of every lazy variable).
        if (![...this.items.values()].some((item) => this.source.getKey(item) === key)) return;
        this.expansion.set(key, true);
        this.children.delete(key);
        this.loading.delete(key);
        this.rebuild();
    }

    /** Paints the rows again from the data already read: for what changes the look, not the data. */
    public rerender(): void {
        this.rebuild();
    }

    /** Puts the cursor on the row of the element (upstream's `setSelection` and `reveal`), if the tree shows it. */
    public reveal(element: T): void {
        const id = `${this.options.idPrefix}:${this.source.getKey(element)}`;
        if (this.parentOf.has(id)) this.moveCursor(id);
    }

    public collapseAll(): void {
        for (const item of this.items.values()) this.expansion.set(this.source.getKey(item), false);
        this.rebuild();
    }

    private isExpanded(item: T, key: string): boolean {
        return this.expansion.get(key) ?? this.source.isInitiallyExpanded?.(item) === true;
    }

    private onCollapsedChanged(row: TUIElement, collapsed: boolean): void {
        // Only the user toggles: the rebuild appends collapsed rows as such. The row id carries the key.
        const key = String(row.id).slice(this.options.idPrefix.length + 1);
        this.expansion.set(key, !collapsed);
        // Reopening reads the children anew: what the node held when it was collapsed may be gone.
        this.children.delete(key);
        this.loading.delete(key);
        // The list is in the middle of its own key or click handling: rebuild once it is done.
        this.scheduleRebuild();
    }

    /** One rebuild for everything that changed in this task: a toggle, loads landing together. */
    private scheduleRebuild(): void {
        if (this.rebuildScheduled) return;
        this.rebuildScheduled = true;
        queueMicrotask(() => {
            this.rebuildScheduled = false;
            try {
                this.rebuild();
            } catch (error) {
                onUnexpectedError(error);
            }
        });
    }

    private load(item: T, key: string): void {
        const token = {};
        this.loading.set(key, token);
        const land = (read: readonly T[]): void => {
            if (this.loading.get(key) !== token) return;
            this.children.set(key, read);
            this.scheduleRebuild();
        };
        Promise.resolve()
            .then(() => this.source.getChildren(item))
            .then(land, (error: unknown) => {
                land([]);
                onUnexpectedError(error);
            });
    }

    private moveCursor(id: string): void {
        this.movingCursor = true;
        try {
            this.list.setCursorTo(id);
        } finally {
            this.movingCursor = false;
        }
    }

    private rebuild(): void {
        const input = this.editing?.input;
        const editingFocused = input?.isFocused === true;
        this.rebuilding = true;
        try {
            this.rebuildRows();
        } finally {
            this.rebuilding = false;
        }
        // The edited row came back: its input gets the focus it had.
        if (editingFocused) input.focus();
    }

    private rebuildRows(): void {
        const list = this.list;
        const cursorId = list.getCursorElement()?.id;
        const scrollTop = list.scrollTop;
        const tailVisible = scrollTop + list.layoutSize.height >= list.contentHeight;
        const previousParents = this.parentOf;
        this.parentOf = new Map();
        list.clear();
        this.items.clear();
        const wrap = this.options.wrap?.() === true;
        const append = (items: readonly T[], parentId: string | undefined): void => {
            for (const item of items) {
                const key = this.source.getKey(item);
                const id = `${this.options.idPrefix}:${key}`;
                const spans = this.source.renderRow(item);
                const editing = this.editing?.key === key ? this.editing : undefined;
                const row =
                    editing === undefined
                        ? buildRow(spans, this.source.renderRowEnd?.(item) ?? [], wrap)
                        : editRow(editing.input, editing.edit.error);
                row.id = id;
                this.items.set(id, item);
                this.parentOf.set(id, parentId);
                const expanded = this.isExpanded(item, key);
                const label = this.source.getLabel?.(item) ?? spansText(spans);
                list.appendRow(row, { label, parentId, collapsed: !expanded, height: wrap ? "auto" : 1 });
                if (!this.source.hasChildren(item)) continue;
                const read = expanded ? this.children.get(key) : undefined;
                if (read !== undefined) {
                    append(read, id);
                    continue;
                }
                // Unknown children: the placeholder gives a collapsed node its chevron and an expanded one its
                // visible "Loading..." until the read lands.
                const placeholder = new TextLabelElement(LOADING_LABEL);
                placeholder.style = { fg: "descriptionForeground" };
                placeholder.id = id + PLACEHOLDER_SUFFIX;
                this.parentOf.set(placeholder.id, id);
                list.appendRow(placeholder, { parentId: id });
                if (expanded && !this.loading.has(key)) this.load(item, key);
            }
        };
        append(this.roots, undefined);
        let target = cursorId;
        while (target !== undefined && !this.parentOf.has(target)) target = previousParents.get(target);
        if (target !== undefined) this.moveCursor(target);
        // Raw, not scrollTo: the next layout clamps and snaps it against the viewport it actually gets.
        const toTail = this.revealTail || (this.options.stickyTail === true && tailVisible);
        this.revealTail = false;
        list.scrollTop = toTail ? Number.MAX_SAFE_INTEGER : scrollTop;
        this.onDidChangeRows();
    }
}
