import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { ListViewElement } from "../../../../../../tuidom/ui/list/listViewElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
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
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { SCM_VIEW_MODE_STATE, type ScmViewMode } from "../../../common/stateKeys.ts";
import {} from "../../../services/themes/common/themeTokens.ts";

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

/** Id вьюлета Source Control в сайдбаре (см. {@link SidebarService}). */
export const SCM_VIEWLET_ID = "scm";

/** Id view-секции CHANGES внутри контейнера Source Control (см. {@link ViewsService}). */
export const SCM_CHANGES_VIEW_ID = "workbench.scm.changes";

export const ChangesComponentDIToken = token<ChangesComponent>("ChangesComponent");

/** Метаданные строки списка — мост «id строки → модель» (как rowMeta у поиска). */
type ScmRowMeta =
    | { readonly kind: "file"; readonly parts: IScmFileRowParts; readonly change: IScmChange; readonly label: string }
    | { readonly kind: "folder"; readonly group: ScmGroupId; readonly changes: readonly IScmChange[] }
    | { readonly kind: "group"; readonly group: ScmGroupId; readonly changes: readonly IScmChange[] };

/**
 * Санитизация в id-алфавит строк списка (`[A-Za-z0-9_-]`): e2e-селектор `#id`
 * другого не матчит. Коллизии ("a.b" ↔ "a-b") разводит {@link ChangesComponent}
 * суффиксом.
 */
function sanitizeIdSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]+/g, "-");
}

/**
 * View-секция **CHANGES** контейнера Source Control в сайдбаре: список
 * изменённых файлов на виртуализирующем {@link ListViewElement}. Регистрирует
 * себя в {@link ViewsService} (контейнер собирает и вешает в сайдбар
 * `WorkbenchComponent.setWorkspaceFolder`). Потребитель
 * {@link ScmChangesService}, набор в который пушит SCM-расширение.
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
        ViewsServiceDIToken,
    ] as const;

    /** Список изменений — доступен тестам и оркестрации (фокус, inspectState). */
    public readonly list = new ListViewElement();
    /** Тело view-секции CHANGES — вкидывается в контейнер через ViewsService. */
    public readonly view: PaddingContainerElement;

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
        viewsService: ViewsService,
    ) {
        super();
        this.viewMode = this.stateService.get(SCM_VIEW_MODE_STATE);

        this.list.id = "changesList";
        this.scrollBars = new ScrollBarDecorator(this.list);
        this.view = new PaddingContainerElement(this.scrollBars, { left: 1 });
        this.view.id = "changesView";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.list.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        viewsService.registerView({
            id: SCM_CHANGES_VIEW_ID,
            containerId: SCM_VIEWLET_ID,
            title: "CHANGES",
            order: 10,
            body: this.view,
            focus: () => this.focus(),
        });

        this.list.onActivate = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.activateRow(element.id!);
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            const meta = this.rowMeta.get(element.id!);
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

    /**
     * Файловые записи текущего выделения списка (multi-select; пустое выделение —
     * строка под курсором) в порядке показа — цели групповых staging-команд.
     */
    public getSelectedChanges(): readonly IScmChange[] {
        const changes: IScmChange[] = [];
        for (const element of this.list.getSelectedElements()) {
            // Список не принимает строки без id — здесь он гарантированно есть.
            const meta = this.rowMeta.get(element.id!);
            if (meta?.kind === "file") changes.push(meta.change);
        }
        return changes;
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

    /** Активация строки: заголовок группы и папка сворачиваются, файл открывает дифф. */
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
     * Пересобирает строки из снимка {@link ScmChangesService} (publish, смена
     * режима, restore). Строки секционированы группами ресурсов
     * ({@link groupChanges}); свёрнутость групп переживает пересборку (снимок до
     * `clear()`), курсор возвращается на прежнюю строку по id. Свёрнутость папок
     * при этом сбрасывается — принято (как у поиска при новом запросе).
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
                    this.appendFileRow(group.id, change, displayPath(change), groupRowId);
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
                            this.appendFileRow(group.id, node.change, node.name, parentId);
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

    private appendFileRow(group: ScmGroupId, change: IScmChange, label: string, parentId: string): void {
        const rowId = this.uniqueRowId(`scmRow-${group}-${sanitizeIdSegment(displayPath(change))}`);
        const parts = buildFileRow(rowId, change, label, this.rowStyles, () => {
            this.commands.execute("scm.action.openFile", change.uri.toString());
        });
        this.list.appendRow(parts.root, { parentId, label });
        this.rowMeta.set(rowId, { kind: "file", parts, change, label });
    }

    /** Разводит коллизии санитизации ("a.b" ↔ "a-b") числовым суффиксом. */
    private uniqueRowId(base: string): string {
        if (!this.rowMeta.has(base)) return base;
        let n = 2;
        while (this.rowMeta.has(`${base}_${n}`)) n++;
        return `${base}_${n}`;
    }

    /** Собирает файлы поддерева (для будущих операций над папкой целиком). */
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
     * Контекстное меню строки — делегат ContextMenuService (как у Explorer).
     * Цели: файловая строка в текущем выделении → всё выделение, вне его — одна
     * строка; папка → её файлы; заголовок группы → вся группа (и своя точка меню
     * `ScmResourceGroupContext`).
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
