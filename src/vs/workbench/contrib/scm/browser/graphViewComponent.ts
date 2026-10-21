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

/** Here, not in `graphActions.ts`: the action needs the section id from here, otherwise an import cycle. */
export const GRAPH_LOAD_MORE_COMMAND = "scm.graph.loadMore";

export const GraphViewComponentDIToken = token<GraphViewComponent>("GraphViewComponent");

/**
 * Indexed by the service snapshot, not by sha: `git log` prints a commit twice when
 * two branches lead into it.
 */
type GraphLabels = TextLabelElement[];

/**
 * The section is lazy: until expanded there are no rows, no layout is computed, and `git log`
 * is disabled for the extension via {@link ScmGraphService.setActive}.
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
    /** Survives collapsing: rows are not kept meanwhile. */
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
            // `git log` is expensive and needed less often: the extension does not run it until expanded.
            collapsed: true,
            body: this.view,
            // No button on purpose: CHANGES shows Open Folder; upstream has one welcome per container.
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
            // Only load-more activates: commit actions live in the context menu.
            if (element.id === LOAD_MORE_ROW_ID) void this.commands.execute(GRAPH_LOAD_MORE_COMMAND);
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            const commit = this.commitsBySha.get(listRowId(element));
            if (commit === undefined) return;
            this.showContextMenu(commit, screenX, screenY);
        };

        this.register(
            this.graphService.onDidChangeCommits(() => {
                // A collapsed section keeps no rows: expanding rebuilds them from the service snapshot.
                if (this.expanded) this.rebuild();
            }),
        );
        this.register(
            viewsService.onDidChangeViewExpanded(({ viewId, expanded }) => {
                if (viewId === SCM_GRAPH_VIEW_ID) this.setExpanded(expanded);
            }),
        );
        // DI creates the component before the container is built: the section is not expanded yet, but ask anyway.
        this.setExpanded(viewsService.isViewExpanded(SCM_GRAPH_VIEW_ID));
    }

    /**
     * Expanding builds from the accumulated snapshot right away: the next publish may be
     * byte-identical, and {@link ScmGraphService} would suppress it by signature, leaving the
     * section empty. Collapsing frees the rows: a page has up to a thousand.
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

    /** After collapsing the rows are gone, so the cursor id comes from {@link cursorId}. */
    private rebuild(): void {
        const cursorId = this.list.getCursorElement()?.id ?? this.cursorId ?? undefined;
        this.cursorId = null;
        this.list.clear();
        this.commitsBySha.clear();
        this.graphLabels = [];

        const commits = this.graphService.commits;
        // The selected commit may have left the page; otherwise the highlight would stick.
        if (!commits.some((c) => c.sha === this.selectedSha)) this.selectedSha = null;
        const palette = createGraphPalette(commits);
        const lines = renderCommitGraph(commits, this.selectedSha, palette.styleFor);

        let lastGraphWidth = 0;
        for (let i = 0; i < commits.length; i++) {
            const commit = commits[i];
            // The lane color is known only after layout.
            const parts = buildCommitRow(commit, lines[i], palette.colorOf(commit.sha));
            this.list.appendRow(parts.root, { label: commit.subject });
            this.commitsBySha.set(commit.sha, commit);
            this.graphLabels.push(parts.graph);
            lastGraphWidth = lines[i].text.length;
        }

        const loadMore = this.graphService.hasMore;
        if (loadMore) {
            // Indent follows the last row's graph so the label lines up under its subject.
            this.list.appendRow(buildLoadMoreRow(lastGraphWidth), { label: "Load More" });
        }

        // Loading the last page removes "Load More…" from under the cursor.
        if (cursorId === undefined) return;
        if (this.commitsBySha.has(cursorId) || (loadMore && cursorId === LOAD_MORE_ROW_ID)) {
            this.list.setCursorTo(cursorId);
        }
    }

    /** Rows are not rebuilt: a targeted `markDirty` of graph labels leaves the rest of the frame alone. */
    private setSelected(sha: string): void {
        // The cursor on the "Load More…" row clears the highlight: there is no commit behind it.
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
