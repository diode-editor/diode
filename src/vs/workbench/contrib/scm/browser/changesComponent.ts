import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TitledPanelElement } from "../../../../../../tuidom/ui/titledpanel/titledPanelElement.ts";
import { TreeViewElement } from "../../../../../../tuidom/ui/tree/treeViewElement.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { getFileTreeStyles, getScrollBarStyles } from "../../../../platform/theme/browser/defaultStyles.ts";
import type { IWorkbenchColors } from "../../../../platform/theme/common/colors/colorContributions.ts";
import { ThemedComponent } from "../../../browser/component.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import type { ScmChangesService } from "./changesService.ts";
import { ScmChangesServiceDIToken } from "./changesService.ts";
import { type ChangeNode, ChangesTreeDataProvider } from "./changesTreeDataProvider.ts";
import { compareWithHeadAction } from "./compareWithHeadAction.ts";

/** Id вьюлета Source Control в сайдбаре (см. {@link SidebarService}). */
export const SCM_VIEWLET_ID = "scm";

/** `gitDecoration.*`, которыми расширение помечает статусы — резолвим их в цвета букв. */
const GIT_STATUS_COLOR_IDS = [
    "gitDecoration.modifiedResourceForeground",
    "gitDecoration.addedResourceForeground",
    "gitDecoration.deletedResourceForeground",
    "gitDecoration.renamedResourceForeground",
    "gitDecoration.untrackedResourceForeground",
    "gitDecoration.conflictingResourceForeground",
    "gitDecoration.ignoredResourceForeground",
] as const satisfies readonly (keyof IWorkbenchColors)[];

export const ChangesComponentDIToken = token<ChangesComponent>("ChangesComponent");

/**
 * Вьюлет **Source Control** в сайдбаре: плоский список изменённых файлов
 * ({@link TreeViewElement} поверх {@link ChangesTreeDataProvider}) под рамкой
 * SOURCE CONTROL — параллель Explorer'у. Потребитель {@link ScmChangesService},
 * набор в который пушит SCM-расширение. Активация файла открывает его и запускает
 * «Compare with HEAD» (вкладку-смотрелку этапа 5) — список переиспользует готовую
 * команду, не зная про дифф.
 *
 * Место в сайдбаре (а не в нижней Panel) — как в VS Code: у нас нет activity bar,
 * поэтому Explorer ↔ Source Control переключают команды (`workbench.view.*`),
 * а сам показ — подмена контента сайдбара через {@link SidebarService}.
 */
export class ChangesComponent extends ThemedComponent {
    public static dependencies = [
        ScmChangesServiceDIToken,
        EditorServiceDIToken,
        CommandRegistryDIToken,
        ThemeServiceDIToken,
    ] as const;

    /** Список изменений — доступен тестам и оркестрации (фокус, выделение). */
    public readonly tree: TreeViewElement<ChangeNode>;
    /** Корневой контрол вьюлета (рамка SOURCE CONTROL); вкидывается в сайдбар. */
    public readonly view: TitledPanelElement;

    private readonly scrollBars: ScrollBarDecorator;
    private readonly provider: ChangesTreeDataProvider;

    public constructor(
        private readonly changesService: ScmChangesService,
        private readonly editors: EditorService,
        private readonly commands: CommandRegistry,
        themeService: ThemeService,
    ) {
        super(themeService);
        this.provider = new ChangesTreeDataProvider();
        this.tree = new TreeViewElement(this.provider);
        this.scrollBars = new ScrollBarDecorator(this.tree);
        this.view = new TitledPanelElement(
            "  SOURCE CONTROL",
            new PaddingContainerElement(this.scrollBars, { left: 1 }),
        );
        this.view.id = "changesView";

        this.tree.onActivate = (node) => {
            this.openDiff(node);
        };

        this.register(
            this.changesService.onDidChangeChanges(() => {
                this.rebuild();
            }),
        );
        this.initStyles();
    }

    /** Focuses the changes list (used by the "Show Source Control" command). */
    public focus(): void {
        this.tree.focus();
    }

    /**
     * Открывает изменённый файл и запускает «Compare with HEAD»: файл делается
     * активным (`openUri`), затем существующая команда строит вкладку-смотрелку.
     * Для untracked/файла без версии команда сама покажет статус-бар-сообщение.
     */
    private openDiff(node: ChangeNode): void {
        this.editors.openUri(node.uri);
        this.commands.execute(compareWithHeadAction.id);
    }

    /** Перечитывает снимок изменений в список. Пустой набор — пустой список под рамкой. */
    private rebuild(): void {
        this.provider.setChanges(this.changesService.changes);
        void this.tree.refresh();
    }

    protected updateStyles(): void {
        this.tree.setStyles(getFileTreeStyles(this.theme));
        this.tree.style = {
            fg: this.theme.getRequiredColor("sideBar.foreground"),
            bg: this.theme.getRequiredColor("sideBar.background"),
        };
        this.scrollBars.setStyles(getScrollBarStyles(this.theme, "sideBar.background"));
        this.view.style = {
            fg: this.theme.getRequiredColor("sideBar.foreground"),
            bg: this.theme.getRequiredColor("sideBar.background"),
        };
        const colors: Record<string, number> = {};
        for (const id of GIT_STATUS_COLOR_IDS) colors[id] = this.theme.getRequiredColor(id);
        this.provider.statusColors = colors;
        this.rebuild();
    }
}
