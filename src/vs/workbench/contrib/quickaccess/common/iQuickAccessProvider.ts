import type { QuickPickItem } from "../../../common/quickPickItem.ts";

/** An item without `accept` is informational: accepting it is ignored and the picker stays open. */
export interface QuickAccessItem extends QuickPickItem {
    /** Called after the picker closes. */
    accept?: () => void;
}

/** `accept`: the picker closes because an item was picked. Anything else (Escape, another prefix, a takeover) is `cancel`. */
export type QuickAccessHideReason = "accept" | "cancel";

/** Counterpart of vscode's `IQuickAccessProvider`. The query arrives whole, with the prefix — the provider strips it itself. */
export interface IQuickAccessProvider {
    /** An expensive query (file search): the picker applies a leading+trailing debounce to input. */
    readonly debounceQuery?: boolean;

    getPlaceholder(): string;

    getItems(query: string): QuickAccessItem[];

    /**
     * `refresh` re-reads the items of the current query — for live sources (the index grows in the
     * background); `preserveSelection` keeps the list cursor.
     */
    onShow?(refresh: (preserveSelection: boolean) => void): void;

    onHide?(reason: QuickAccessHideReason): void;

    /** Where the cursor starts on a fresh list; `undefined` is the first row. Not asked on a `preserveSelection` refresh. */
    getInitialActiveIndex?(items: readonly QuickAccessItem[], query: string): number | undefined;

    /**
     * The seam for live preview, upstream `onDidChangeActive`: fires on user navigation and whenever new items
     * make another row active. `undefined`: the list is empty.
     */
    onActiveItemChanged?(item: QuickAccessItem | undefined): void;
}
