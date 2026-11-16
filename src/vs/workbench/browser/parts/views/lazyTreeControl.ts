import type { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
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
    /** A part pinned to the right edge (upstream's source of a console line, its count badge); the row's label wins the room. */
    renderRowEnd?(element: T): readonly IRowSpan[];
    /** Typeahead text; the joined spans when omitted. */
    getLabel?(element: T): string;
}

export interface ILazyTreeOptions {
    /** Prefix of row ids, unique per view: rows are addressed as `<idPrefix>:<key>`. */
    readonly idPrefix: string;
    /** The console mode: a refresh keeps the last row in view if it was in view. */
    readonly stickyTail?: boolean;
}

/** The child row of an expanded node whose children are on their way. */
export const LOADING_LABEL = "Loading...";
const PLACEHOLDER_SUFFIX = "#loading";

function spansText(spans: readonly IRowSpan[]): string {
    return spans.map((span) => span.text).join("");
}

function spansLabel(spans: readonly IRowSpan[]): TextLabelElement {
    const label = new TextLabelElement(spansText(spans));
    let offset = 0;
    for (const span of spans) {
        // UTF-16 units, as the label indexes its chars.
        for (const _unit of span.text.split("")) label.setCharStyle(offset++, span);
    }
    return label;
}

/** The label fills the row, the end keeps its width and a column before it. */
function splitRow(spans: readonly IRowSpan[], end: readonly IRowSpan[]): TUIElement {
    const row = new HFlexElement();
    row.addChild(spansLabel(spans), { width: hflexFill(), height: 1 });
    row.addChild(spansLabel([{ text: " " }, ...end]), { width: hflexFit(), height: 1 });
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

    private roots: readonly T[] = [];
    /** The user's word on a node; a node without one follows {@link ILazyTreeSource.isInitiallyExpanded}. */
    private readonly expansion = new Map<string, boolean>();
    /** Children read for expanded nodes; a missing entry of an expanded node is a load to start. */
    private children = new Map<string, readonly T[]>();
    /** Pending loads of single nodes: a load lands only while it is still the one in this map. */
    private loading = new Map<string, object>();
    /** The data behind the rows on screen; the "Loading..." rows (and no row at all) have none. */
    private readonly items = new Map<TUIElement | null, T>();
    /** Row id → parent row id of every row on screen: a cursor whose row went away falls back to its parent. */
    private parentOf = new Map<string, string | undefined>();
    private refreshToken = {};
    private rebuildScheduled = false;
    private revealTail = false;

    public constructor(
        private readonly source: ILazyTreeSource<T>,
        private readonly options: ILazyTreeOptions,
    ) {
        this.list.onCollapsedChanged = (row, collapsed) => {
            this.onCollapsedChanged(row, collapsed);
        };
        this.list.onActivate = (row) => {
            const item = this.items.get(row);
            if (item !== undefined) this.onActivate(item);
        };
    }

    public get focused(): T | undefined {
        return this.items.get(this.list.getCursorElement());
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

    private rebuild(): void {
        const list = this.list;
        const cursorId = list.getCursorElement()?.id;
        const scrollTop = list.scrollTop;
        const tailVisible = scrollTop + list.layoutSize.height >= list.contentHeight;
        const previousParents = this.parentOf;
        this.parentOf = new Map();
        list.clear();
        this.items.clear();
        const append = (items: readonly T[], parentId: string | undefined): void => {
            for (const item of items) {
                const key = this.source.getKey(item);
                const id = `${this.options.idPrefix}:${key}`;
                const spans = this.source.renderRow(item);
                const end = this.source.renderRowEnd?.(item) ?? [];
                const row = end.length === 0 ? spansLabel(spans) : splitRow(spans, end);
                row.id = id;
                this.items.set(row, item);
                this.parentOf.set(id, parentId);
                const expanded = this.isExpanded(item, key);
                const label = this.source.getLabel?.(item) ?? spansText(spans);
                list.appendRow(row, { label, parentId, collapsed: !expanded });
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
        if (target !== undefined) list.setCursorTo(target);
        // Raw, not scrollTo: the next layout clamps and snaps it against the viewport it actually gets.
        const toTail = this.revealTail || (this.options.stickyTail === true && tailVisible);
        this.revealTail = false;
        list.scrollTop = toTail ? Number.MAX_SAFE_INTEGER : scrollTop;
    }
}
