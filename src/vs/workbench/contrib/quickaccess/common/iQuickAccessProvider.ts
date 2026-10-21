import type { QuickPickItem } from "../../../common/quickPickItem.ts";

/** Пункт без `accept` — информационный: принятие игнорируется, пикер остаётся открытым. */
export interface QuickAccessItem extends QuickPickItem {
    /** Вызывается после закрытия пикера. */
    accept?: () => void;
}

/** Аналог `IQuickAccessProvider` vscode. Запрос приходит целиком, с префиксом — провайдер срезает его сам. */
export interface IQuickAccessProvider {
    /** Дорогой запрос (файловый поиск): показ применяет к вводу leading+trailing debounce. */
    readonly debounceQuery?: boolean;

    getPlaceholder(): string;

    getItems(query: string): QuickAccessItem[];

    /**
     * `refresh` перечитывает пункты текущего запроса — для живых источников (индекс растёт в фоне);
     * `preserveSelection` не сбрасывает курсор списка.
     */
    onShow?(refresh: (preserveSelection: boolean) => void): void;

    onHide?(): void;
}
