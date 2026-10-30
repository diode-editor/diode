import * as nodePath from "node:path";

import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";
import type { TreeActivateOptions } from "@tuidom/elements/tree/treeViewElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { Component } from "../../../browser/component.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { EXPLORER_VIEWLET_ID } from "./explorerComponent.ts";

export const OpenEditorsViewDIToken = token<OpenEditorsView>("OpenEditorsView");

/** Upstream's id (`OpenEditorsView.ID`). */
export const OPEN_EDITORS_VIEW_ID = "workbench.explorer.openEditorsView";

const VISIBLE_SETTING = "explorer.openEditors.visible";
const MIN_VISIBLE_SETTING = "explorer.openEditors.minVisible";
const SORT_ORDER_SETTING = "explorer.openEditors.sortOrder";
/** Upstream `OpenEditorsView.DEFAULT_VISIBLE_OPEN_EDITORS`/`DEFAULT_MIN_VISIBLE_OPEN_EDITORS`: a non-number setting falls back to them. */
const DEFAULT_VISIBLE = 9;
const DEFAULT_MIN_VISIBLE = 0;

/** The tab strip's glyphs: ● marks a modified editor, × closes. */
const MODIFIED_GLYPH = "●";
const CLOSE_GLYPH = "×";

export interface IOpenEditorsGroupElement {
    readonly kind: "group";
    readonly group: EditorGroup;
    /** Upstream `IEditorGroup.label`: "Group N" by the group's position. */
    readonly label: string;
}

export interface IOpenEditorsEditorElement {
    readonly kind: "editor";
    readonly group: EditorGroup;
    readonly pane: IEditorPane;
}

export type OpenEditorsElement = IOpenEditorsGroupElement | IOpenEditorsEditorElement;

type SortOrder = "editorOrder" | "alphabetical" | "fullPath";

/** What the section needs from the editor service: tab names and closing with the unsaved-changes dialog. */
export type OpenEditorsEditorService = Pick<IEditorService, "displayName" | "closeEditor" | "closeAllEditors">;

function elementKey(element: OpenEditorsElement): string {
    return element.kind === "group"
        ? `group:${element.group.id}`
        : `editor:${element.group.id}:${element.pane.uri.toString()}`;
}

/** Upstream `compareFileNamesDefault`: numbers inside names compare by value. */
function compareNames(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * The OPEN EDITORS section of the Explorer (upstream `OpenEditorsView`): the tabs of every group, a
 * "Group N" row above each group's tabs once there are two or more. Hidden by default, like upstream.
 */
export class OpenEditorsView extends Component implements IContextKeyContributor {
    public static dependencies = [
        ViewsServiceDIToken,
        EditorGroupsServiceDIToken,
        EditorServiceDIToken,
        CommandRegistryDIToken,
        IConfigurationServiceDIToken,
        IWorkspaceContextServiceDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private readonly tree: TreeViewElement<OpenEditorsElement>;
    private readonly scrollBars: ScrollBarDecorator;
    private elements: OpenEditorsElement[] = [];

    public constructor(
        private readonly viewsService: ViewsService,
        private readonly groups: IEditorGroupsService,
        private readonly editors: OpenEditorsEditorService,
        private readonly commands: CommandRegistry,
        private readonly configurationService: IConfigurationService,
        private readonly workspace: IWorkspaceContextService,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        super();
        const provider: ITreeDataProvider<OpenEditorsElement> = {
            getTreeItem: (element) => this.treeItem(element),
            getChildren: (element) => (element === undefined ? this.elements : []),
            getKey: elementKey,
        };
        this.tree = new TreeViewElement(provider, {
            leftPadding: 1,
            openOnSingleClick: () => configurationService.get("workbench.list.openMode") !== "doubleClick",
        });
        this.scrollBars = new ScrollBarDecorator(this.tree);
        this.scrollBars.id = "openEditorsView";
        this.tree.id = "openEditorsList";
        this.scrollBars.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.tree.onActivate = (element, options) => {
            this.open(element, options);
        };
        this.tree.onInlineAction = (element, index) => {
            this.runInlineAction(element, index);
        };
        // Upstream `list.onMouseMiddleClick`: closes the editor; a group row ignores it.
        this.tree.onMiddleClick = (element) => {
            if (element.kind === "editor") this.closeEditor(element);
        };

        viewsService.registerView({
            id: OPEN_EDITORS_VIEW_ID,
            containerId: EXPLORER_VIEWLET_ID,
            title: "OPEN EDITORS",
            // Above the file tree (upstream `order: 0`).
            order: 0,
            body: this.scrollBars,
            canToggleVisibility: true,
            canMoveView: true,
            hideByDefault: true,
            focus: () => {
                this.tree.focus();
            },
        });

        const refresh = (): void => {
            this.refresh();
        };
        this.register(groups.onDidChangeEditors(refresh));
        this.register(groups.onDidGroupsChange(refresh));
        this.register(groups.onDidActiveGroupChange(refresh));
        this.register(groups.onDidChangeActivePane(refresh));
        this.register(workspace.onDidChangeWorkspaceFolders(refresh));
        this.register(icons.onDidChange(refresh));
        this.register(
            configurationService.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("explorer.openEditors")) this.refresh();
            }),
        );
        this.refresh();
    }

    public get view(): TUIElement {
        return this.scrollBars;
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("openEditorsFocus", this.containsFocus(active));
    }

    /** The row under the cursor (Delete closes it). */
    public getFocusedElement(): OpenEditorsElement | null {
        return this.tree.getSelectedNode();
    }

    public closeEditor(element: IOpenEditorsEditorElement): void {
        void this.editors.closeEditor(element.group, element.pane);
    }

    private containsFocus(active: TUIElement | null): boolean {
        for (let element = active; element !== null; element = element.getParent()) {
            if (element === this.scrollBars) return true;
        }
        return false;
    }

    private refresh(): void {
        this.elements = this.buildElements();
        this.updateSize();
        void this.tree.refresh().then(() => {
            // Upstream `focusActiveEditor`: the active tab of the active group is the selected row.
            const active = this.activeElement();
            if (active !== null) void this.tree.reveal([active]);
        });
    }

    private buildElements(): OpenEditorsElement[] {
        const groups = this.groups.groups;
        const showGroups = groups.length > 1;
        return groups.flatMap((group, index): OpenEditorsElement[] => {
            const editors = this.sorted(group).map((pane): OpenEditorsElement => ({ kind: "editor", group, pane }));
            return showGroups ? [{ kind: "group", group, label: `Group ${index + 1}` }, ...editors] : editors;
        });
    }

    /** Upstream `getElements`: `alphabetical` by tab name, `fullPath` non-file editors first, then by resource. */
    private sorted(group: EditorGroup): IEditorPane[] {
        const panes = [...group.getPanes()];
        const order = this.configurationService.get(SORT_ORDER_SETTING) as SortOrder;
        if (order === "alphabetical") {
            return panes.sort((a, b) => compareNames(this.editors.displayName(a), this.editors.displayName(b)));
        }
        if (order === "fullPath") {
            return panes.sort((a, b) => {
                const aFile = a.uri.scheme === "file";
                const bFile = b.uri.scheme === "file";
                if (aFile !== bFile) return aFile ? 1 : -1;
                return compareNames(a.uri.toString().toLowerCase(), b.uri.toString().toLowerCase());
            });
        }
        return panes;
    }

    private activeElement(): OpenEditorsElement | null {
        const group = this.groups.activeGroup;
        const pane = group.activePane;
        if (pane === null) return null;
        return this.elements.find((element) => element.kind === "editor" && element.pane === pane) ?? null;
    }

    /**
     * Upstream `updateSize` for a vertical sidebar: min(visible, rows) rows, at most max(rows, minVisible)
     * — a few tabs take exactly their rows, many get `visible` rows and a scroll bar (the user may drag it
     * taller). The file tree gets the rest. `minVisible` slots stay pre-allocated (upstream only lets the
     * section grow to them; the setting's description promises them).
     */
    private updateSize(): void {
        const visible = numberSetting(this.configurationService.get(VISIBLE_SETTING), DEFAULT_VISIBLE);
        const minVisible = numberSetting(this.configurationService.get(MIN_VISIBLE_SETTING), DEFAULT_MIN_VISIBLE);
        const rows = this.elements.length;
        this.viewsService.setViewContentBounds(OPEN_EDITORS_VIEW_ID, {
            min: Math.max(Math.min(Math.max(visible, 1), rows), minVisible),
            max: Math.max(rows, minVisible),
        });
    }

    private treeItem(element: OpenEditorsElement): ITreeItem {
        if (element.kind === "group") {
            return {
                label: element.label,
                collapsible: false,
                actions: [
                    { label: "Save All in Group", icon: this.icons.codicon("save-all") },
                    { label: "Close Group", icon: this.icons.codicon("close-all") },
                ],
            };
        }
        const { pane, group } = element;
        const label = this.editors.displayName(pane);
        const fileIcon = this.icons.fileIcon(label);
        return {
            label,
            icon: fileIcon?.icon,
            iconColor: fileIcon?.color,
            description: this.descriptionOf(pane),
            // A preview tab is italic in the tab strip; the row follows it.
            italic: !group.isPinned(pane),
            collapsible: false,
            // Upstream: ● stays on a modified editor, × shows under the mouse and on the selected row.
            actions: [{ label: "Close", icon: CLOSE_GLYPH, idleIcon: pane.isModified ? MODIFIED_GLYPH : undefined }],
        };
    }

    /**
     * Upstream's label description: the folder relative to the workspace root, the absolute one outside
     * it; nothing for an untitled or non-file editor, nor for a file right in the root.
     */
    private descriptionOf(pane: IEditorPane): string {
        if (pane.uri.scheme !== "file") return "";
        const directory = nodePath.dirname(pane.uri.fsPath);
        const folder = this.workspace.getWorkspaceFolder(pane.uri);
        if (folder === null) return directory;
        return nodePath.relative(folder.uri.fsPath, directory).split(nodePath.sep).join("/");
    }

    /**
     * Upstream `list.onDidOpen`: a click activates the tab and keeps focus in the list, Enter and a double
     * click also pin it and move focus to the editor. A group row activates the group.
     */
    private open(element: OpenEditorsElement, { pinned, preserveFocus }: TreeActivateOptions): void {
        const { group } = element;
        if (element.kind === "group") {
            this.groups.focusGroup(group.id, { focus: !preserveFocus });
            return;
        }
        const index = group.getPanes().indexOf(element.pane);
        /* v8 ignore start -- defensive: rows are rebuilt on every editor change, a row's pane is in its group */
        if (index < 0) return;
        /* v8 ignore stop */
        this.groups.focusGroup(group.id, { focus: false });
        if (pinned) group.pinPane(element.pane);
        group.activateTab(index, { focus: !preserveFocus });
    }

    private runInlineAction(element: OpenEditorsElement, index: number): void {
        if (element.kind === "editor") {
            this.closeEditor(element);
            return;
        }
        if (index === 0) {
            this.commands.execute("workbench.files.action.saveAllInGroup", element.group.id);
            return;
        }
        void this.editors.closeAllEditors(element.group);
    }
}

function numberSetting(value: unknown, fallback: number): number {
    return typeof value === "number" ? value : fallback;
}
