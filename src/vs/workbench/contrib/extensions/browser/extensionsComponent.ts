import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { FilteredListControl } from "../../../browser/parts/views/filteredListControl.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";
import {
    ExtensionsWorkbenchServiceDIToken,
    filterExtensionEntries,
    parseExtensionQuery,
} from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane } from "./extensionEditorPane.ts";
import type { IExtensionPageActions } from "./extensionPageActions.ts";
import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";
import { buildExtensionRow, buildGroupRow, type IExtensionRowStyles } from "./extensionRows.ts";

export const ExtensionsComponentDIToken = token<ExtensionsComponent>("ExtensionsComponent");

export const EXTENSIONS_VIEWLET_ID = "extensions";

export const EXTENSIONS_VIEW_ID = "workbench.extensions.marketplace";

export interface IExtensionsEditorTarget {
    openPane(pane: IEditorPane): void;
}

export const ExtensionsEditorTargetDIToken = token<IExtensionsEditorTarget>("ExtensionsEditorTarget");

const MARKETPLACE_GROUP_ID = "extensionsGroup-marketplace";
const INSTALLED_GROUP_ID = "extensionsGroup-installed";
const ERROR_ROW_ID = "extensionsRetry";
const EMPTY_ROW_ID = "extensionsEmpty";
const LOADING_ROW_ID = "extensionsLoading";

const ROW_STYLES: IExtensionRowStyles = {
    dimFg: "descriptionForeground",
    updateFg: "textLink.foreground",
    warningFg: "editorWarning.foreground",
};

type RowAction = { readonly kind: "open"; readonly id: string } | { readonly kind: "retry" };

/**
 * Installed extensions get their own section and also stay in the catalog with an `Installed` badge: the
 * catalog must not lose entries. Filtering is local over the service cache, so no debounce is needed.
 */
export class ExtensionsComponent extends Component {
    public static dependencies = [
        ExtensionsWorkbenchServiceDIToken,
        ViewsServiceDIToken,
        ExtensionsEditorTargetDIToken,
        ExtensionPageActionsDIToken,
    ] as const;

    private readonly control = new FilteredListControl({
        viewId: "extensionsView",
        listId: "extensionsList",
        placeholder: "Search Extensions",
    });
    public readonly list: ListViewElement;
    private readonly actions = new Map<string, RowAction>();
    /** The catalog is being read: an empty list now means "don't know yet", not "empty". */
    private loading = false;

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        viewsService: ViewsService,
        private readonly editorTarget: IExtensionsEditorTarget,
        private readonly pageActions: IExtensionPageActions,
    ) {
        super();

        this.list = this.control.list;
        this.control.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.control.onQueryChange = () => {
            this.rebuildRows();
        };
        this.control.onActivateRow = (rowId) => {
            this.activateRow(rowId);
        };

        this.register(
            service.onDidChange(() => {
                this.rebuildRows();
            }),
        );
        this.rebuildRows();

        // Order as in the VS Code activity bar: the marketplace comes after Source Control.
        viewsService.registerContainer({
            id: EXTENSIONS_VIEWLET_ID,
            title: "EXTENSIONS",
            // Stryker disable next-line StringLiteral: ViewsService makes tabs only for "panel" and "auxiliarybar"; any other value (including a mutated one) goes to the sidebar, so replacing the string has no observable effect
            location: "sidebar",
            order: 3,
            visibleContextKey: "extensionsViewletVisible",
            // Like upstream: other views are not moved into the marketplace.
            rejectAddedViews: true,
        });
        viewsService.registerView({
            id: EXTENSIONS_VIEW_ID,
            containerId: EXTENSIONS_VIEWLET_ID,
            title: "EXTENSIONS",
            order: 10,
            body: this.control.view,
            focus: () => {
                this.focus();
            },
        });
    }

    public get view(): TUIElement {
        return this.control.view;
    }

    /** Also the moment of the first catalog read: no network access until the viewlet is shown. */
    public focus(): void {
        this.control.focusInput();
        void this.withLoadingRow(() => this.service.ensureLoaded());
    }

    public refresh(): Promise<void> {
        return this.withLoadingRow(() => this.service.refresh());
    }

    public checkForUpdates(): Promise<void> {
        return this.withLoadingRow(() => this.service.checkForUpdates());
    }

    /** Without "Loading…" the first show on a slow network looks like an empty marketplace. */
    private async withLoadingRow(read: () => Promise<void>): Promise<void> {
        this.loading = true;
        this.rebuildRows();
        try {
            await read();
        } finally {
            this.loading = false;
            this.rebuildRows();
        }
    }

    public getQuery(): string {
        return this.control.getQuery();
    }

    /** Upstream `openSearch`: the query goes into the search box and filters the list at once. */
    public setQuery(query: string): void {
        this.control.setQuery(query);
    }

    private rebuildRows(): void {
        const query = this.getQuery();
        const entries = filterExtensionEntries(this.service.getEntries(), query);
        // Outdated ones are installed by definition: under `@outdated` the catalog would only repeat them.
        const catalog = parseExtensionQuery(query).outdated ? [] : entries.filter((e) => e.latestVersion !== null);
        const installed = entries.filter((e) => e.installedVersion !== null);

        this.list.clear();
        this.actions.clear();

        const error = this.service.getCatalogError();
        if (error !== null) {
            this.appendGroup(MARKETPLACE_GROUP_ID, "MARKETPLACE");
            const row = new TextLabelElement(`Retry — ${error}`);
            row.id = ERROR_ROW_ID;
            row.setColors("editorWarning.foreground", INHERITED_BG);
            this.list.appendRow(row, { parentId: MARKETPLACE_GROUP_ID });
            this.actions.set(ERROR_ROW_ID, { kind: "retry" });
        } else if (catalog.length > 0) {
            this.appendGroup(MARKETPLACE_GROUP_ID, "MARKETPLACE");
            for (const entry of catalog) this.appendEntry(MARKETPLACE_GROUP_ID, entry);
        }

        if (installed.length > 0) {
            this.appendGroup(INSTALLED_GROUP_ID, "INSTALLED");
            for (const entry of installed) this.appendEntry(INSTALLED_GROUP_ID, entry);
        }

        if (this.list.rowCount === 0) {
            this.control.showPlaceholderRow(
                this.loading ? LOADING_ROW_ID : EMPTY_ROW_ID,
                this.loading ? "Loading extensions…" : "No extensions found",
            );
        }
    }

    private appendGroup(id: string, title: string): void {
        this.list.appendRow(buildGroupRow(id, title, "descriptionForeground"));
    }

    private appendEntry(groupId: string, entry: IExtensionListEntry): void {
        // One entry can be in both sections, so the id carries the section. Dots become dashes: the
        // inspector selector (`#id`) does not understand dots.
        const rowId = `${groupId}-${entry.id.replaceAll(".", "-")}`;
        this.list.appendRow(buildExtensionRow(rowId, entry, ROW_STYLES), {
            parentId: groupId,
            label: entry.displayName,
        });
        this.actions.set(rowId, { kind: "open", id: entry.id });
    }

    private activateRow(rowId: string): void {
        // Both branches are explicit: a fallback would silently do one of the two on a mutated action.
        const action = this.actions.get(rowId);
        if (action?.kind === "open") {
            void this.openExtensionPage(action.id);
            return;
        }
        if (action?.kind === "retry") void this.refresh();
    }

    /** Metadata is fetched here, not in the pane: a network failure must reach the page as text. */
    public async openExtensionPage(id: string): Promise<void> {
        const entry = this.service.getEntries().find((e) => e.id === id);
        if (entry === undefined) return;
        let meta;
        let metaError: string | null = null;
        try {
            meta = await this.service.getMeta(id);
        } catch (error) {
            metaError = error instanceof Error ? error.message : String(error);
        }
        this.editorTarget.openPane(new ExtensionEditorPane(this.service, this.pageActions, entry, meta, metaError));
    }
}
