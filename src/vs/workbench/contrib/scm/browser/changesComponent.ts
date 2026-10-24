import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VFlexElement, vflexFill, vflexFit } from "@tuidom/elements/layout/vFlexElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";

import { listRowId } from "../../../../base/common/listRowId.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { ScmMenuContext } from "../../../browser/actions/menuContexts.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IViewWelcomeBlock } from "../../../browser/parts/views/viewWelcomeElement.ts";
import { SCM_VIEW_MODE_STATE, type ScmViewMode } from "../../../common/stateKeys.ts";
import {} from "../../../services/themes/common/themeTokens.ts";
import { SCM_CHANGES_VIEW_ID, SCM_VIEWLET_ID } from "../common/scmViews.ts";

import type { IScmChange, ScmChangesService, ScmGroupId } from "./changesService.ts";
import { SCM_GROUP_IDS, ScmChangesServiceDIToken } from "./changesService.ts";
import { groupChanges } from "./scmChangeGroups.ts";
import {
    buildFileRow,
    buildFolderRow,
    buildGroupRow,
    formatFileRow,
    GIT_STATUS_COLOR_IDS,
    type IScmFileRowParts,
    type IScmRowStyles,
} from "./scmChangeRows.ts";
import { buildScmTree, displayPath, type ScmTreeNode, sortChangesFlat } from "./scmChangeTree.ts";
import type { ScmInputComponent } from "./scmInputComponent.ts";
import { SCM_INPUT_HEIGHT, ScmInputComponentDIToken } from "./scmInputComponent.ts";

export const ChangesComponentDIToken = token<ChangesComponent>("ChangesComponent");

/** As upstream, minus clone: there is no clone command. */
const SCM_WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "To use source control, open a folder containing a Git repository." },
    { kind: "text", text: "" },
    { kind: "button", label: "Open Folder", command: "workbench.action.files.openFolder" },
];

type ScmRowMeta =
    | { readonly kind: "file"; readonly parts: IScmFileRowParts; readonly change: IScmChange; readonly label: string }
    | { readonly kind: "folder"; readonly group: ScmGroupId; readonly changes: readonly IScmChange[] }
    | { readonly kind: "group"; readonly group: ScmGroupId; readonly changes: readonly IScmChange[] };

/** The e2e selector `#id` matches only `[A-Za-z0-9_-]`; a suffix separates collisions ("a.b" ↔ "a-b"). */
function sanitizeIdSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]+/g, "-");
}

export class ChangesComponent extends Component {
    public static dependencies = [
        ScmChangesServiceDIToken,
        CommandRegistryDIToken,
        ContextMenuServiceDIToken,
        StateServiceDIToken,
        ViewsServiceDIToken,
        ScmInputComponentDIToken,
        ProductIconServiceDIToken,
    ] as const;

    public readonly list = new ListViewElement();
    public readonly view: VFlexElement;
    /** Coordinate anchor for e2e. */
    public readonly listView: PaddingContainerElement;

    private readonly scrollBars: ScrollBarDecorator;

    private viewMode: ScmViewMode;
    private rowMeta = new Map<string, ScmRowMeta>();
    // The cascade resolves gitDecoration.* names, so no restyle is needed on theme change.
    private rowStyles: IScmRowStyles = {
        statusColors: Object.fromEntries(GIT_STATUS_COLOR_IDS.map((id) => [id, id])),
    };

    public constructor(
        private readonly changesService: ScmChangesService,
        private readonly commands: CommandRegistry,
        private readonly contextMenuService: ContextMenuService,
        private readonly stateService: IStateService,
        viewsService: ViewsService,
        scmInput: ScmInputComponent,
        icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        super();
        this.rowStyles = { ...this.rowStyles, nerdFont: icons.nerdFont };
        this.register(
            icons.onDidChange(() => {
                this.rowStyles = { ...this.rowStyles, nerdFont: icons.nerdFont };
                this.rebuild();
            }),
        );
        this.viewMode = this.stateService.get(SCM_VIEW_MODE_STATE);
        this.register(
            this.stateService.onDidOpenWorkspace(() => {
                this.restoreViewMode();
            }),
        );

        this.list.id = "changesList";
        this.scrollBars = new ScrollBarDecorator(this.list);
        this.listView = new PaddingContainerElement(this.scrollBars, { left: 1 });
        this.listView.id = "changesView";
        this.listView.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.list.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        // Commit controls live in the section body, not the container header (as in VS Code):
        // collapsing the section hides them too.
        this.view = new VFlexElement();
        this.view.id = "scmView";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.view.addChild(scmInput.view, { height: vflexFit(), width: "fill" });
        this.view.addChild(this.listView, { height: vflexFill(), width: "fill" });

        // The first section registers the container; GRAPH adds itself from its own component.
        viewsService.registerContainer({
            id: SCM_VIEWLET_ID,
            title: "SOURCE CONTROL",
            // Stryker disable next-line StringLiteral: ViewsService only checks "panel", anything else means sidebar
            location: "sidebar",
            order: 2,
            visibleContextKey: "scmViewletVisible",
        });
        viewsService.registerView({
            canMoveView: true,
            id: SCM_CHANGES_VIEW_ID,
            containerId: SCM_VIEWLET_ID,
            title: "CHANGES",
            order: 10,
            body: this.view,
            // Without a folder git does not activate, and the commit input would look functional
            // while doing nothing; an honest empty state instead.
            requiresWorkspaceFolder: true,
            placeholder: SCM_WELCOME,
            focus: () => {
                this.focus();
            },
            // Input + gap + button + padding: the default three rows per section are not enough.
            minBodyHeight: SCM_INPUT_HEIGHT + 3,
        });

        this.list.onActivate = (element) => {
            this.activateRow(listRowId(element));
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            const meta = this.rowMeta.get(listRowId(element));
            if (meta === undefined) return;
            this.showContextMenu(meta, screenX, screenY);
        };

        this.register(
            this.changesService.onDidChangeChanges(() => {
                this.rebuild();
            }),
        );
        this.rebuild();
    }

    public focus(): void {
        this.list.focus();
    }

    /** Target of SCM commands without an explicit uri argument. */
    public getCursorChange(): IScmChange | null {
        const id = this.list.getCursorElement()?.id;
        if (id === undefined) return null;
        const meta = this.rowMeta.get(id);
        return meta?.kind === "file" ? meta.change : null;
    }

    /** Empty selection means the row under the cursor; order is display order. */
    public getSelectedChanges(): readonly IScmChange[] {
        const changes: IScmChange[] = [];
        for (const element of this.list.getSelectedElements()) {
            const meta = this.rowMeta.get(listRowId(element));
            if (meta?.kind === "file") changes.push(meta.change);
        }
        return changes;
    }

    public getViewMode(): ScmViewMode {
        return this.viewMode;
    }

    public setViewMode(mode: ScmViewMode): void {
        if (mode === this.viewMode) return;
        this.viewMode = mode;
        this.stateService.store(SCM_VIEW_MODE_STATE, mode);
        this.rebuild();
    }

    /** Called after `openWorkspace`, without write-through. */
    public restoreViewMode(): void {
        const mode = this.stateService.get(SCM_VIEW_MODE_STATE);
        if (mode === this.viewMode) return;
        this.viewMode = mode;
        this.rebuild();
    }

    private activateRow(id: string): void {
        const meta = this.rowMeta.get(id);
        if (meta === undefined) return;
        if (meta.kind !== "file") {
            this.list.toggleCollapsed(id);
            return;
        }
        this.commands.execute("scm.action.openChanges", meta.change.uri.toString());
    }

    /**
     * Group collapse state survives the rebuild, the cursor returns to its row by id;
     * folder collapse state resets, by design (as search does on a new query).
     */
    private rebuild(): void {
        const cursorId = this.list.getCursorElement()?.id;
        const collapsedGroups = SCM_GROUP_IDS.filter((id) => this.list.isCollapsed(`scmGroup-${id}`));
        this.list.clear();
        this.rowMeta.clear();

        for (const group of groupChanges(this.changesService.changes)) {
            const groupRowId = `scmGroup-${group.id}`;
            this.list.appendRow(buildGroupRow(groupRowId, group.label, group.changes.length), {
                label: group.label,
            });
            this.rowMeta.set(groupRowId, { kind: "group", group: group.id, changes: group.changes });

            if (this.viewMode === "flat") {
                for (const change of sortChangesFlat(group.changes)) {
                    this.appendFileRow(change, displayPath(change), groupRowId);
                }
            } else {
                const emit = (nodes: readonly ScmTreeNode[], parentId: string): void => {
                    for (const node of nodes) {
                        if (node.kind === "folder") {
                            const id = this.uniqueRowId(`scmDir-${group.id}-${sanitizeIdSegment(node.path)}`);
                            this.list.appendRow(buildFolderRow(id, node.label), { parentId, label: node.label });
                            this.rowMeta.set(id, {
                                kind: "folder",
                                group: group.id,
                                changes: ChangesComponent.collectFiles(node.children),
                            });
                            emit(node.children, id);
                        } else {
                            this.appendFileRow(node.change, node.name, parentId);
                        }
                    }
                };
                emit(buildScmTree(group.changes), groupRowId);
            }
        }

        for (const id of collapsedGroups) this.list.setCollapsed(`scmGroup-${id}`, true);
        if (cursorId !== undefined && this.rowMeta.has(cursorId)) {
            this.list.setCursorTo(cursorId);
        }
    }

    /**
     * The id carries the entry's real group, not its header: untracked shows under "Changes"
     * but stays `scmRow-untracked-…`, so the selector tells the truth about the file.
     */
    private appendFileRow(change: IScmChange, label: string, parentId: string): void {
        const rowId = this.uniqueRowId(`scmRow-${change.group}-${sanitizeIdSegment(displayPath(change))}`);
        const parts = buildFileRow(rowId, change, label, this.rowStyles, () => {
            this.commands.execute("scm.action.openFile", change.uri.toString());
        });
        this.list.appendRow(parts.root, { parentId, label });
        this.rowMeta.set(rowId, { kind: "file", parts, change, label });
    }

    private uniqueRowId(base: string): string {
        if (!this.rowMeta.has(base)) return base;
        let n = 2;
        while (this.rowMeta.has(`${base}_${n}`)) n++;
        return `${base}_${n}`;
    }

    private static collectFiles(nodes: readonly ScmTreeNode[]): readonly IScmChange[] {
        const files: IScmChange[] = [];
        const walk = (level: readonly ScmTreeNode[]): void => {
            for (const node of level) {
                if (node.kind === "folder") walk(node.children);
                else files.push(node.change);
            }
        };
        walk(nodes);
        return files;
    }

    /**
     * Targets: a file in the selection → the whole selection, outside it → that row; folder → its files;
     * group header → the whole group (and its own menu point `ScmResourceGroupContext`).
     */
    private showContextMenu(meta: ScmRowMeta, screenX: number, screenY: number): void {
        let kind: ScmMenuContext["kind"];
        let targets: readonly IScmChange[];
        let menuId = MenuId.ScmContext;
        if (meta.kind === "file") {
            kind = "resource";
            const selected = this.getSelectedChanges();
            targets = selected.includes(meta.change) ? selected : [meta.change];
        } else if (meta.kind === "folder") {
            kind = "folder";
            targets = meta.changes;
        } else {
            kind = "group";
            targets = meta.changes;
            menuId = MenuId.ScmResourceGroupContext;
        }
        const context: ScmMenuContext = {
            kind,
            uris: targets.map((c) => c.uri.toString()),
            groups: [...new Set(targets.map((c) => c.group))],
        };
        this.contextMenuService.showContextMenu({
            getOwner: () => this.list,
            getAnchor: () => ({ screenX, screenY }),
            menuId,
            menuContext: context,
        });
    }
}
