import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { listRowId } from "../../../../base/common/listRowId.ts";
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
import { SCM_GRAPH_VIEW_ID, SCM_VIEWLET_ID } from "../common/scmViews.ts";

import type { IScmCommit, ScmGraphService } from "./graphService.ts";
import { ScmGraphServiceDIToken } from "./graphService.ts";
import { applyGraphLine, buildCommitRow, buildLoadMoreRow, LOAD_MORE_ROW_ID } from "./scmGraphRows.ts";

/** Здесь, а не в `graphActions.ts`: экшену нужен id секции отсюда — иначе цикл импортов. */
export const GRAPH_LOAD_MORE_COMMAND = "scm.graph.loadMore";

export const GraphViewComponentDIToken = token<GraphViewComponent>("GraphViewComponent");

/**
 * Индексируются снимком сервиса, а не sha: `git log` печатает коммит дважды, когда
 * в него приходят две ветки.
 */
type GraphLabels = TextLabelElement[];

/**
 * Секция ленивая: пока не раскрыта, строк нет, укладка не считается, а `git log`
 * расширению запрещён через {@link ScmGraphService.setActive}.
 */
export class GraphViewComponent extends Component {
    public static dependencies = [
        ScmGraphServiceDIToken,
        ViewsServiceDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    public readonly list = new ListViewElement();
    public readonly view: PaddingContainerElement;

    private graphLabels: GraphLabels = [];
    private readonly commitsBySha = new Map<string, IScmCommit>();
    private selectedSha: string | null = null;
    private expanded = false;
    /** Переживает сворачивание: строки на это время не хранятся. */
    private cursorId: string | null = null;

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
            canMoveView: true,
            id: SCM_GRAPH_VIEW_ID,
            containerId: SCM_VIEWLET_ID,
            title: "GRAPH",
            order: 20,
            // `git log` дорогой и нужен реже: до раскрытия расширение его не запускает.
            collapsed: true,
            body: this.view,
            // Кнопки нет осознанно: Open Folder показывает CHANGES, у эталона welcome на контейнер один.
            requiresWorkspaceFolder: true,
            placeholder: "No folder opened.",
            focus: () => {
                this.focus();
            },
        });

        this.list.onSelect = (element) => {
            this.setSelected(listRowId(element));
        };
        this.list.onActivate = (element) => {
            // Активируется только догрузка: действия коммитов — в контекстном меню.
            if (element.id === LOAD_MORE_ROW_ID) void this.commands.execute(GRAPH_LOAD_MORE_COMMAND);
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            const commit = this.commitsBySha.get(listRowId(element));
            if (commit === undefined) return;
            this.showContextMenu(commit, screenX, screenY);
        };

        this.register(
            this.graphService.onDidChangeCommits(() => {
                // Свёрнутая секция строк не держит: раскрытие соберёт их из снимка сервиса.
                if (this.expanded) this.rebuild();
            }),
        );
        this.register(
            viewsService.onDidChangeViewExpanded(({ viewId, expanded }) => {
                if (viewId === SCM_GRAPH_VIEW_ID) this.setExpanded(expanded);
            }),
        );
        // DI создаёт компонент раньше сборки контейнера — секция ещё не раскрыта, но спрашиваем всё равно.
        this.setExpanded(viewsService.isViewExpanded(SCM_GRAPH_VIEW_ID));
    }

    /**
     * Раскрытие строит из накопленного снимка сразу: следующая публикация может быть
     * байт-идентичной, и {@link ScmGraphService} погасит её по подписи — секция осталась
     * бы пустой. Сворачивание освобождает строки: их у страницы до тысячи.
     */
    private setExpanded(expanded: boolean): void {
        if (expanded === this.expanded) return;
        this.expanded = expanded;
        if (expanded) {
            this.rebuild();
        } else {
            this.cursorId = this.list.getCursorElement()?.id ?? null;
            this.list.clear();
            this.commitsBySha.clear();
            this.graphLabels = [];
        }
        this.graphService.setActive(expanded);
    }

    public focus(): void {
        this.list.focus();
    }

    /** После сворачивания строк уже нет — id курсора берётся из {@link cursorId}. */
    private rebuild(): void {
        const cursorId = this.list.getCursorElement()?.id ?? this.cursorId ?? undefined;
        this.cursorId = null;
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
            // Цвет дорожки известен только после укладки.
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

        // Догрузка последней страницы убирает «Load More…» из-под курсора.
        if (cursorId === undefined) return;
        if (this.commitsBySha.has(cursorId) || (loadMore && cursorId === LOAD_MORE_ROW_ID)) {
            this.list.setCursorTo(cursorId);
        }
    }

    /** Строки не пересобираются: точечный `markDirty` графовых лейблов не трогает остальной кадр. */
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
