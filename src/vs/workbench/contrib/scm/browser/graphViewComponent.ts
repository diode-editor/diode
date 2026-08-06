import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { ListViewElement } from "../../../../../../tuidom/ui/list/listViewElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import type { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ScmGraphMenuContext } from "../../../browser/actions/menuContexts.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { renderCommitGraph } from "../common/commitGraph.ts";
import { createGraphPalette } from "../common/commitGraphPalette.ts";

import { SCM_VIEWLET_ID } from "./changesComponent.ts";
import type { IScmCommit, ScmGraphService } from "./graphService.ts";
import { ScmGraphServiceDIToken } from "./graphService.ts";
import { applyGraphLine, buildCommitRow, buildLoadMoreRow, LOAD_MORE_ROW_ID } from "./scmGraphRows.ts";

/** Id view-секции GRAPH внутри контейнера Source Control (см. {@link ViewsService}). */
export const SCM_GRAPH_VIEW_ID = "workbench.scm.graph";

/**
 * Догрузка следующей страницы истории. Id живёт здесь, а не рядом с самим
 * экшеном (`graphActions.ts`): экшену нужен id секции отсюда, и объявление в
 * обе стороны замкнуло бы импорты в цикл.
 */
export const GRAPH_LOAD_MORE_COMMAND = "scm.graph.loadMore";

export const GraphViewComponentDIToken = token<GraphViewComponent>("GraphViewComponent");

/**
 * Графовые лейблы строк в порядке коммитов — их перекрашивает смена выделения.
 * Параллельны снимку сервиса, поэтому индексируются им же, а не sha: один и тот
 * же коммит `git log` печатает дважды, когда в него приходят две ветки.
 */
type GraphLabels = TextLabelElement[];

/**
 * View-секция **GRAPH** контейнера Source Control: история репозитория с
 * настоящим графом ветвлений. Укладку считает порт lazygit
 * ({@link renderCommitGraph}), данные приходят снимком {@link ScmGraphService}
 * (публикует git-расширение), команды на коммите — меню
 * {@link MenuId.ScmGraphContext}.
 *
 * Страница ограничена (`scm.graph.pageSize`); пока история продолжается, под
 * списком стоит строка «Load More…».
 */
export class GraphViewComponent extends Component {
    public static dependencies = [
        ScmGraphServiceDIToken,
        ViewsServiceDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    /** Список коммитов — доступен тестам и оркестрации (фокус, inspectState). */
    public readonly list = new ListViewElement();
    /** Тело view-секции GRAPH — вкидывается в контейнер через ViewsService. */
    public readonly view: PaddingContainerElement;

    private graphLabels: GraphLabels = [];
    /** sha → коммит: цель команд контекстного меню. */
    private readonly commitsBySha = new Map<string, IScmCommit>();
    /** Коммит, чьи линии подсвечены, — курсор списка. */
    private selectedSha: string | null = null;

    public constructor(
        private readonly graphService: ScmGraphService,
        viewsService: ViewsService,
        private readonly contextMenuService: ContextMenuService,
        private readonly commands: CommandRegistry,
    ) {
        super();
        this.list.id = "scmGraphList";
        this.view = new PaddingContainerElement(new ScrollBarDecorator(this.list), { left: 1 });
        this.view.id = "graphView";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.list.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        viewsService.registerView({
            id: SCM_GRAPH_VIEW_ID,
            containerId: SCM_VIEWLET_ID,
            title: "GRAPH",
            order: 20,
            body: this.view,
            focus: () => this.focus(),
        });

        this.list.onSelect = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.setSelected(element.id!);
        };
        this.list.onActivate = (element) => {
            // Строка догрузки — единственная активируемая: у коммитов действия
            // живут в контекстном меню.
            if (element.id === LOAD_MORE_ROW_ID) void this.commands.execute(GRAPH_LOAD_MORE_COMMAND);
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            const commit = this.commitsBySha.get(element.id!);
            if (commit === undefined) return;
            this.showContextMenu(commit, screenX, screenY);
        };

        this.register(
            this.graphService.onDidChangeCommits(() => {
                this.rebuild();
            }),
        );
        this.rebuild();
    }

    public focus(): void {
        this.list.focus();
    }

    /**
     * Пересобирает строки из снимка сервиса. Курсор возвращается на прежнюю
     * строку по id, если она пережила публикацию (как у вкладки Changes).
     */
    private rebuild(): void {
        const cursorId = this.list.getCursorElement()?.id;
        this.list.clear();
        this.commitsBySha.clear();
        this.graphLabels = [];

        const commits = this.graphService.commits;
        // Коммит выделения мог уехать из страницы — иначе подсветка залипнет.
        if (!commits.some((c) => c.sha === this.selectedSha)) this.selectedSha = null;
        const palette = createGraphPalette(commits);
        const lines = renderCommitGraph(commits, this.selectedSha, palette.styleFor);

        let lastGraphWidth = 0;
        for (let i = 0; i < commits.length; i++) {
            const commit = commits[i];
            // Цвет бейджей — цвет дорожки коммита, известный уже после укладки.
            const parts = buildCommitRow(commit, lines[i], palette.colorOf(commit.sha));
            this.list.appendRow(parts.root, { label: commit.subject });
            this.commitsBySha.set(commit.sha, commit);
            this.graphLabels.push(parts.graph);
            lastGraphWidth = lines[i].text.length;
        }

        const loadMore = this.graphService.hasMore;
        if (loadMore) {
            // Отступ — по графике последней строки: надпись встаёт под её темой.
            this.list.appendRow(buildLoadMoreRow(lastGraphWidth), { label: "Load More" });
        }

        // Курсор возвращаем только на строку, которая в списке действительно
        // есть: догрузка последней страницы убирает «Load More…» из-под него.
        if (cursorId === undefined) return;
        if (this.commitsBySha.has(cursorId) || (loadMore && cursorId === LOAD_MORE_ROW_ID)) {
            this.list.setCursorTo(cursorId);
        }
    }

    /**
     * Подсветка линий выделенного коммита. Строки не пересобираются: меняются
     * только графовые лейблы, и точечный `markDirty` внутри них оставляет
     * остальной кадр нетронутым.
     */
    private setSelected(sha: string): void {
        // Курсор на строке «Load More…» подсветку снимает: коммита за ней нет.
        const selected = this.commitsBySha.has(sha) ? sha : null;
        if (selected === this.selectedSha) return;
        this.selectedSha = selected;

        const commits = this.graphService.commits;
        const lines = renderCommitGraph(commits, selected, createGraphPalette(commits).styleFor);
        for (let i = 0; i < this.graphLabels.length; i++) {
            applyGraphLine(this.graphLabels[i], lines[i]);
        }
    }

    /** Контекстное меню коммита — делегат ContextMenuService (как у Changes). */
    private showContextMenu(commit: IScmCommit, screenX: number, screenY: number): void {
        const context: ScmGraphMenuContext = {
            sha: commit.sha,
            shortSha: commit.shortSha,
            subject: commit.subject,
        };
        this.contextMenuService.showContextMenu({
            getOwner: () => this.list,
            getAnchor: () => ({ screenX, screenY }),
            menuId: MenuId.ScmGraphContext,
            menuContext: context,
        });
    }
}
