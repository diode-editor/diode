import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TreeViewElement } from "../../../../../../tuidom/ui/tree/treeViewElement.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { ThemedComponent } from "../../../browser/component.ts";
import type { PanelService } from "../../../browser/parts/panel/panelService.ts";
import { PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import { MarkerServiceDIToken } from "../../../common/coreTokens.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

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
 * Регистрирует вкладку PROBLEMS в {@link PanelService}; пока маркеров нет,
 * контент вкладки — null (панель рендерит placeholder). Активация маркера
 * раскрывает его позицию через шов {@link IMarkerRevealTarget}.
 */
export class ProblemsComponent extends ThemedComponent {
    public static dependencies = [
        MarkerServiceDIToken,
        PanelServiceDIToken,
        MarkerRevealTargetDIToken,
        ThemeServiceDIToken,
    ] as const;

    /** The Problems tree — доступен тестам и оркестрации (фокус, выделение). */
    public readonly tree: TreeViewElement<ProblemNode>;
    /** Корневой контрол: дерево, обёрнутое скроллбаром; вкидывается в Panel через сервис. */
    public readonly view: ScrollBarDecorator;

    private provider: ProblemsTreeDataProvider;
    private treeShown = false;

    public constructor(
        private readonly markerService: MarkerService,
        private readonly panelService: PanelService,
        private readonly revealTarget: IMarkerRevealTarget,
        themeService: ThemeService,
    ) {
        super(themeService);
        this.provider = new ProblemsTreeDataProvider();
        this.tree = new TreeViewElement(this.provider);
        this.view = new ScrollBarDecorator(this.tree);
        this.view.id = "problemsView";

        this.panelService.addView({
            id: PROBLEMS_VIEW_ID,
            title: "PROBLEMS",
            content: null,
            placeholder: "No problems have been detected in the workspace.",
        });

        this.tree.onActivate = (node) => {
            this.revealMarker(node);
        };

        this.register(
            this.markerService.onDidChangeMarkers(() => {
                this.rebuild();
            }),
        );
        this.initStyles();
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
            this.panelService.setViewContent(PROBLEMS_VIEW_ID, shouldShowTree ? this.view : null);
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
        // Ресурс маркера — уже uri (`uri.toString()`), а не путь: поднимаем его парсингом,
        // а не Uri.file, иначе "file:///a.ts" стало бы путём с именем "file:".
        this.revealTarget.openUri(Uri.parse(node.resource));
        const editor = this.revealTarget.getActiveEditor();
        /* v8 ignore start -- defensive: openUri always opens/activates an editor for the resource */
        if (editor === null) return;
        /* v8 ignore stop */
        const start = node.marker.range.start;
        editor.goToPosition(start.line, start.character);
        editor.revealRange(node.marker.range);
    }

    protected updateStyles(): void {
        this.tree.style = {
            fg: this.theme.getRequiredColor("editor.foreground"),
            bg: this.theme.getRequiredColor("panel.background"),
        };
        this.provider.severityColors = {
            error: this.theme.getRequiredColor("editorError.foreground"),
            warning: this.theme.getRequiredColor("editorWarning.foreground"),
            info: this.theme.getRequiredColor("editorInfo.foreground"),
            hint: this.theme.getRequiredColor("editorHint.foreground"),
        };
        this.rebuild();
    }
}
