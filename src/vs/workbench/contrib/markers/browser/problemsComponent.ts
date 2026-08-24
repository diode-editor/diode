import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { Component } from "../../../browser/component.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { MarkerServiceDIToken } from "../../../common/coreTokens.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";

import { type ProblemNode, ProblemsTreeDataProvider } from "./problemsTreeDataProvider.ts";

/** VS Code view id of the Problems (Markers) view living in the bottom Panel. */
export const PROBLEMS_VIEW_ID = "workbench.panel.markers.view";

/** Редактор, в котором раскрывается позиция маркера. */
export interface IMarkerRevealEditor {
    goToPosition(line: number, column?: number): void;
    revealRange(range: IRange): void;
}

/**
 * Минимальный срез группы редакторов, нужный для reveal маркера: открыть ресурс
 * и довести до позиции. `EditorService` соответствует ему структурно —
 * связывание делает DI-модуль
 * ({@link MarkerRevealTargetDIToken}).
 */
export interface IMarkerRevealTarget {
    openUri(uri: Uri): void;
    getActiveEditor(): IMarkerRevealEditor | null;
}

export const MarkerRevealTargetDIToken = token<IMarkerRevealTarget>("MarkerRevealTarget");
export const ProblemsComponentDIToken = token<ProblemsComponent>("ProblemsComponent");

/**
 * Компонент Problems-вкладки нижней панели: дерево «файл → маркеры»
 * ({@link TreeViewElement} поверх `ProblemsTreeDataProvider`) — второй
 * потребитель общего {@link MarkerService} (первый — editor squiggles).
 * Регистрирует вкладку PROBLEMS в {@link ViewsService} (контейнер в панели); пока маркеров нет,
 * контент вкладки — null (панель рендерит placeholder). Активация маркера
 * раскрывает его позицию через шов {@link IMarkerRevealTarget}.
 */
export class ProblemsComponent extends Component {
    public static dependencies = [MarkerServiceDIToken, ViewsServiceDIToken, MarkerRevealTargetDIToken, JumpRecorderDIToken] as const;

    /** The Problems tree — доступен тестам и оркестрации (фокус, выделение). */
    public readonly tree: TreeViewElement<ProblemNode>;
    /** Корневой контрол: дерево, обёрнутое скроллбаром; вкидывается в Panel через сервис. */
    public readonly view: ScrollBarDecorator;

    private provider: ProblemsTreeDataProvider;
    private treeShown = false;

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

        // Вкладка панели — такой же контейнер view, как вьюлет сайдбара:
        // одна секция без своего заголовка (его роль играет таб).
        this.viewsService.registerContainer({ id: PROBLEMS_VIEW_ID, title: "PROBLEMS", location: "panel" });
        this.viewsService.registerView({
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
        this.viewsService.attachContainer(PROBLEMS_VIEW_ID);

        this.tree.onActivate = (node) => {
            this.revealMarker(node);
        };

        this.register(
            this.markerService.onDidChangeMarkers(() => {
                this.rebuild();
            }),
        );
    }

    /** Focuses the Problems tree (used by the "Toggle Problems" command). */
    public focus(): void {
        // The command shows the panel (which re-attaches its subtree to the live
        // root) before calling this, so the tree's `root` is wired here.
        this.tree.focus();
    }

    /**
     * Re-reads the marker snapshot into the tree. Swaps the Problems view between
     * the tree (markers present) and the placeholder empty-state (none).
     */
    private rebuild(): void {
        const markers = this.markerService.read();
        this.provider.setMarkers(markers);

        const shouldShowTree = markers.length > 0;
        if (shouldShowTree !== this.treeShown) {
            this.viewsService.setViewBody(PROBLEMS_VIEW_ID, shouldShowTree ? this.view : null);
            this.treeShown = shouldShowTree;
        }
        if (shouldShowTree) void this.refreshTree();
    }

    /** Rebuilds the tree and auto-expands each file node (like VS Code's Problems view). */
    private async refreshTree(): Promise<void> {
        await this.tree.refresh();
        for (const file of this.provider.getChildren()) {
            await this.tree.expand(file);
        }
    }

    private revealMarker(node: ProblemNode): void {
        if (node.kind !== "marker") return;
        const { resource, marker } = node;
        // Переход целиком — одна запись истории (см. IJumpRecorder): точка, откуда
        // ушли, и сам маркер, без промежуточного «открыли файл в начале».
        this.jumps.jump(() => {
            // Ресурс маркера — уже uri (`uri.toString()`), а не путь: поднимаем его парсингом,
            // а не Uri.file, иначе "file:///a.ts" стало бы путём с именем "file:".
            this.revealTarget.openUri(Uri.parse(resource));
            const editor = this.revealTarget.getActiveEditor();
            /* v8 ignore start -- defensive: openUri always opens/activates an editor for the resource */
            // Stryker disable next-line ConditionalExpression: ветка недостижима по той же причине, что и для покрытия
            if (editor === null) return;
            /* v8 ignore stop */
            const start = marker.range.start;
            editor.goToPosition(start.line, start.character);
            editor.revealRange(marker.range);
        });
    }
}
