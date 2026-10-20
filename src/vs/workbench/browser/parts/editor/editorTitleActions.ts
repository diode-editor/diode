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

/** Что панели действий группы нужно от workbench'а: меню, его контекст, попап «⋯» и настройка места. */
export interface IEditorTitleActionsServices {
    readonly menus: MenuService;
    readonly configuration: IConfigurationService;
    readonly contextKeys: ContextKeyService;
    readonly contextMenu: ContextMenuService;
}

/**
 * Панель действий справа от вкладок группы — `editor/title` эталона
 * (`EditorTabsControl` + `editorActionsToolbar`): пункты `MenuId.EditorTitle`
 * группы `navigation` с иконкой — кнопками, остальное — в попапе «⋯». Строка
 * — та же, что у полосы контролов в таб-строке панели
 * ({@link ViewContainerHeaderElement} без названия), правило разбора меню —
 * общее с заголовками view (`titleMenuEntries.ts`).
 *
 * Пере-резолвится по смене контекст-ключей и состава меню: `when` пунктов
 * (`config.claudeCode.useTerminal`, `claude-vscode.viewingProposedDiff`)
 * меняется без событий группы. Пустое меню панели не даёт — ряд вкладок
 * выглядит как раньше ({@link isVisible}). `workbench.editor.editorActionsLocation`:
 * `default` — в ряду вкладок; `hidden` и `titleBar` — панели нет (заголовка
 * окна у нас нет, как у эталона без своего title bar).
 */
export class EditorTitleActions extends Disposable {
    public readonly element: ViewContainerHeaderElement;

    private readonly onDidChangeVisibilityEmitter = this.register(new Emitter<void>());
    // Stryker disable next-line BooleanLiteral: начальное значение перезаписывает первый refresh конструктора — до подписки владельца, событие никто не слышит
    private visible = false;

    public constructor(
        private readonly groupId: GroupId,
        private readonly services: IEditorTitleActionsServices,
    ) {
        super();
        this.element = new ViewContainerHeaderElement("");
        this.element.id = `editorTitleActions-${String(groupId)}`;
        // Кнопки — мышью и командами; Tab по ним не ходит (у вкладок фокуса тоже нет).
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

    /** Есть ли что показать: без пунктов панель не занимает места в ряду вкладок. */
    public get isVisible(): boolean {
        return this.visible;
    }

    /** Панель появилась или пропала — владелец перекладывает ряд вкладок. */
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
        // Stryker disable next-line ConditionalExpression: лишнее событие — лишняя перекладка того же ряда вкладок, видимого следа нет
        if (visible === this.visible) return;
        this.visible = visible;
        this.onDidChangeVisibilityEmitter.fire();
    }
}
