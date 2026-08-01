import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { ListViewElement } from "../../../../../../tuidom/ui/list/listViewElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TitledPanelElement } from "../../../../../../tuidom/ui/titledpanel/titledPanelElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { ScmMenuContext } from "../../../browser/actions/menuContexts.ts";
import { Component } from "../../../browser/component.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SCM_VIEW_MODE_STATE, type ScmViewMode } from "../../../common/stateKeys.ts";
import {} from "../../../services/themes/common/themeTokens.ts";

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
 * строки — `scm.action.openFile`, правый клик/Shift+F10 поднимают контекстное
 * меню `MenuId.ScmContext` через `ContextMenuService` (делегат, как у Explorer).
 *
 * Место в сайдбаре (а не в нижней Panel) — как в VS Code: у нас нет activity bar,
 * поэтому Explorer ↔ Source Control переключают команды (`workbench.view.*`),
 * а сам показ — подмена контента сайдбара через {@link SidebarService}.
 */
export class ChangesComponent extends Component {
    public static dependencies = [
        ScmChangesServiceDIToken,
        CommandRegistryDIToken,
        ContextMenuServiceDIToken,
        StateServiceDIToken,
    ] as const;

    /** Список изменений — доступен тестам и оркестрации (фокус, inspectState). */
    public readonly list = new ListViewElement();
    /** Корневой контрол вьюлета (рамка SOURCE CONTROL); вкидывается в сайдбар. */
    public readonly view: TitledPanelElement;

    private readonly scrollBars: ScrollBarDecorator;

    private viewMode: ScmViewMode;
    private rowMeta = new Map<string, ScmRowMeta>();
    // Токены темы: строки красятся именами gitDecoration.* — резолвит каскад,
    // рестайл на смену темы не нужен.
    private readonly rowStyles: IScmRowStyles = {
        statusColors: Object.fromEntries(GIT_STATUS_COLOR_IDS.map((id) => [id, id])),
        dimFg: "descriptionForeground",
    };

    public constructor(
        private readonly changesService: ScmChangesService,
        private readonly commands: CommandRegistry,
        private readonly contextMenuService: ContextMenuService,
        private readonly stateService: IStateService,
    ) {
        super();
        this.viewMode = this.stateService.get(SCM_VIEW_MODE_STATE);

        this.list.id = "changesList";
        this.scrollBars = new ScrollBarDecorator(this.list);
        this.view = new TitledPanelElement(
            "  SOURCE CONTROL",
            new PaddingContainerElement(this.scrollBars, { left: 1 }),
        );
        this.view.id = "changesView";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.list.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        this.list.onActivate = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.activateRow(element.id!);
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            const meta = this.rowMeta.get(element.id!);
            // Для папок пункты меню бессмысленны — меню только у файловых строк.
            if (meta?.kind !== "file") return;
            this.showContextMenu(meta.change.uri.toString(), screenX, screenY);
        };

        this.register(
            this.changesService.onDidChangeChanges(() => {
                this.rebuild();
            }),
        );
        this.rebuild();
    }

    /** Focuses the changes list (used by the "Show Source Control" command). */
    public focus(): void {
        this.list.focus();
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
        this.rowMeta.set(parts.root.id!, { kind: "file", parts, change, label });
    }

    /** Контекстное меню файловой строки — делегат ContextMenuService (как у Explorer). */
    private showContextMenu(uri: string, screenX: number, screenY: number): void {
        const context: ScmMenuContext = { uri };
        this.contextMenuService.showContextMenu({
            getOwner: () => this.list,
            getAnchor: () => ({ screenX, screenY }),
            menuId: MenuId.ScmContext,
            menuContext: context,
        });
    }
}
