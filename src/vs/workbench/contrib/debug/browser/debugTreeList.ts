import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { onUnexpectedError } from "../../../../base/common/errors.ts";

/**
 * SPIKE: a lazily loaded tree over {@link ListViewElement} — upstream's `AsyncDataTree` with rich rows. The data
 * tree of tuidom draws one color per label, but `name: value` needs several; the list takes any element as a row
 * and already knows the hierarchy, the chevrons and the keyboard. Children load on the first expansion: until
 * they come, the row's placeholder child reads "Loading...".
 */
export interface IDebugTreeSource<T> {
    getRoots(): readonly T[] | Promise<readonly T[]>;
    getChildren(element: T): readonly T[] | Promise<readonly T[]>;
    key(element: T): string;
    hasChildren(element: T): boolean;
    /** Starts collapsed unless the user expanded it: upstream auto-expands the first scope. */
    initiallyExpanded?(element: T): boolean;
    render(element: T): TUIElement;
    /** Typeahead text. */
    label?(element: T): string;
}

const PLACEHOLDER_SUFFIX = "#placeholder";

export class DebugTreeList<T> {
    public readonly list: ListViewElement;
    private readonly expanded = new Set<string>();
    private readonly collapsedByUser = new Set<string>();
    private readonly byRowId = new Map<string, T>();
    private generation = 0;
    private rebuilding = false;
    /** The list follows its tail (the REPL): a refresh keeps the last row in view while it was in view. */
    public stickToBottom = false;

    public onActivate: ((element: T) => void) | null = null;
    public onSelect: ((element: T) => void) | null = null;

    public constructor(
        private readonly idPrefix: string,
        private readonly source: IDebugTreeSource<T>,
    ) {
        this.list = new ListViewElement({ indentSize: 2 });
        this.list.onCollapsedChanged = (element, collapsed) => {
            if (this.rebuilding) return;
            const item = this.byRowId.get(element.id ?? "");
            if (item === undefined) return;
            const key = source.key(item);
            if (collapsed) {
                this.expanded.delete(key);
                this.collapsedByUser.add(key);
                return;
            }
            this.expanded.add(key);
            this.collapsedByUser.delete(key);
            // The row holds only its placeholder until the next read.
            void this.refresh().catch(onUnexpectedError);
        };
        this.list.onActivate = (element) => {
            const item = this.byRowId.get(element.id ?? "");
            if (item !== undefined) this.onActivate?.(item);
        };
        this.list.onSelect = (element) => {
            const item = this.byRowId.get(element.id ?? "");
            if (item !== undefined) this.onSelect?.(item);
        };
    }

    public get selected(): T | undefined {
        const element = this.list.getCursorElement();
        return element === null ? undefined : this.byRowId.get(element.id ?? "");
    }

    public collapseAll(): void {
        for (const key of this.expanded) this.collapsedByUser.add(key);
        this.expanded.clear();
        void this.refresh().catch(onUnexpectedError);
    }

    /** Reads the roots and every expanded node anew, then swaps the rows in one go: no flicker of half a tree. */
    public async refresh(): Promise<void> {
        const generation = ++this.generation;
        const rows: { element: T; parentId: string | undefined; expand: boolean }[] = [];
        const visit = async (items: readonly T[], parentId: string | undefined): Promise<void> => {
            for (const item of items) {
                const key = this.source.key(item);
                const hasChildren = this.source.hasChildren(item);
                if (hasChildren && !this.collapsedByUser.has(key) && this.source.initiallyExpanded?.(item) === true) {
                    this.expanded.add(key);
                }
                const expand = hasChildren && this.expanded.has(key);
                rows.push({ element: item, parentId, expand });
                if (!expand) continue;
                const children = await this.source.getChildren(item);
                if (generation !== this.generation) return;
                await visit(children, this.rowId(item));
            }
        };
        await visit(await this.source.getRoots(), undefined);
        if (generation !== this.generation) return;
        this.apply(rows);
    }

    private apply(rows: readonly { element: T; parentId: string | undefined; expand: boolean }[]): void {
        const list = this.list;
        const cursorId = list.getCursorElement()?.id;
        const atBottom = list.scrollTop + list.layoutSize.height >= list.contentHeight - 1;
        const scrollTop = list.scrollTop;
        this.rebuilding = true;
        try {
            list.clear();
            this.byRowId.clear();
            const collapsedIds: string[] = [];
            for (const row of rows) {
                const element = this.source.render(row.element);
                element.id = this.rowId(row.element);
                this.byRowId.set(element.id, row.element);
                const label = this.source.label?.(row.element);
                list.appendRow(element, { parentId: row.parentId, ...(label === undefined ? {} : { label }) });
                if (this.source.hasChildren(row.element) && !row.expand) {
                    // A collapsed node with unknown children: a placeholder child gives it the chevron.
                    const placeholder = new TextLabelElement("Loading...");
                    placeholder.style = { fg: "descriptionForeground" };
                    placeholder.id = element.id + PLACEHOLDER_SUFFIX;
                    list.appendRow(placeholder, { parentId: element.id });
                    collapsedIds.push(element.id);
                }
            }
            for (const id of collapsedIds) list.setCollapsed(id, true);
        } finally {
            this.rebuilding = false;
        }
        if (cursorId !== undefined && this.byRowId.has(cursorId)) {
            list.setCursorTo(cursorId);
        }
        if (this.stickToBottom && atBottom) {
            list.scrollTo(0, list.contentHeight);
        } else {
            list.scrollTo(0, scrollTop);
        }
        list.markDirty();
    }

    private rowId(element: T): string {
        return `${this.idPrefix}:${this.source.key(element)}`;
    }
}
