import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import type { TabInfo } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFit } from "@tuidom/elements/layout/hFlexElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";
import type { EditorTitleMenuContext } from "../../actions/menuContexts.ts";
import { Component } from "../../component.ts";

import { EditorTitleActions, type IEditorTitleActionsServices } from "./editorTitleActions.ts";
import { computeTabLabels } from "./tabLabels.ts";
import { TextEditorPane } from "./textEditorPane.ts";

/**
 * An empty slot holds a filler; in an empty group it is focusable, so "focus in the group"
 * exists without tabs (US-4/47). Any focus in the subtree makes the group active.
 */
export class EditorGroupComponent extends Component {
    public readonly view: OverlayHostElement;

    private readonly vflex = new VFlexElement();
    private readonly tabStrip = new EditorTabStripElement();
    private readonly titleRow = new HFlexElement();
    private readonly titleActions: EditorTitleActions | null;
    private readonly emptyFiller = new FillerElement();
    private contentSlot: TUIElement;

    public constructor(
        public readonly group: EditorGroup,
        private readonly editorService: IEditorService,
        private readonly contextMenuService: ContextMenuService,
        private readonly groups: IEditorGroupsService,
        titleActions?: IEditorTitleActionsServices,
    ) {
        super();
        this.titleActions =
            titleActions === undefined ? null : this.register(new EditorTitleActions(group, titleActions));
        this.titleRow.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.view = new OverlayHostElement();
        // Group id, not ViewColumn: column numbers are recomputed when groups collapse.
        this.view.id = `editorGroup-${String(group.id)}`;
        // emptyFiller inherits the background through the cascade.
        this.view.style = { fg: "editor.foreground", bg: "editor.background" };
        this.tabStrip.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.contentSlot = this.emptyFiller;
        this.syncSlot(this.emptyFiller);
        this.view.setContent(this.vflex);
        // Capture: runs before nested widgets handle the focus.
        this.view.addEventListener(
            "focus",
            () => {
                this.groups.notifyGroupFocused(this.group);
            },
            { capture: true },
        );
        this.tabStrip.onTabActivate = (index) => {
            this.group.activateTab(index);
        };
        this.tabStrip.onTabClose = (index) => {
            // Only the document's last surface gets a dialog; the service decides that.
            void this.editorService.closeEditor(this.group, index);
        };
        this.tabStrip.onTabContextMenu = (index, screenX, screenY) => {
            this.showTabContextMenu(index, screenX, screenY);
        };
        this.register(
            this.group.onDidChangeEditors(() => {
                this.syncFromGroup();
            }),
        );
        if (this.titleActions !== null) {
            this.register(
                this.titleActions.onDidChangeVisibility(() => {
                    this.syncSlot(this.contentSlot);
                }),
            );
        }
        this.syncFromGroup();
    }

    public focusContent(): void {
        const pane = this.group.activePane;
        if (pane !== null) pane.focusEditor();
        else this.emptyFiller.focus();
    }

    /**
     * Targets the tab UNDER THE POINTER without changing the active one (like VS Code), so its
     * address goes into `menuContext`, where the items take their arguments and visibility from.
     */
    private showTabContextMenu(index: number, screenX: number, screenY: number): void {
        const panes = this.group.getPanes();
        const pane = panes.at(index);
        /* v8 ignore start -- the index comes from the tab strip and always points to an existing tab */
        // Stryker disable next-line ConditionalExpression: unreachable for the same reason as for coverage
        if (pane === undefined) return;
        /* v8 ignore stop */
        const menuContext: EditorTitleMenuContext = {
            groupId: this.group.id,
            index,
            path: pane instanceof TextEditorPane ? pane.absoluteFilePath : null,
            resourceScheme: pane.uri.scheme,
            tabCount: panes.length,
            hasTabsToTheRight: index < panes.length - 1,
            hasSavedTabs: panes.some((candidate) => !candidate.isModified),
            isPreview: !this.group.isPinned(pane),
        };
        this.contextMenuService.showContextMenu({
            getOwner: () => this.view,
            getAnchor: () => ({ screenX, screenY }),
            menuId: MenuId.EditorTitleContext,
            menuContext,
        });
    }

    private syncSlot(slot: TUIElement): void {
        slot.layoutStyle = { height: vflexFill(), width: "fill" };
        this.vflex.replaceChildren([this.syncTitleRow(), slot]);
        this.contentSlot = slot;
    }

    /** With an empty action bar the tab strip is used as is (same tree and frame as without the bar). */
    private syncTitleRow(): TUIElement {
        if (this.titleActions?.isVisible !== true) {
            this.tabStrip.layoutStyle = { height: vflexFixed(1), width: "fill" };
            return this.tabStrip;
        }
        this.tabStrip.layoutStyle = { height: 1, width: hflexFill() };
        this.titleActions.element.layoutStyle = { height: 1, width: hflexFit() };
        this.titleRow.replaceChildren([this.tabStrip, this.titleActions.element]);
        return this.titleRow;
    }

    private syncFromGroup(): void {
        const activeView = this.group.activePane?.view ?? null;
        const next = activeView ?? this.emptyFiller;
        // An empty group is a valid focus target (Ctrl+P opens the file into it).
        this.emptyFiller.focusable = this.group.editorCount === 0;
        // replaceChildren reparents, and onDidChangeEditors fires more often than
        // the active tab changes.
        if (this.contentSlot !== next) {
            this.syncSlot(next);
        }
        this.syncTabs();
    }

    private syncTabs(): void {
        const editors = this.group.getPanes();
        const labels = computeTabLabels(editors, (editor) => this.editorService.displayName(editor));
        const tabs: TabInfo[] = editors.map((editor, i) => {
            const fi = getFileIcon(this.editorService.displayName(editor));
            return {
                label: labels[i],
                icon: fi.icon,
                iconColor: fi.color,
                isModified: editor.isModified,
                isReadOnly: editor.readOnly,
                isDeleted: editor.isOrphaned === true,
            };
        });

        this.tabStrip.setTabs(tabs);
        this.tabStrip.activeIndex = this.group.activeIndex;
    }
}
