import { Disposable } from "@tuidom/all/common/disposable";
import type { QuickPickElement, QuickPickItem } from "@tuidom/all/ui/quickpick/quickPickElement";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputComponentDIToken } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";
import type { QuickAccessRegistry } from "../common/quickAccessRegistry.ts";
import { QuickAccessRegistryDIToken } from "../common/quickAccessRegistry.ts";

/**
 * Debounce window for debounced providers (file search). A single keystroke
 * after an idle period runs synchronously (leading edge); rapid bursts coalesce
 * into one trailing run so typing stays smooth on huge trees.
 */
const SEARCH_DEBOUNCE_MS = 16;

export const QuickOpenServiceDIToken = token<QuickOpenService>("QuickOpenService");

/**
 * Quick Open (Ctrl+P): контроллер показа поверх общего виджета
 * {@link QuickInputComponent} (аналог `QuickAccessController` vscode). О
 * конкретных режимах не знает: провайдера выбирает {@link QuickAccessRegistry}
 * по префиксу запроса (`""` — файлы, `">"` — команды, `":"` — goto-line);
 * провайдер отдаёт пункты/плейсхолдер, принятие — колбэк `accept` на пункте.
 * На каждый показ сервис полностью ре-инициализирует состояние и колбэки
 * виджета (соседний клиент — `QuickInputService` — делает то же).
 */
export class QuickOpenService extends Disposable {
    public static dependencies = [QuickAccessRegistryDIToken, QuickInputComponentDIToken] as const;

    /** Активный провайдер текущего показа; null — показ закрыт. */
    private currentProvider: IQuickAccessProvider | null = null;
    /** Владеем ли текущим показом общего виджета (сессию мог занять QuickInputService). */
    private active = false;

    /** Active cooldown timer for the debounced-query cooldown; null when idle. */
    private searchTimer: ReturnType<typeof setTimeout> | null = null;
    /** Latest debounced query awaiting a trailing run, or null if none pending. */
    private pendingQuery: string | null = null;

    public constructor(
        private readonly quickAccess: QuickAccessRegistry,
        private readonly component: QuickInputComponent,
    ) {
        super();
    }

    private get view(): QuickPickElement {
        return this.component.view;
    }

    /** Открывает Quick Open с префиксом провайдера (`""` / `">"` / `":"` …). */
    public show(prefix = ""): void {
        if (this.active && this.component.isOpen()) {
            this.view.focus();
            return;
        }
        // Общий виджет мог держать чужой показ (InputBox/список QuickInputService) —
        // закрываем его (его промис отменится через onDidClose) перед перехватом.
        this.component.hide();

        this.active = true;

        const view = this.view;
        // Полный ре-инит общего виджета под Quick Open.
        view.maxVisibleItems = 10;
        view.acceptMode = "item";
        view.title = undefined;
        view.prompt = undefined;
        view.validationMessage = null;
        view.onAcceptValue = null;
        view.onActiveItemChanged = null;
        view.onQueryChange = (query) => {
            this.handleQueryChange(query);
        };
        view.onAccept = (item) => {
            this.handleAccept(item);
        };
        view.onCancel = () => {
            this.close();
        };
        this.component.onDidClose = () => {
            // Клик мимо / Escape / программное закрытие — единый путь зачистки.
            this.handleDidClose();
        };

        view.setQuery(prefix);
        this.activateProviderFor(prefix);
        this.updateItems(view.getQuery());

        this.component.show();
    }

    public close(): void {
        if (!this.active || !this.component.isOpen()) return;
        // Зачистка (деактивация провайдера, отмена debounce) — в handleDidClose,
        // куда onDidClose приводит и этот программный путь.
        this.component.hide();
    }

    public override dispose(): void {
        this.cancelPendingSearch();
        super.dispose();
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    private handleDidClose(): void {
        this.active = false;
        this.cancelPendingSearch();
        this.currentProvider?.onHide?.();
        this.currentProvider = null;
    }

    /**
     * Резолвит провайдера под запрос; на смене провайдера деактивирует прежнего
     * (onHide), активирует нового (onShow) и применяет его плейсхолдер.
     */
    private activateProviderFor(query: string): IQuickAccessProvider {
        const { provider } = this.quickAccess.getProvider(query);
        if (provider === this.currentProvider) return provider;

        this.currentProvider?.onHide?.();
        this.currentProvider = provider;
        provider.onShow?.((preserveSelection) => {
            // Живое обновление источника игнорируется, если провайдер уже не
            // активен или показ закрыт/перехвачен (поздний колбэк после close).
            if (this.currentProvider !== provider) return;
            if (!this.active || !this.component.isOpen()) return;
            this.updateItems(this.view.getQuery(), preserveSelection);
        });
        this.view.placeholder = provider.getPlaceholder();
        return provider;
    }

    private handleQueryChange(query: string): void {
        const provider = this.activateProviderFor(query);

        // Cheap providers (tiny synchronous item list) run immediately and drop
        // any pending debounced run.
        if (provider.debounceQuery !== true) {
            this.cancelPendingSearch();
            this.updateItems(query);
            return;
        }

        // Debounced provider: leading + trailing. Idle → run now (leading) and
        // start a cooldown; within the cooldown → remember the latest query and
        // let the trailing run pick it up.
        if (this.searchTimer === null) {
            this.updateItems(query);
            this.armSearchTimer();
        } else {
            this.pendingQuery = query;
        }
    }

    private armSearchTimer(): void {
        this.searchTimer = setTimeout(() => {
            this.searchTimer = null;
            if (this.pendingQuery === null) return;
            const query = this.pendingQuery;
            this.pendingQuery = null;
            this.updateItems(query);
            // Keep coalescing if the user is still typing.
            this.armSearchTimer();
        }, SEARCH_DEBOUNCE_MS);
    }

    private cancelPendingSearch(): void {
        if (this.searchTimer !== null) {
            clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
        this.pendingQuery = null;
    }

    private handleAccept(item: QuickPickItem): void {
        const accept = (item as QuickAccessItem).accept;

        queueMicrotask(() => {
            // An item without accept is info-only (e.g. "type a line number") —
            // no-op, keep the picker open so the user can keep typing.
            if (accept === undefined) return;
            this.close();
            accept();
        });
    }

    private updateItems(query: string, preserveSelection = false): void {
        /* v8 ignore start -- defensive: показ всегда активирует провайдера до первого updateItems */
        const provider = this.currentProvider ?? this.activateProviderFor(query);
        /* v8 ignore stop */
        const items = provider.getItems(query);

        if (preserveSelection) {
            this.view.refreshItems(items);
        } else {
            this.view.items = items;
        }
    }
}
