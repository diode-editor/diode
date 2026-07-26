import type { BodyElement } from "../../../../../../tuidom/ui/body/bodyElement.ts";
import type { OverlaySessionHandle } from "../../../../../../tuidom/ui/contextview/overlayLayer.ts";
import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { ListViewElement } from "../../../../../../tuidom/ui/list/listViewElement.ts";
import type { MenuEntry } from "../../../../../../tuidom/ui/menu/popupMenuElement.ts";
import { PopupMenuElement } from "../../../../../../tuidom/ui/menu/popupMenuElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TitledPanelElement } from "../../../../../../tuidom/ui/titledpanel/titledPanelElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IMenu, MenuService } from "../../../../platform/actions/common/menuService.ts";
import { MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import {
    getListViewStyles,
    getMenuStyles,
    getScrollBarStyles,
} from "../../../../platform/theme/browser/defaultStyles.ts";
import type { ScmMenuContext } from "../../../browser/actions/menuContexts.ts";
import { ThemedComponent } from "../../../browser/component.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SCM_VIEW_MODE_STATE, type ScmViewMode } from "../../../common/stateKeys.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import type { IScmChange, ScmChangesService } from "./changesService.ts";
import { ScmChangesServiceDIToken } from "./changesService.ts";
import {
    buildFileRow,
    buildFolderRow,
    formatFileRow,
    GIT_STATUS_COLOR_IDS,
    type IScmFileRowParts,
    type IScmRowStyles,
} from "./scmChangeRows.ts";
import { buildScmTree, displayPath, type ScmTreeNode, sortChangesFlat } from "./scmChangeTree.ts";

/** Id вьюлета Source Control в сайдбаре (см. {@link SidebarService}). */
export const SCM_VIEWLET_ID = "scm";

export const ChangesComponentDIToken = token<ChangesComponent>("ChangesComponent");

/** Метаданные строки списка — мост «id строки → модель» (как rowMeta у поиска). */
type ScmRowMeta =
    | { readonly kind: "file"; readonly parts: IScmFileRowParts; readonly change: IScmChange; readonly label: string }
    | { readonly kind: "folder" };

/**
 * Вьюлет **Source Control** в сайдбаре: список изменённых файлов на
 * виртуализирующем {@link ListViewElement} под рамкой SOURCE CONTROL — параллель
 * Explorer'у. Потребитель {@link ScmChangesService}, набор в который пушит
 * SCM-расширение.
 *
 * Строки собирает {@link buildFileRow}/{@link buildFolderRow}; режимы плоско/
 * дерево ({@link setViewMode}, персист по-проектно) отличаются только эмиссией:
 * flat — отсортированные пути без parentId, tree — pre-order обход
 * {@link buildScmTree} с компакт-папками. Активация файла исполняет
 * `scm.action.openChanges` (прямой дифф без промежуточной вкладки), инлайн-глиф
 * строки — `scm.action.openFile`, правый клик поднимает контекстное меню
 * `MenuId.ScmContext` в overlay-слое хоста (его прикрепляет владелец корневой
 * view через {@link attachHost}, как у Explorer).
 *
 * Место в сайдбаре (а не в нижней Panel) — как в VS Code: у нас нет activity bar,
 * поэтому Explorer ↔ Source Control переключают команды (`workbench.view.*`),
 * а сам показ — подмена контента сайдбара через {@link SidebarService}.
 */
export class ChangesComponent extends ThemedComponent {
    public static dependencies = [
        ScmChangesServiceDIToken,
        CommandRegistryDIToken,
        MenuServiceDIToken,
        StateServiceDIToken,
        ThemeServiceDIToken,
    ] as const;

    /** Список изменений — доступен тестам и оркестрации (фокус, inspectState). */
    public readonly list = new ListViewElement();
    /** Корневой контрол вьюлета (рамка SOURCE CONTROL); вкидывается в сайдбар. */
    public readonly view: TitledPanelElement;

    private readonly scrollBars: ScrollBarDecorator;
    private readonly contextMenu: IMenu;
    private host: BodyElement | null = null;
    private contextMenuSession: OverlaySessionHandle | null = null;

    private viewMode: ScmViewMode;
    private rowMeta = new Map<string, ScmRowMeta>();
    private rowStyles: IScmRowStyles = { statusColors: {}, dimFg: 0 };

    public constructor(
        private readonly changesService: ScmChangesService,
        private readonly commands: CommandRegistry,
        menuService: MenuService,
        private readonly stateService: IStateService,
        themeService: ThemeService,
    ) {
        super(themeService);
        this.viewMode = this.stateService.get(SCM_VIEW_MODE_STATE);
        this.contextMenu = this.register(menuService.createMenu(MenuId.ScmContext));

        this.list.id = "changesList";
        this.scrollBars = new ScrollBarDecorator(this.list);
        this.view = new TitledPanelElement(
            "  SOURCE CONTROL",
            new PaddingContainerElement(this.scrollBars, { left: 1 }),
        );
        this.view.id = "changesView";

        this.list.onActivate = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.activateRow(element.id as string);
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            const meta = this.rowMeta.get(element.id as string);
            // Для папок пункты меню бессмысленны — меню только у файловых строк.
            if (meta?.kind !== "file") return;
            this.showContextMenu(meta.change.uri.toString(), screenX, screenY);
        };

        this.register(
            this.changesService.onDidChangeChanges(() => {
                this.rebuild();
            }),
        );
        this.initStyles();
        this.rebuild();
    }

    /** Focuses the changes list (used by the "Show Source Control" command). */
    public focus(): void {
        this.list.focus();
    }

    /**
     * Прикрепляет хост с overlay-слоем (корневую BodyElement-view приложения) —
     * в нём открываются popup-сессии контекстного меню. Зовёт владелец корневой
     * view (WorkbenchComponent), как у Explorer.
     */
    public attachHost(host: BodyElement): void {
        this.host = host;
    }

    /** Изменение под курсором списка — цель SCM-команд без явного uri-аргумента. */
    public getCursorChange(): IScmChange | null {
        const id = this.list.getCursorElement()?.id;
        if (id === undefined) return null;
        const meta = this.rowMeta.get(id);
        return meta?.kind === "file" ? meta.change : null;
    }

    public getViewMode(): ScmViewMode {
        return this.viewMode;
    }

    /** Переключает вид плоско/дерево, пересобирая строки из снимка сервиса. */
    public setViewMode(mode: ScmViewMode): void {
        if (mode === this.viewMode) return;
        this.viewMode = mode;
        this.stateService.store(SCM_VIEW_MODE_STATE, mode);
        this.rebuild();
    }

    /** Восстанавливает вид из workspace-стора (зовётся после `openWorkspace`, без write-through). */
    public restoreViewMode(): void {
        const mode = this.stateService.get(SCM_VIEW_MODE_STATE);
        if (mode === this.viewMode) return;
        this.viewMode = mode;
        this.rebuild();
    }

    /** Активация строки: папка сворачивается, файл открывает дифф. */
    private activateRow(id: string): void {
        const meta = this.rowMeta.get(id);
        if (meta === undefined) return;
        if (meta.kind === "folder") {
            this.list.toggleCollapsed(id);
            return;
        }
        this.commands.execute("scm.action.openChanges", meta.change.uri.toString());
    }

    /**
     * Пересобирает строки из снимка {@link ScmChangesService} (publish, смена
     * режима, restore). Курсор возвращается на прежнюю строку по id, если она
     * пережила пересборку; свёрнутость папок при этом сбрасывается — принято
     * (как у поиска при новом запросе).
     */
    private rebuild(): void {
        const cursorId = this.list.getCursorElement()?.id;
        this.list.clear();
        this.rowMeta.clear();

        const changes = this.changesService.changes;
        if (this.viewMode === "flat") {
            for (const change of sortChangesFlat(changes)) {
                this.appendFileRow(change, displayPath(change), undefined);
            }
        } else {
            const emit = (nodes: readonly ScmTreeNode[], parentId: string | undefined): void => {
                for (const node of nodes) {
                    if (node.kind === "folder") {
                        const id = `dir:${node.path}`;
                        this.list.appendRow(buildFolderRow(id, node.label), { parentId, label: node.label });
                        this.rowMeta.set(id, { kind: "folder" });
                        emit(node.children, id);
                    } else {
                        this.appendFileRow(node.change, node.name, parentId);
                    }
                }
            };
            emit(buildScmTree(changes), undefined);
        }

        if (cursorId !== undefined && this.rowMeta.has(cursorId)) {
            this.list.setCursorTo(cursorId);
        }
    }

    private appendFileRow(change: IScmChange, label: string, parentId: string | undefined): void {
        const parts = buildFileRow(change, label, this.rowStyles, () => {
            this.commands.execute("scm.action.openFile", change.uri.toString());
        });
        this.list.appendRow(parts.root, { parentId, label });
        this.rowMeta.set(parts.root.id as string, { kind: "file", parts, change, label });
    }

    /** Калька showContextMenu Explorer'а: PopupMenu в overlay-слое хоста. */
    private showContextMenu(uri: string, screenX: number, screenY: number): void {
        if (!this.host) return;
        const host = this.host;
        this.hideContextMenu();

        const context: ScmMenuContext = { uri };
        const entries: MenuEntry[] = this.contextMenu.getEntries(context).map((entry) => {
            if (entry.type === "separator" || entry.type === "submenu") return entry;
            const original = entry.onSelect;
            return {
                ...entry,
                onSelect: () => {
                    this.hideContextMenu();
                    original?.();
                },
            };
        });

        const menu = new PopupMenuElement(entries);
        menu.setStyles(getMenuStyles(this.theme));
        menu.tabIndex = 0;

        let session: OverlaySessionHandle | null = null;
        session = host.overlayLayer.openPopupSession(
            menu,
            { screenX, screenY },
            {
                visible: true,
                restoreFocus: true,
                focusOnOpen: true,
                closeOnEscape: true,
                pointerPolicy: "close-on-outside",
                disposeOnClose: true,
                onClose: () => {
                    // Через hideContextMenu поле уже занулено до close() — не трогаем
                    // (там может быть уже открыта следующая сессия).
                    if (this.contextMenuSession === session) {
                        this.contextMenuSession = null;
                    }
                },
            },
        );

        menu.onClose = () => {
            session.close();
        };

        this.contextMenuSession = session;
    }

    private hideContextMenu(): void {
        if (!this.contextMenuSession) return;
        const session = this.contextMenuSession;
        this.contextMenuSession = null;
        // Именно close(), не dispose(): close восстанавливает сохранённый фокус
        // (restoreFocus), а disposeOnClose доведёт teardown до конца.
        session.close();
    }

    protected updateStyles(): void {
        const colors: Record<string, number> = {};
        for (const id of GIT_STATUS_COLOR_IDS) colors[id] = this.theme.getRequiredColor(id);
        this.rowStyles = { statusColors: colors, dimFg: this.theme.getRequiredColor("descriptionForeground") };

        this.list.setStyles(getListViewStyles(this.theme));
        this.list.style = {
            fg: this.theme.getRequiredColor("sideBar.foreground"),
            bg: this.theme.getRequiredColor("sideBar.background"),
        };
        this.scrollBars.setStyles(getScrollBarStyles(this.theme, "sideBar.background"));
        this.view.style = {
            fg: this.theme.getRequiredColor("sideBar.foreground"),
            bg: this.theme.getRequiredColor("sideBar.background"),
        };

        // Смена темы перекрашивает строки на месте — пересборка не нужна.
        for (const meta of this.rowMeta.values()) {
            if (meta.kind === "file") formatFileRow(meta.parts, meta.change, meta.label, this.rowStyles);
        }
    }
}
