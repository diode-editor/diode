import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { HFlexElement, hflexFill, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { ListViewElement } from "../../../../../../tuidom/ui/list/listViewElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";

import { SCM_VIEWLET_ID } from "./changesComponent.ts";
import type { ScmGraphService } from "./graphService.ts";
import { ScmGraphServiceDIToken } from "./graphService.ts";

/** Id view-секции GRAPH внутри контейнера Source Control (см. {@link ViewsService}). */
export const SCM_GRAPH_VIEW_ID = "workbench.scm.graph";

export const GraphViewComponentDIToken = token<GraphViewComponent>("GraphViewComponent");

/** Колонка короткого sha: 8 знаков + пробел-разделитель. */
const SHORT_SHA_WIDTH = 9;

/**
 * View-секция **GRAPH** контейнера Source Control: последние коммиты
 * репозитория списком `короткий sha · subject` — пока тривиальный список,
 * настоящий граф с рёбрами позже. Данные — снимок {@link ScmGraphService}
 * (публикует git-расширение), ручной перезапрос — пункт Refresh в меню «⋯»
 * секции ({@link scmGraphRefreshAction}).
 */
export class GraphViewComponent extends Component {
    public static dependencies = [ScmGraphServiceDIToken, ViewsServiceDIToken] as const;

    /** Список коммитов — доступен тестам и оркестрации (фокус, inspectState). */
    public readonly list = new ListViewElement();
    /** Тело view-секции GRAPH — вкидывается в контейнер через ViewsService. */
    public readonly view: PaddingContainerElement;

    public constructor(
        private readonly graphService: ScmGraphService,
        viewsService: ViewsService,
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
     * Пересобирает строки из снимка сервиса. Курсор возвращается на прежний
     * коммит по sha, если он пережил публикацию (как у вкладки Changes).
     */
    private rebuild(): void {
        const cursorId = this.list.getCursorElement()?.id;
        this.list.clear();

        for (const commit of this.graphService.commits) {
            const row = new HFlexElement();
            row.id = commit.sha;
            const sha = new TextLabelElement(commit.shortSha);
            sha.style = { fg: "descriptionForeground" };
            row.addChild(sha, { width: hflexFixed(SHORT_SHA_WIDTH), height: 1 });
            row.addChild(new TextLabelElement(commit.subject), { width: hflexFill(), height: 1 });
            this.list.appendRow(row, { label: commit.subject });
        }

        if (cursorId !== undefined && this.graphService.commits.some((c) => c.sha === cursorId)) {
            this.list.setCursorTo(cursorId);
        }
    }
}
