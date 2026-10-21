import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IMenuEntryGroup } from "../../../../platform/actions/common/menuRegistry.ts";
import type { MenuService } from "../../../../platform/actions/common/menuService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { GroupId } from "../../../services/editor/browser/editorGroupModel.ts";
import type { EditorTitleBarMenuContext } from "../../actions/menuContexts.ts";
import { inlineActions, overflowEntries, runAction } from "../views/titleMenuEntries.ts";
import { ViewContainerHeaderElement } from "../views/viewContainerHeaderElement.ts";

const ACTIONS_LOCATION = "workbench.editor.editorActionsLocation";

export interface IEditorTitleActionsServices {
    readonly menus: MenuService;
    readonly configuration: IConfigurationService;
    readonly contextKeys: ContextKeyService;
    readonly contextMenu: ContextMenuService;
}

/**
 * Upstream `editor/title` (`EditorTabsControl` + `editorActionsToolbar`). Re-resolves on context
 * key changes, since item `when` clauses change without group events. With `hidden` and
 * `titleBar` there is no bar (we have no window title bar).
 */
export class EditorTitleActions extends Disposable {
    public readonly element: ViewContainerHeaderElement;

    private readonly onDidChangeVisibilityEmitter = this.register(new Emitter<void>());
    // Stryker disable next-line BooleanLiteral: the constructor's first refresh overwrites the initial value before the owner subscribes, so nobody hears the event
    private visible = false;

    public constructor(
        private readonly groupId: GroupId,
        private readonly services: IEditorTitleActionsServices,
    ) {
        super();
        this.element = new ViewContainerHeaderElement("");
        this.element.id = `editorTitleActions-${String(groupId)}`;
        // Buttons are for the mouse and commands; Tab skips them (tabs aren't focusable either).
        this.element.focusable = false;
        this.element.style = { fg: "descriptionForeground", bg: "editorGroupHeader.tabsBackground" };
        this.element.onAction = (actionId) => {
            runAction(this.groups(), actionId);
        };
        this.element.onMenu = (anchor) => {
            services.contextMenu.showContextMenu({
                getOwner: () => this.element,
                getAnchor: () => anchor,
                getEntries: () => overflowEntries(this.groups()),
            });
        };
        const menu = this.register(services.menus.createMenu(MenuId.EditorTitle));
        this.register(
            menu.onDidChange(() => {
                this.refresh();
            }),
        );
        this.register(
            services.contextKeys.onDidChange(() => {
                this.refresh();
            }),
        );
        this.register(
            services.configuration.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration(ACTIONS_LOCATION)) this.refresh();
            }),
        );
        this.refresh();
    }

    public get isVisible(): boolean {
        return this.visible;
    }

    public readonly onDidChangeVisibility = this.onDidChangeVisibilityEmitter.event;

    private groups(): IMenuEntryGroup[] {
        const context: EditorTitleBarMenuContext = { groupId: this.groupId };
        return this.services.menus.getEntryGroups(MenuId.EditorTitle, context);
    }

    private refresh(): void {
        const groups = this.services.configuration.get(ACTIONS_LOCATION) === "default" ? this.groups() : [];
        const actions = inlineActions(groups);
        const hasMenu = overflowEntries(groups).length > 0;
        this.element.setActions(actions);
        this.element.setMenuVisible(hasMenu);
        const visible = actions.length > 0 || hasMenu;
        // Stryker disable next-line ConditionalExpression: an extra event only re-lays out the same tab row, with no visible effect
        if (visible === this.visible) return;
        this.visible = visible;
        this.onDidChangeVisibilityEmitter.fire();
    }
}
