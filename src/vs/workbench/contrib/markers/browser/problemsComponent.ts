import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { MarkerServiceDIToken } from "../../../../platform/markers/common/markerService.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";

import { type ProblemNode, ProblemsTreeDataProvider } from "./problemsTreeDataProvider.ts";

export const PROBLEMS_VIEW_ID = "workbench.panel.markers.view";

/**
 * Как `Event.debounce(onMarkerChanged, …, 64)` у `MarkersView` эталона: на монорепе языковой
 * сервер шлёт тысячи событий подряд, и пересчёт дерева на каждое вешал UI-поток.
 */
export const PROBLEMS_UPDATE_DELAY_MS = 64;

export interface IMarkerRevealEditor {
    /** Ресурс редактора — по нему сверяется, что открылся именно маркерный. */
    readonly uri: Uri;
    goToPosition(line: number, column?: number): void;
    revealRange(range: IRange): void;
}

export interface IMarkerRevealTarget {
    /** Обещание не отклоняется: неудачу открытия сервис показывает сам. */
    openUri(uri: Uri): Promise<void>;
    getActiveEditor(): IMarkerRevealEditor | null;
}

export const MarkerRevealTargetDIToken = token<IMarkerRevealTarget>("MarkerRevealTarget");
export const ProblemsComponentDIToken = token<ProblemsComponent>("ProblemsComponent");

/** Пока маркеров нет, контент вкладки — null (панель рендерит placeholder). */
export class ProblemsComponent extends Component {
    public static dependencies = [
        MarkerServiceDIToken,
        ViewsServiceDIToken,
        MarkerRevealTargetDIToken,
        JumpRecorderDIToken,
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
    ) {
        super();
        this.provider = new ProblemsTreeDataProvider();
        this.tree = new TreeViewElement(this.provider);
        this.tree.style = { fg: "editor.foreground", bg: "panel.background" };
        // Имена токенов — цвета резолвит дерево (resolveColor) в своём scope.
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
            this.markerService.onDidChangeMarkers(() => {
                // Stryker disable next-line UpdateOperator: эквивалентный — версия сравнивается с отрисованной только на неравенство, направление счёта не наблюдаемо
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
     * Не больше одного пересчёта за раз: смена маркеров посреди пересчёта откладывается до его конца
     * (два перестраивали бы одно дерево вперемешку), и снимок перечитывается ещё раз.
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
        // Stryker disable next-line ConditionalExpression: эквивалентный — без маркеров дерево снято со вкладки (плейсхолдер), его пересборка невидима; ветка экономит работу
        if (shouldShowTree) await this.refreshTree();
    }

    private async refreshTree(): Promise<void> {
        await this.tree.refresh();
        // Пачкой, а не `expand` на файл: каждый `expand` пересобирает весь
        // плоский список, и на тысячах файлов это минуты.
        await this.tree.expandElements(this.provider.getChildren());
    }

    private async revealMarker(node: ProblemNode): Promise<void> {
        if (node.kind !== "marker") return;
        const { resource, marker } = node;
        // Переход целиком — одна запись истории (IJumpRecorder). Ресурс — уже uri: Uri.parse, а не
        // Uri.file, иначе "file:///a.ts" стало бы путём с именем "file:".
        const uri = Uri.parse(resource);
        await this.jumps.jumpAsync(async () => {
            await this.revealTarget.openUri(uri);
            const editor = this.revealTarget.getActiveEditor();
            // Недисковый ресурс (`jdt:`) мог не открыться: без сверки каретка уехала бы по координатам
            // маркера в ЧУЖОМ редакторе, без `?.` — в никуда (маркер активируют и при пустой полосе вкладок).
            // Stryker disable next-line OptionalChaining: снятие `?.` заставляет переход кинуть ПОСЛЕ await, то есть мимо стека теста — раннер падает на сериализации unhandled error вместо честного «мутант выжил/убит». Локализация ошибок слушателя — #275, см. docs/MUTATION.md
            if (editor?.uri.toString() !== uri.toString()) return;
            const start = marker.range.start;
            editor.goToPosition(start.line, start.character);
            editor.revealRange(marker.range);
        });
    }
}
