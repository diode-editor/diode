import { Disposable } from "../../../../../../tuidom/common/disposable.ts";
import type { MenuItemEntry } from "../../../../../../tuidom/ui/menu/popupMenuElement.ts";
import { SelectBoxElement } from "../../../../../../tuidom/ui/selectbox/selectBoxElement.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import { CHECKED_ICON } from "../../../../platform/actions/common/menuRegistry.ts";
import type { IMenu, MenuService } from "../../../../platform/actions/common/menuService.ts";
import { MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { PanelService } from "../../../browser/parts/panel/panelService.ts";
import { PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { OUTPUT_LANGUAGE_ID, OUTPUT_URI_SCHEME, OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";
import type { OutputService } from "../../../services/output/common/outputService.ts";
import { formatOutputLine, OutputServiceDIToken } from "../../../services/output/common/outputService.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import { SwitchOutputMenu } from "./outputChannelActions.ts";

export const OutputComponentDIToken = token<OutputComponent>("OutputComponent");

/**
 * View-владелец вкладки OUTPUT: держит ОДИН detached-редактор (см.
 * `EditorService.openDetached`) и переливает в него содержимое активного канала.
 * Как и в VS Code, контент Output — обычный read-only редактор над моделью с
 * языком `log`: выделение, копирование, Ctrl+F и подсветка достаются даром.
 *
 * Не `Component`: собственного корневого контрола нет — редактор попадает в
 * панель через `ViewsService.setViewBody`, ровно как виджет терминала.
 */
export class OutputComponent extends Disposable {
    public static dependencies = [
        OutputServiceDIToken,
        PanelServiceDIToken,
        ViewsServiceDIToken,
        EditorServiceDIToken,
        MenuServiceDIToken,
        ThemeServiceDIToken,
    ] as const;

    /** Редактор канала; создаётся лениво — до открытия вкладки он не нужен. */
    private pane: TextEditorPane | null = null;
    /** Канал, содержимое которого сейчас залито в редактор. */
    private loadedChannelId: string | null = null;
    /** Селектор канала в шапке панели; наполняется из submenu `switchOutput`. */
    private readonly selector = new SelectBoxElement();
    private readonly switchMenu: IMenu;

    public constructor(
        private readonly outputService: OutputService,
        private readonly panelService: PanelService,
        private readonly viewsService: ViewsService,
        private readonly editorService: EditorService,
        menuService: MenuService,
        private readonly themeService: ThemeService,
    ) {
        super();
        // Пункты селектора живут в submenu `switchOutput` — как в VS Code, где
        // `isSelection` превращает это же submenu в SelectBox. Живой IMenu, а не
        // снимок: каналы регистрируются по мере появления.
        this.switchMenu = this.register(menuService.createMenu(SwitchOutputMenu));
        this.register(
            this.switchMenu.onDidChange(() => {
                this.syncSelector();
            }),
        );
        this.selector.onDidSelect = ({ index }) => {
            // Исполняем команду пункта, а не дёргаем сервис напрямую: пункт — это
            // `workbench.action.output.show.<id>`, и путь должен быть один.
            this.channelEntries()[index]?.onSelect?.();
        };
        // Вкладка панели — контейнер с единственной секцией: заголовка у неё
        // нет (его роль играет таб), а переключатель каналов уезжает в
        // таб-строку через `setViewTitleWidget`.
        this.viewsService.registerContainer({ id: OUTPUT_VIEW_ID, title: "OUTPUT", location: "panel" });
        this.viewsService.registerView({
            id: OUTPUT_VIEW_ID,
            containerId: OUTPUT_VIEW_ID,
            title: "OUTPUT",
            order: 10,
            body: null,
            placeholder: "No output yet.",
            focus: () => {
                this.focus();
            },
        });
        this.viewsService.attachContainer(OUTPUT_VIEW_ID);

        this.register(
            this.outputService.onDidChangeActiveChannel(() => {
                this.syncActiveChannel();
                this.syncSelector();
            }),
        );
        // Живой хвост: дописываем строку от имени владельца документа — read-only
        // запрещает правки пользователя, но не владельца (см. appendOwnedContent).
        this.register(
            this.outputService.onDidAppendToActiveChannel((entry) => {
                if (this.pane === null) return;
                // Решаем ДО дописывания: после него «конец документа» уже другой.
                const follow = this.shouldFollowTail(this.pane);
                this.pane.model.appendOwnedContent(`${formatOutputLine(entry)}\n`);
                if (follow) this.revealLastLine(this.pane);
            }),
        );
        // Ленивая инициализация: вкладка стала активной — только тогда поднимаем
        // редактор. Слушаем именно смену активной вкладки, а не пользовательскую
        // активацию: при восстановлении сессии вкладку делает активной
        // `LayoutService.restoreLayout()`, клика не будет вовсе — и панель
        // показывалась бы с плейсхолдером до первого ручного переключения.
        this.register(
            this.panelService.onDidChangeActiveView((id) => {
                if (id === OUTPUT_VIEW_ID) this.syncActiveChannel();
            }),
        );
    }

    /** Фокус в редактор Output (для toggle-команды). */
    public focus(): void {
        this.syncActiveChannel();
        this.pane?.focusEditor();
    }

    /** Приводит редактор к активному каналу: контент + метка вкладки. */
    private syncActiveChannel(): void {
        const channelId = this.outputService.getActiveChannelId();
        if (channelId === null) return;
        this.syncSelector();
        const pane = this.ensurePane();
        if (this.loadedChannelId !== channelId) {
            this.loadedChannelId = channelId;
            pane.model.replaceOwnedContent(this.outputService.renderChannel(channelId));
        }
        this.revealLastLine(pane);
    }

    /** Приводит селектор к живому submenu: подписи каналов + отметка активного. */
    /**
     * Пункты-каналы submenu. Разделители отсеиваются здесь, в одном месте, — так
     * индекс в селекторе и индекс пункта совпадают, и сопоставлять их обратно
     * (а значит и ошибиться) уже негде.
     */
    private channelEntries(): MenuItemEntry[] {
        return this.switchMenu.getEntries().filter((entry): entry is MenuItemEntry => entry.type !== "separator");
    }

    private syncSelector(): void {
        const items = this.channelEntries();
        const options = items.map((item) => ({ text: item.label }));
        // Активный пункт помечен `toggled` — реестр отдаёт его с галочкой в иконке,
        // так что искать активный канал повторно не нужно.
        const activeIndex = items.findIndex((item) => item.icon === CHECKED_ICON);
        this.selector.setOptions(options, activeIndex);
        this.viewsService.setViewTitleWidget(OUTPUT_VIEW_ID, options.length > 0 ? this.selector : null);
    }

    private ensurePane(): TextEditorPane {
        if (this.pane !== null) return this.pane;
        // Ресурс канала синтетический (`output:<id>`), как в VS Code: файла нет,
        // содержимое даёт сервис.
        const pane = this.editorService.openDetached(
            Uri.from({ scheme: OUTPUT_URI_SCHEME, path: "channel" }),
            OUTPUT_LANGUAGE_ID,
        );
        pane.readOnly = true;
        this.pane = pane;
        this.viewsService.setViewBody(OUTPUT_VIEW_ID, pane.view);
        return pane;
    }

    /**
     * Тянуться ли за хвостом лога. Автоскролл переставляет курсор, а значит
     * схлопывает выделение и утаскивает вьюпорт вниз — в активно пишущем канале
     * (например `input.keybindings`, куда строка идёт на каждое нажатие) из-за
     * этого нельзя было ни выделить текст, ни дочитать старые строки.
     *
     * Поэтому следуем за хвостом только пока пользователь у конца и ничего не
     * выделяет — тот же смысл, что у `scrollLock` в `OutputEditor` VS Code,
     * только выведенный из состояния, а не из отдельного тумблера.
     */
    private shouldFollowTail(pane: TextEditorPane): boolean {
        const viewState = pane.viewState;
        const hasSelection = viewState.selections.some((selection) => !isSelectionCollapsed(selection));
        if (hasSelection) return false;
        const lastLine = Math.max(0, viewState.document.lineCount - 1);
        return viewState.selections.every((selection) => selection.active.line >= lastLine - 1);
    }

    /**
     * Автоскролл к последней строке (VS Code `revealLastLine`). Курсор в конец
     * документа — скролл подтягивается за ним. Read-only движению курсора не
     * мешает: он запрещает правки, а не навигацию.
     */
    private revealLastLine(pane: TextEditorPane): void {
        const lastLine = Math.max(0, pane.viewState.document.lineCount - 1);
        pane.goToPosition(lastLine, 0);
    }
}
