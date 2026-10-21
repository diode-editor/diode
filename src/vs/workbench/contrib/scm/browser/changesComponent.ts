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

/** Как в эталоне, минус клон: команды клонирования у нас нет. */
const SCM_WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "To use source control, open a folder containing a Git repository." },
    { kind: "text", text: "" },
    { kind: "button", label: "Open Folder", command: "workbench.action.files.openFolder" },
];

type ScmRowMeta =
    | { readonly kind: "file"; readonly parts: IScmFileRowParts; readonly change: IScmChange; readonly label: string }
    | { readonly kind: "folder"; readonly group: ScmGroupId; readonly changes: readonly IScmChange[] }
    | { readonly kind: "group"; readonly group: ScmGroupId; readonly changes: readonly IScmChange[] };

/** e2e-селектор `#id` матчит только `[A-Za-z0-9_-]`; коллизии ("a.b" ↔ "a-b") разводит суффикс. */
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
    ] as const;

    public readonly list = new ListViewElement();
    public readonly view: VFlexElement;
    /** Якорь координат для e2e. */
    public readonly listView: PaddingContainerElement;

    private readonly scrollBars: ScrollBarDecorator;

    private viewMode: ScmViewMode;
    private rowMeta = new Map<string, ScmRowMeta>();
    // Имена gitDecoration.* резолвит каскад — рестайл на смену темы не нужен.
    private readonly rowStyles: IScmRowStyles = {
        statusColors: Object.fromEntries(GIT_STATUS_COLOR_IDS.map((id) => [id, id])),
    };

    public constructor(
        private readonly changesService: ScmChangesService,
        private readonly commands: CommandRegistry,
        private readonly contextMenuService: ContextMenuService,
        private readonly stateService: IStateService,
        viewsService: ViewsService,
        scmInput: ScmInputComponent,
    ) {
        super();
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

        // Контролы коммита — в теле секции, а не шапкой контейнера (как в VS Code):
        // свернул секцию — убрались и они.
        this.view = new VFlexElement();
        this.view.id = "scmView";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.view.addChild(scmInput.view, { height: vflexFit(), width: "fill" });
        this.view.addChild(this.listView, { height: vflexFill(), width: "fill" });

        // Контейнер регистрирует первая секция; GRAPH записывается в него из своего компонента.
        viewsService.registerContainer({
            id: SCM_VIEWLET_ID,
            title: "SOURCE CONTROL",
            // Stryker disable next-line StringLiteral: ViewsService различает только "panel"; любое другое значение (в том числе испорченное) уходит в сайдбар, так что подмена строки наблюдаемого эффекта не имеет
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
            // Без папки git не активируется, и поле коммита выглядело бы рабочим,
            // ничего не делая, — честное пустое состояние вместо этого.
            requiresWorkspaceFolder: true,
            placeholder: SCM_WELCOME,
            focus: () => {
                this.focus();
            },
            // Поле + зазор + кнопка + padding: дефолтных трёх строк на секцию не хватает.
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

    /** Цель SCM-команд без явного uri-аргумента. */
    public getCursorChange(): IScmChange | null {
        const id = this.list.getCursorElement()?.id;
        if (id === undefined) return null;
        const meta = this.rowMeta.get(id);
        return meta?.kind === "file" ? meta.change : null;
    }

    /** Пустое выделение — строка под курсором; порядок — как в показе. */
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

    /** Зовётся после `openWorkspace`, без write-through. */
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
     * Свёрнутость групп переживает пересборку, курсор возвращается на строку по id;
     * свёрнутость папок сбрасывается — принято (как у поиска при новом запросе).
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
     * Id несёт настоящую группу записи, а не заголовок: untracked едет под «Changes»,
     * но остаётся `scmRow-untracked-…` — селектор говорит правду о файле.
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
     * Цели: файл в выделении → всё выделение, вне его — одна строка; папка → её файлы;
     * заголовок группы → вся группа (и своя точка меню `ScmResourceGroupContext`).
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
