import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
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
 * Counterpart of vscode's `QuickAccessController`. Shares its widget with `QuickInputService`, so every
 * show fully re-initializes the widget's state and callbacks.
 */
export interface IQuickOpenShowOptions {
    /** Upstream `ItemActivation.SECOND`: the cursor starts on the second row (`quickOpenPreviousEditor`). */
    readonly activateSecond?: boolean;
}

export class QuickOpenService extends Disposable implements IContextKeyContributor {
    public static dependencies = [QuickAccessRegistryDIToken, QuickInputComponentDIToken] as const;

    /** null when the picker is closed. */
    private currentProvider: IQuickAccessProvider | null = null;
    private currentPrefix = "";
    /** QuickInputService may have taken over the shared widget's session. */
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

    public show(prefix = "", options: IQuickOpenShowOptions = {}): void {
        if (this.isOpen()) {
            this.view.focus();
            return;
        }
        // The shared widget may hold someone else's session (QuickInputService InputBox/list) —
        // close it (its promise is cancelled via onDidClose) before taking over.
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
        if (options.activateSecond === true) view.setActiveIndex(1);

        this.component.show();
    }

    /**
     * Upstream `quickOpenNavigateNext/PreviousInFilePicker` without quick navigate: the cursor steps
     * like the arrows, the typed query stays, Enter accepts.
     */
    public navigate(next: boolean): void {
        if (!this.isOpen()) return;
        this.view.moveActive(next ? 1 : -1);
    }

    /**
     * Upstream `inQuickOpen` and `inFilesPicker` (the default, prefix-less provider): the second keeps
     * Ctrl+P/Ctrl+E stepping through files, not reopening the picker.
     */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        const open = this.isOpen();
        contextKeys.set("inQuickOpen", open);
        contextKeys.set("inFilesPicker", open && this.currentPrefix === "");
    }

    public close(): void {
        if (!this.isOpen()) return;
        // Cleanup (deactivating the provider, cancelling the debounce) is in handleDidClose,
        // which onDidClose reaches on this programmatic path too.
        this.component.hide();
    }

    public override dispose(): void {
        this.cancelPendingSearch();
        super.dispose();
    }

    /** QuickInputService may have taken over the shared widget. */
    private isOpen(): boolean {
        return this.active && this.component.isOpen();
    }

    private handleDidClose(): void {
        this.active = false;
        this.cancelPendingSearch();
        this.currentProvider?.onHide?.();
        this.currentProvider = null;
    }

    private activateProviderFor(query: string): IQuickAccessProvider {
        const { prefix, provider } = this.quickAccess.getProvider(query);
        this.currentPrefix = prefix;
        if (provider === this.currentProvider) return provider;

        this.currentProvider?.onHide?.();
        this.currentProvider = provider;
        provider.onShow?.((preserveSelection) => {
            // A live source update is ignored if the provider is no longer
            // active or the picker is closed/taken over (a late callback after close).
            if (this.currentProvider !== provider) return;
            if (!this.isOpen()) return;
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

        // Leading + trailing: after a pause, run at once; within the cooldown remember the last query
        // for the trailing run.
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
        /* v8 ignore start -- defensive: show always activates a provider before the first updateItems */
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
