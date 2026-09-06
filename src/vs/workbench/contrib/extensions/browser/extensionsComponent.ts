import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { HeaderBodyViewElement } from "../../../browser/parts/views/headerBodyViewElement.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";
import {
    ExtensionsWorkbenchServiceDIToken,
    filterExtensionEntries,
} from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane } from "./extensionEditorPane.ts";
import { buildExtensionRow, buildGroupRow, type IExtensionRowStyles } from "./extensionRows.ts";

export const ExtensionsComponentDIToken = token<ExtensionsComponent>("ExtensionsComponent");

/** Id вьюлета Extensions в сайдбаре (см. команду `workbench.view.extensions`). */
export const EXTENSIONS_VIEWLET_ID = "extensions";

/** Id единственной view merged-контейнера Extensions (заголовок + меню «⋯»). */
export const EXTENSIONS_VIEW_ID = "workbench.extensions.marketplace";

/**
 * Минимальный срез полосы редакторов: открыть страницу расширения вкладкой.
 * `EditorService` соответствует ему структурно — связывание делает DI-модуль
 * (как `SearchRevealTargetDIToken` у поиска).
 */
export interface IExtensionsEditorTarget {
    openPane(pane: IEditorPane): void;
}

export const ExtensionsEditorTargetDIToken = token<IExtensionsEditorTarget>("ExtensionsEditorTarget");

const MARKETPLACE_GROUP_ID = "extensionsGroup-marketplace";
const INSTALLED_GROUP_ID = "extensionsGroup-installed";
const ERROR_ROW_ID = "extensionsRetry";
const EMPTY_ROW_ID = "extensionsEmpty";
const LOADING_ROW_ID = "extensionsLoading";

const ROW_STYLES: IExtensionRowStyles = {
    dimFg: "descriptionForeground",
    updateFg: "textLink.foreground",
    warningFg: "editorWarning.foreground",
};

/** Что делает Enter на строке: открыть страницу расширения либо повторить запрос каталога. */
type RowAction = { readonly kind: "open"; readonly id: string } | { readonly kind: "retry" };

/**
 * Extensions view (левый сайдбар): строка поиска и список — каталог магазина
 * плюс установленное. Enter на записи открывает страницу расширения отдельной
 * вкладкой ({@link ExtensionEditorPane}).
 *
 * Установленное показывается ОТДЕЛЬНОЙ секцией и одновременно остаётся в
 * каталоге с бейджем `Installed`: «что у меня стоит» и «что есть в магазине» —
 * два разных вопроса, и второй не должен терять записи из-за первого.
 *
 * Фильтрация локальная (индекс кэширован сервисом), поэтому debounce не нужен:
 * набор буквы — это `filter` по массиву, а не запрос в сеть.
 */
export class ExtensionsComponent extends Component {
    public static dependencies = [
        ExtensionsWorkbenchServiceDIToken,
        ViewsServiceDIToken,
        ExtensionsEditorTargetDIToken,
    ] as const;

    private readonly root: HeaderBodyViewElement;
    private readonly queryInput = new InputElement();
    /** Публичен для команд list-навигации и тестов (конвенция SearchComponent). */
    public readonly list = new ListViewElement({ typeahead: false });
    private readonly actions = new Map<string, RowAction>();
    /** Идёт чтение каталога: пустой список в этот момент — «ещё не знаем», а не «пусто». */
    private loading = false;

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        viewsService: ViewsService,
        private readonly editorTarget: IExtensionsEditorTarget,
    ) {
        super();

        this.queryInput.placeholder = "Search Extensions";
        this.queryInput.onChange = () => {
            this.rebuildRows();
        };

        this.list.id = "extensionsList";
        this.list.onActivate = (element) => {
            // Список не принимает строки без id — здесь он гарантированно есть.
            this.activateRow(element.id!);
        };

        const header = new PaddingContainerElement(this.queryInput, { left: 1, right: 1 });
        this.root = new HeaderBodyViewElement(header, new ScrollBarDecorator(this.list));
        this.root.id = "extensionsView";
        this.root.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        this.register(service.onDidChange(() => this.rebuildRows()));
        this.rebuildRows();

        viewsService.registerView({
            id: EXTENSIONS_VIEW_ID,
            containerId: EXTENSIONS_VIEWLET_ID,
            title: "EXTENSIONS",
            order: 10,
            body: this.root,
            focus: () => {
                this.focus();
            },
        });
    }

    public get view(): TUIElement {
        return this.root;
    }

    /**
     * Фокус в строку поиска. Он же момент первого чтения каталога: до показа
     * вьюлета в сеть не ходим, а показ без списка бессмыслен.
     */
    public focus(): void {
        this.queryInput.focus();
        void this.withLoadingRow(() => this.service.ensureLoaded());
    }

    /** Перечитать каталог (команда `extensions.refresh`). */
    public refresh(): Promise<void> {
        return this.withLoadingRow(() => this.service.refresh());
    }

    /**
     * Держит строку «Loading…» на время чтения каталога. Без неё первый показ
     * вьюлета на медленной сети выглядит как пустой магазин — то есть врёт.
     */
    private async withLoadingRow(read: () => Promise<void>): Promise<void> {
        this.loading = true;
        this.rebuildRows();
        try {
            await read();
        } finally {
            this.loading = false;
            this.rebuildRows();
        }
    }

    /** Текущий запрос — наблюдаемость для тестов. */
    public getQuery(): string {
        return this.queryInput.inputState.value;
    }

    private rebuildRows(): void {
        const entries = filterExtensionEntries(this.service.getEntries(), this.getQuery());
        const catalog = entries.filter((e) => e.latestVersion !== null);
        const installed = entries.filter((e) => e.installedVersion !== null);

        this.list.clear();
        this.actions.clear();

        const error = this.service.getCatalogError();
        if (error !== null) {
            this.appendGroup(MARKETPLACE_GROUP_ID, "MARKETPLACE");
            // Действие впереди причины: строка кликабельна, и первое слово
            // говорит, что с ней можно сделать.
            const row = new TextLabelElement(`Retry — ${error}`);
            row.id = ERROR_ROW_ID;
            row.setColors("editorWarning.foreground", INHERITED_BG);
            this.list.appendRow(row, { parentId: MARKETPLACE_GROUP_ID });
            this.actions.set(ERROR_ROW_ID, { kind: "retry" });
        } else if (catalog.length > 0) {
            this.appendGroup(MARKETPLACE_GROUP_ID, "MARKETPLACE");
            for (const entry of catalog) this.appendEntry(MARKETPLACE_GROUP_ID, entry);
        }

        if (installed.length > 0) {
            this.appendGroup(INSTALLED_GROUP_ID, "INSTALLED");
            for (const entry of installed) this.appendEntry(INSTALLED_GROUP_ID, entry);
        }

        if (this.list.rowCount === 0) {
            const row = new TextLabelElement(this.loading ? "Loading extensions…" : "No extensions found");
            row.id = this.loading ? LOADING_ROW_ID : EMPTY_ROW_ID;
            row.setColors("descriptionForeground", INHERITED_BG);
            this.list.appendRow(row);
        }
    }

    private appendGroup(id: string, title: string): void {
        this.list.appendRow(buildGroupRow(id, title, "descriptionForeground"));
    }

    private appendEntry(groupId: string, entry: IExtensionListEntry): void {
        // Одна запись может стоять в обеих секциях — id строки несёт секцию,
        // иначе вторая строка перетёрла бы первую. Точки в id меняем на дефисы:
        // селектор инспектора (`#id`) точку не понимает (конвенция контейнеров view).
        const rowId = `${groupId}-${entry.id.replaceAll(".", "-")}`;
        this.list.appendRow(buildExtensionRow(rowId, entry, ROW_STYLES), {
            parentId: groupId,
            label: entry.displayName,
        });
        this.actions.set(rowId, { kind: "open", id: entry.id });
    }

    private activateRow(rowId: string): void {
        // Обе ветки явные: «всё остальное» как fallback означало бы, что строка
        // с испорченным действием молча делает что-то одно из двух.
        const action = this.actions.get(rowId);
        if (action?.kind === "open") {
            void this.openExtensionPage(action.id);
            return;
        }
        if (action?.kind === "retry") void this.refresh();
    }

    /**
     * Открывает страницу расширения. Мету тянем здесь, а не в панели: сетевой
     * сбой обязан доехать до страницы текстом, а не оставить пустую вкладку.
     */
    public async openExtensionPage(id: string): Promise<void> {
        const entry = this.service.getEntries().find((e) => e.id === id);
        if (entry === undefined) return;
        let meta;
        let metaError: string | null = null;
        try {
            meta = await this.service.getMeta(id);
        } catch (error) {
            metaError = error instanceof Error ? error.message : String(error);
        }
        this.editorTarget.openPane(new ExtensionEditorPane(this.service, entry, meta, metaError));
    }
}
