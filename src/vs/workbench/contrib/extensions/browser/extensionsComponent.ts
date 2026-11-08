import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { FilteredListControl } from "../../../browser/parts/views/filteredListControl.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { filterExtensionEntries, parseExtensionQuery } from "../common/extensionQuery.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane } from "./extensionEditorPane.ts";
import type { IExtensionPageActions } from "./extensionPageActions.ts";
import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";
import { buildExtensionRow, EXTENSION_ROW_HEIGHT, type IExtensionRowStyles } from "./extensionRows.ts";

export const ExtensionsComponentDIToken = token<ExtensionsComponent>("ExtensionsComponent");

export const EXTENSIONS_VIEWLET_ID = "extensions";

/** The catalog section; it also holds the search box. */
export const EXTENSIONS_VIEW_ID = "workbench.extensions.marketplace";

export const EXTENSIONS_INSTALLED_VIEW_ID = "workbench.extensions.installed";

export interface IExtensionsEditorTarget {
    openPane(pane: IEditorPane): void;
}

export const ExtensionsEditorTargetDIToken = token<IExtensionsEditorTarget>("ExtensionsEditorTarget");

// Row id prefixes kept from the grouped list: e2e and the inspector address rows by them.
const MARKETPLACE_ROW_PREFIX = "extensionsGroup-marketplace";
const INSTALLED_ROW_PREFIX = "extensionsGroup-installed";
const ERROR_ROW_ID = "extensionsRetry";
const EMPTY_ROW_ID = "extensionsEmpty";
const INSTALLED_EMPTY_ROW_ID = "extensionsInstalledEmpty";
const LOADING_ROW_ID = "extensionsLoading";

const ROW_STYLES: IExtensionRowStyles = {
    dimFg: "descriptionForeground",
    updateFg: "textLink.foreground",
    warningFg: "editorWarning.foreground",
};

/** Entries are three lines each: a line between them keeps the list from looking crammed. */
const ROW_SEPARATOR: StyleColor = "panel.border";

type RowAction = { readonly kind: "open"; readonly id: string } | { readonly kind: "retry" };

/**
 * Two sections of the viewlet, MARKETPLACE (with the search box) and INSTALLED; the query filters both.
 * Installed extensions also stay in the catalog with an `Installed` badge: the catalog must not lose
 * entries. Filtering is local over the service cache, so no debounce is needed.
 *
 * Deviation: upstream's search box sits above all sections, in the viewlet header; ours lives in the
 * MARKETPLACE section, since a view container has no header of its own.
 */
export class ExtensionsComponent extends Component {
    public static dependencies = [
        ExtensionsWorkbenchServiceDIToken,
        ViewsServiceDIToken,
        ExtensionsEditorTargetDIToken,
        ExtensionPageActionsDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    private readonly control: FilteredListControl;
    /** The MARKETPLACE section's list. */
    public readonly list: ListViewElement;
    public readonly installedList: ListViewElement;
    private readonly installedView: TUIElement;
    private readonly actions = new Map<string, RowAction>();
    /** The catalog is being read: an empty list now means "don't know yet", not "empty". */
    private loading = false;

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        viewsService: ViewsService,
        private readonly editorTarget: IExtensionsEditorTarget,
        private readonly pageActions: IExtensionPageActions,
        configurationService: IConfigurationService,
    ) {
        super();

        // Like upstream's extension lists (and our Explorer): a single click opens unless the user asked for double.
        const openOnSingleClick = (): boolean => configurationService.get("workbench.list.openMode") !== "doubleClick";
        this.control = new FilteredListControl({
            viewId: "extensionsView",
            listId: "extensionsList",
            placeholder: "Search Extensions",
            rowSeparatorColor: ROW_SEPARATOR,
            openOnSingleClick,
        });
        this.list = this.control.list;
        this.control.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.control.onQueryChange = () => {
            this.rebuildRows();
        };
        this.control.onActivateRow = (rowId) => {
            this.activateRow(rowId);
        };

        this.installedList = new ListViewElement({
            typeahead: false,
            rowSeparatorColor: ROW_SEPARATOR,
            openOnSingleClick,
        });
        this.installedList.id = "extensionsInstalledList";
        this.installedList.onActivate = (element) => {
            // Rows always carry an id.
            if (element.id !== undefined) this.activateRow(element.id);
        };
        this.installedView = new ScrollBarDecorator(this.installedList);
        this.installedView.id = "extensionsInstalledView";
        this.installedView.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

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
            title: "MARKETPLACE",
            order: 10,
            body: this.control.view,
            focus: () => {
                this.focus();
            },
        });
        viewsService.registerView({
            id: EXTENSIONS_INSTALLED_VIEW_ID,
            containerId: EXTENSIONS_VIEWLET_ID,
            title: "INSTALLED",
            order: 20,
            body: this.installedView,
            focus: () => {
                this.installedList.focus();
            },
        });
    }

    /** The MARKETPLACE section: the search box and the catalog. */
    public get view(): TUIElement {
        return this.control.view;
    }

    public get installedSectionView(): TUIElement {
        return this.installedView;
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
        const query = parseExtensionQuery(this.getQuery());
        const entries = filterExtensionEntries(this.service.getEntries(), query);
        // Upstream `@installed`/`@outdated` are one installed list: the catalog would only repeat it.
        const installedOnly = query.scope !== "all";
        const catalog = installedOnly ? [] : entries.filter((e) => e.latestVersion !== null);
        const installed = entries.filter((e) => e.installedVersion !== null);

        this.list.clear();
        this.installedList.clear();
        this.actions.clear();

        const error = this.service.getCatalogError();
        if (error !== null) {
            this.list.appendRow(messageRow(ERROR_ROW_ID, `Retry — ${error}`, "editorWarning.foreground"));
            this.actions.set(ERROR_ROW_ID, { kind: "retry" });
        } else {
            for (const entry of catalog) this.appendEntry(this.list, MARKETPLACE_ROW_PREFIX, entry);
        }
        // Under `@installed`/`@outdated` an empty catalog is by design, not "nothing found".
        if (this.list.rowCount === 0 && (this.loading || !installedOnly)) {
            showState(
                this.list,
                this.loading
                    ? messageRow(LOADING_ROW_ID, "Loading extensions…", "descriptionForeground")
                    : messageRow(EMPTY_ROW_ID, "No extensions found", "descriptionForeground"),
            );
        }

        for (const entry of installed) this.appendEntry(this.installedList, INSTALLED_ROW_PREFIX, entry);
        if (this.installedList.rowCount === 0) {
            showState(
                this.installedList,
                messageRow(INSTALLED_EMPTY_ROW_ID, "No extensions found", "descriptionForeground"),
            );
        }
    }

    private appendEntry(list: ListViewElement, prefix: string, entry: IExtensionListEntry): void {
        // One entry can be in both sections, so the id carries the section. Dots become dashes: the
        // inspector selector (`#id`) does not understand dots.
        const rowId = `${prefix}-${entry.id.replaceAll(".", "-")}`;
        list.appendRow(buildExtensionRow(rowId, entry, ROW_STYLES), { height: EXTENSION_ROW_HEIGHT });
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

/** A state row is text, not an item: no cursor sits on it. */
function showState(list: ListViewElement, row: TUIElement): void {
    list.appendRow(row);
    list.clearCursor();
}

/** A one-line state row (loading, empty, error) with the same gutter as the entries. */
function messageRow(id: string, text: string, fg: StyleColor): TUIElement {
    const label = new TextLabelElement(text);
    label.setColors(fg, INHERITED_BG);
    const row = new PaddingContainerElement(label, { left: 1, right: 1 });
    row.id = id;
    return row;
}
