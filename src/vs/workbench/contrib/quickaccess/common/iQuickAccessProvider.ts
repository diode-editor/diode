import type { QuickPickItem } from "../../../common/quickPickItem.ts";

/**
 * Пункт quick-access-списка: `QuickPickItem` плюс поведение принятия. Пункт без
 * `accept` — информационный (хинт «type a line number…»): его принятие
 * игнорируется, пикер остаётся открытым.
 */
export interface QuickAccessItem extends QuickPickItem {
    /** Выполняется при принятии пункта, после закрытия пикера. */
    accept?: () => void;
}

/**
 * Провайдер Quick Open (аналог `IQuickAccessProvider` vscode,
 * `vs/platform/quickinput/common/quickAccess.ts`): отдаёт пункты и плейсхолдер
 * для запросов своего префикса. Запрос приходит целиком, с префиксом —
 * провайдер сам его срезает (он же объявляет префикс статикой `PREFIX`,
 * как у vscode-провайдеров).
 */
export interface IQuickAccessProvider {
    /**
     * Запросы этого провайдера дорогие (файловый поиск): показ применяет
     * к вводу leading+trailing debounce вместо синхронного обновления.
     */
    readonly debounceQuery?: boolean;

    /** Плейсхолдер инпута, пока активен этот провайдер. */
    getPlaceholder(): string;

    /** Пункты для запроса (запрос — целиком, включая префикс провайдера). */
    getItems(query: string): QuickAccessItem[];

    /**
     * Провайдер стал активным (показ открылся с его префиксом или запрос
     * переключился на него). `refresh` перечитывает пункты текущего запроса —
     * для живых источников (файловый индекс растёт в фоне);
     * `preserveSelection` не сбрасывает курсор списка.
     */
    onShow?(refresh: (preserveSelection: boolean) => void): void;

    /** Провайдер перестал быть активным (смена префикса или закрытие показа). */
    onHide?(): void;
}
