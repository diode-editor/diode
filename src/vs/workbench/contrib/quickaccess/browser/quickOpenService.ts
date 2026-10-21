import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputComponentDIToken } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import type { QuickPickElement } from "../../../browser/parts/quickinput/quickPickElement.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";
import type { QuickAccessRegistry } from "../common/quickAccessRegistry.ts";
import { QuickAccessRegistryDIToken } from "../common/quickAccessRegistry.ts";

const SEARCH_DEBOUNCE_MS = 16;

export const QuickOpenServiceDIToken = token<QuickOpenService>("QuickOpenService");

/**
 * Аналог `QuickAccessController` vscode. Общий виджет делит с `QuickInputService`, поэтому на каждый
 * показ полностью ре-инициализирует его состояние и колбэки.
 */
export class QuickOpenService extends Disposable {
    public static dependencies = [QuickAccessRegistryDIToken, QuickInputComponentDIToken] as const;

    /** null — показ закрыт. */
    private currentProvider: IQuickAccessProvider | null = null;
    /** Сессию общего виджета мог занять QuickInputService. */
    private active = false;

    private searchTimer: ReturnType<typeof setTimeout> | null = null;
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
        view.resetFlavorState();
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

    private handleDidClose(): void {
        this.active = false;
        this.cancelPendingSearch();
        this.currentProvider?.onHide?.();
        this.currentProvider = null;
    }

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

        if (provider.debounceQuery !== true) {
            this.cancelPendingSearch();
            this.updateItems(query);
            return;
        }

        // Leading + trailing: после паузы — сразу, внутри cooldown запоминаем последний запрос
        // для хвостового прогона.
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
