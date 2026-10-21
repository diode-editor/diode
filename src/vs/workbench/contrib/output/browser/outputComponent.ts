import type { MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import { CHECKED_ICON } from "../../../../platform/actions/common/menuRegistry.ts";
import type { IMenu, MenuService } from "../../../../platform/actions/common/menuService.ts";
import { MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { SyntheticTextModel } from "../../../common/editor/syntheticTextModel.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { OUTPUT_LANGUAGE_ID, OUTPUT_URI_SCHEME, OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";
import type { OutputService } from "../../../services/output/common/outputService.ts";
import { formatOutputLine, OutputServiceDIToken } from "../../../services/output/common/outputService.ts";

import { SwitchOutputMenu } from "./outputChannelActions.ts";

export const OutputComponentDIToken = token<OutputComponent>("OutputComponent");

/**
 * Не `Component`: своего корневого контрола нет — detached-редактор попадает в панель через
 * `ViewsService.setViewBody`, как виджет терминала.
 */
export class OutputComponent extends Disposable {
    public static dependencies = [
        OutputServiceDIToken,
        ViewsServiceDIToken,
        EditorServiceDIToken,
        MenuServiceDIToken,
    ] as const;

    private pane: TextEditorPane<SyntheticTextModel> | null = null;
    private loadedChannelId: string | null = null;
    private readonly selector = new SelectBoxElement();
    private readonly switchMenu: IMenu;

    public constructor(
        private readonly outputService: OutputService,
        private readonly viewsService: ViewsService,
        private readonly editorService: IEditorService,
        menuService: MenuService,
    ) {
        super();
        // Живой IMenu, а не снимок: каналы регистрируются по мере появления.
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
        this.viewsService.registerContainer({ id: OUTPUT_VIEW_ID, title: "OUTPUT", location: "panel", order: 1 });
        this.viewsService.registerView({
            canMoveView: true,
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

        this.register(
            this.outputService.onDidChangeActiveChannel(() => {
                this.syncActiveChannel();
                this.syncSelector();
            }),
        );
        // Живой хвост: дописываем строку от имени владельца документа — read-only
        // запрещает правки пользователя, но не владельца (см. SyntheticTextModel.appendContent).
        this.register(
            this.outputService.onDidAppendToActiveChannel((entry) => {
                if (this.pane === null) return;
                // Решаем ДО дописывания: после него «конец документа» уже другой.
                const follow = this.shouldFollowTail(this.pane);
                this.pane.model.appendContent(`${formatOutputLine(entry)}\n`);
                if (follow) this.revealLastLine(this.pane);
            }),
        );
        // Слушаем показ, а не пользовательскую активацию: при восстановлении сессии вкладку
        // активирует `restoreLayout()` без клика, и панель висела бы с плейсхолдером.
        this.register(
            this.viewsService.onDidShowView((id) => {
                if (id === OUTPUT_VIEW_ID) this.syncActiveChannel();
            }),
        );
    }

    public focus(): void {
        this.syncActiveChannel();
        this.pane?.focusEditor();
    }

    private syncActiveChannel(): void {
        const channelId = this.outputService.getActiveChannelId();
        if (channelId === null) return;
        this.syncSelector();
        const pane = this.ensurePane();
        if (this.loadedChannelId !== channelId) {
            this.loadedChannelId = channelId;
            pane.model.replaceContent(this.outputService.renderChannel(channelId));
        }
        this.revealLastLine(pane);
    }

    /** Разделители отсеиваются здесь — индекс в селекторе совпадает с индексом пункта. */
    private channelEntries(): MenuItemEntry[] {
        return this.switchMenu.getEntries().filter((entry): entry is MenuItemEntry => entry.type !== "separator");
    }

    private syncSelector(): void {
        const items = this.channelEntries();
        const options = items.map((item) => ({ text: item.label }));
        // Активный пункт (`toggled`) реестр отдаёт с галочкой в иконке.
        const activeIndex = items.findIndex((item) => item.icon === CHECKED_ICON);
        this.selector.setOptions(options, activeIndex);
        this.viewsService.setViewTitleWidget(OUTPUT_VIEW_ID, options.length > 0 ? this.selector : null);
    }

    private ensurePane(): TextEditorPane<SyntheticTextModel> {
        if (this.pane !== null) return this.pane;
        const pane = this.editorService.openDetached(
            Uri.from({ scheme: OUTPUT_URI_SCHEME, path: "channel" }),
            OUTPUT_LANGUAGE_ID,
        );
        pane.readOnly = true;
        // Фон панельный, как у Problems и терминала: с `editor.background` лог был
        // прямоугольником чужого цвета внутри панели.
        pane.backgroundToken = "panel.background";
        this.pane = pane;
        this.viewsService.setViewBody(OUTPUT_VIEW_ID, pane.view);
        return pane;
    }

    /**
     * Автоскролл переставляет курсор: в активно пишущем канале (`input.keybindings`) нельзя было ни
     * выделить текст, ни дочитать старое. Следуем, только пока человек у конца и ничего не выделяет
     * (`scrollLock` эталона, выведенный из состояния).
     */
    private shouldFollowTail(pane: TextEditorPane): boolean {
        const viewState = pane.viewState;
        const hasSelection = viewState.selections.some((selection) => !isSelectionCollapsed(selection));
        if (hasSelection) return false;
        const lastLine = Math.max(0, viewState.document.lineCount - 1);
        return viewState.selections.every((selection) => selection.active.line >= lastLine - 1);
    }

    /** Read-only движению курсора не мешает: он запрещает правки, а не навигацию. */
    private revealLastLine(pane: TextEditorPane): void {
        const lastLine = Math.max(0, pane.viewState.document.lineCount - 1);
        pane.goToPosition(lastLine, 0);
    }
}
