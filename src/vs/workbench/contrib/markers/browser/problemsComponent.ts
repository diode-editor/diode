import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { MarkerServiceDIToken } from "../../../../platform/markers/common/markerService.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";

import { type ProblemNode, ProblemsTreeDataProvider } from "./problemsTreeDataProvider.ts";

export const PROBLEMS_VIEW_ID = "workbench.panel.markers.view";

/**
 * Like upstream `MarkersView`'s `Event.debounce(onMarkerChanged, …, 64)`: on a monorepo the language
 * server sends thousands of events in a row, and rebuilding the tree on each one hung the UI thread.
 */
export const PROBLEMS_UPDATE_DELAY_MS = 64;

export interface IMarkerRevealEditor {
    /** The editor resource — used to check that the marker's resource is what actually opened. */
    readonly uri: Uri;
    goToPosition(line: number, column?: number): void;
    revealRange(range: IRange): void;
}

export interface IMarkerRevealTarget {
    /** The promise never rejects: the service reports an open failure by itself. */
    openUri(uri: Uri): Promise<void>;
    getActiveEditor(): IMarkerRevealEditor | null;
}

export const MarkerRevealTargetDIToken = token<IMarkerRevealTarget>("MarkerRevealTarget");
export const ProblemsComponentDIToken = token<ProblemsComponent>("ProblemsComponent");

/** While there are no markers the tab content is null (the panel renders a placeholder). */
export class ProblemsComponent extends Component {
    public static dependencies = [
        MarkerServiceDIToken,
        ViewsServiceDIToken,
        MarkerRevealTargetDIToken,
        JumpRecorderDIToken,
        ProductIconServiceDIToken,
    ] as const;

    public readonly tree: TreeViewElement<ProblemNode>;
    public readonly view: ScrollBarDecorator;

    private provider: ProblemsTreeDataProvider;
    private treeShown = false;
    private readonly updateScheduler: RunOnceScheduler;
    private updating = false;
    private markersVersion = 0;
    private renderedVersion = 0;

    public constructor(
        private readonly markerService: MarkerService,
        private readonly viewsService: ViewsService,
        private readonly revealTarget: IMarkerRevealTarget,
        private readonly jumps: IJumpRecorder,
        icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        super();
        this.provider = new ProblemsTreeDataProvider();
        this.provider.icons = icons;
        this.tree = new TreeViewElement(this.provider);
        this.tree.style = { fg: "editor.foreground", bg: "panel.background" };
        // Token names — the tree resolves colors (resolveColor) in its own scope.
        this.provider.severityColors = {
            error: "editorError.foreground",
            warning: "editorWarning.foreground",
            info: "editorInfo.foreground",
            hint: "editorHint.foreground",
        };
        this.view = new ScrollBarDecorator(this.tree);
        this.view.id = "problemsView";

        this.viewsService.registerContainer({ id: PROBLEMS_VIEW_ID, title: "PROBLEMS", location: "panel", order: 0 });
        this.viewsService.registerView({
            canMoveView: true,
            id: PROBLEMS_VIEW_ID,
            containerId: PROBLEMS_VIEW_ID,
            title: "PROBLEMS",
            order: 10,
            body: null,
            placeholder: "No problems have been detected in the workspace.",
            focus: () => {
                this.focus();
            },
        });

        this.tree.onActivate = (node) => {
            void this.revealMarker(node);
        };

        this.updateScheduler = this.register(
            new RunOnceScheduler(() => {
                void this.update();
            }, PROBLEMS_UPDATE_DELAY_MS),
        );
        this.register(
            // Without markers the tree is detached from the tab (placeholder): its refresh is invisible.
            icons.onDidChange(() => {
                void this.tree.refresh();
            }),
        );
        this.register(
            this.markerService.onDidChangeMarkers(() => {
                // Stryker disable next-line UpdateOperator: equivalent — the version is compared with the rendered one only for inequality, the counting direction is unobservable
                this.markersVersion++;
                this.updateScheduler.schedule();
            }),
        );
    }

    public focus(): void {
        // The command shows the panel (which re-attaches its subtree to the live
        // root) before calling this, so the tree's `root` is wired here.
        this.tree.focus();
    }

    /**
     * At most one recompute at a time: a marker change mid-recompute is deferred until it ends
     * (two would rebuild the same tree interleaved), and the snapshot is re-read once more.
     */
    private async update(): Promise<void> {
        if (this.updating) return;
        this.updating = true;
        try {
            while (this.renderedVersion !== this.markersVersion) {
                this.renderedVersion = this.markersVersion;
                await this.rebuild();
            }
        } finally {
            this.updating = false;
        }
    }

    private async rebuild(): Promise<void> {
        const markers = this.markerService.read();
        this.provider.setMarkers(markers);

        const shouldShowTree = markers.length > 0;
        if (shouldShowTree !== this.treeShown) {
            this.viewsService.setViewBody(PROBLEMS_VIEW_ID, shouldShowTree ? this.view : null);
            this.treeShown = shouldShowTree;
        }
        // Stryker disable next-line ConditionalExpression: equivalent — without markers the tree is detached from the tab (placeholder), its rebuild is invisible; the branch saves work
        if (shouldShowTree) await this.refreshTree();
    }

    private async refreshTree(): Promise<void> {
        await this.tree.refresh();
        // In a batch, not `expand` per file: each `expand` rebuilds the whole
        // flat list, and on thousands of files that takes minutes.
        await this.tree.expandElements(this.provider.getChildren());
    }

    private async revealMarker(node: ProblemNode): Promise<void> {
        if (node.kind !== "marker") return;
        const { resource, marker } = node;
        // The whole jump is one history entry (IJumpRecorder). The resource is already a uri: Uri.parse, not
        // Uri.file, otherwise "file:///a.ts" would become a path named "file:".
        const uri = Uri.parse(resource);
        await this.jumps.jumpAsync(async () => {
            await this.revealTarget.openUri(uri);
            const editor = this.revealTarget.getActiveEditor();
            // A non-disk resource (`jdt:`) may fail to open: without the check the cursor would move to the marker's
            // coordinates in SOMEONE ELSE's editor, without `?.` — into nowhere (markers are activated with an empty tab strip too).
            // Stryker disable next-line OptionalChaining: removing `?.` makes the jump throw AFTER await, i.e. outside the test's stack — the runner crashes serializing an unhandled error instead of an honest "mutant survived/killed". Localizing listener errors — #275, see docs/MUTATION.md
            if (editor?.uri.toString() !== uri.toString()) return;
            const start = marker.range.start;
            editor.goToPosition(start.line, start.character);
            editor.revealRange(marker.range);
        });
    }
}
