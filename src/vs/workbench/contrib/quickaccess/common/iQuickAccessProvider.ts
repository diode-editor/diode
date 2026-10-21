import type { QuickPickItem } from "../../../common/quickPickItem.ts";

/** An item without `accept` is informational: accepting it is ignored and the picker stays open. */
export interface QuickAccessItem extends QuickPickItem {
    /** Called after the picker closes. */
    accept?: () => void;
}

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

    onHide?(): void;
}
