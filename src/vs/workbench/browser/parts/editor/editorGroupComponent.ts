import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import type { TabInfo } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";
import type { EditorTitleMenuContext } from "../../actions/menuContexts.ts";
import { Component } from "../../component.ts";

import { computeTabLabels } from "./tabLabels.ts";
import { TextEditorPane } from "./textEditorPane.ts";

/**
 * Компонент одной группы редакторов: собирает группу из примитивов tuidom —
 * {@link OverlayHostElement} (локальный OverlayLayer для find-виджета) поверх
 * VFlex [tab strip (1 ряд), контент-слот (остаток)] — и отражает в ней
 * состояние СВОЕЙ {@link EditorGroup} — по {@link EditorGroup.onDidChangeEditors}
 * вставляет view активной вкладки и перерисовывает табы (метки с разводкой
 * тёзок, иконки, маркер изменённости, активная вкладка). Пустой слот занимает
 * филлер, крашеный editor.background; у пустой группы он focusable — «фокус в
 * группе» существует и без вкладок (US-4/47). Клики по табам возвращаются в
 * группу (`activateTab`; крестик — `IEditorService.closeEditor` с координатой
 * группы, confirm-флоу решает сервис). Любой фокус
 * внутри поддерева группы (клик в текст, таб, филлер) капчурится и делает
 * группу активной ({@link IEditorGroupsService.notifyGroupFocused}).
 *
 * Не DI-сервис: инстансы создаёт {@link EditorPartComponent} — по контролу на
 * группу полосы.
 */
export class EditorGroupComponent extends Component {
    public readonly view: OverlayHostElement;

    private readonly vflex = new VFlexElement();
    private readonly tabStrip = new EditorTabStripElement();
    /** Держит и красит пустую область группы, пока не открыт ни один редактор. */
    private readonly emptyFiller = new FillerElement();
    /** Текущий житель контент-слота: view активной pane либо emptyFiller. */
    private contentSlot: TUIElement;

    public constructor(
        public readonly group: EditorGroup,
        private readonly editorService: IEditorService,
        private readonly contextMenuService: ContextMenuService,
        private readonly groups: IEditorGroupsService,
    ) {
        super();
        this.view = new OverlayHostElement();
        // Стабильный e2e-селектор: editorGroup-<id> (id группы, не ViewColumn —
        // номер колонки пересчитывается при схлопывании).
        this.view.id = `editorGroup-${String(group.id)}`;
        // emptyFiller наследует editor.background от view через каскад.
        this.view.style = { fg: "editor.foreground", bg: "editor.background" };
        this.tabStrip.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.contentSlot = this.emptyFiller;
        this.syncSlot(this.emptyFiller);
        this.view.setContent(this.vflex);
        // Фокус в поддереве группы = группа активна. Capture: до того, как фокус
        // обработают вложенные виджеты; сам фокус уже уехал — только события.
        this.view.addEventListener(
            "focus",
            () => {
                this.groups.notifyGroupFocused(this.group);
            },
            { capture: true },
        );
        this.tabStrip.onTabActivate = (index) => {
            this.group.activateTab(index);
        };
        this.tabStrip.onTabClose = (index) => {
            // Индекс приходит из tab strip и всегда указывает на существующую
            // вкладку любого вида (дифф тоже закрывается крестиком). Диалог —
            // только у последней поверхности документа: это решает сервис.
            void this.editorService.closeEditor(this.group, index);
        };
        this.tabStrip.onTabContextMenu = (index, screenX, screenY) => {
            this.showTabContextMenu(index, screenX, screenY);
        };
        this.register(
            this.group.onDidChangeEditors(() => {
                this.syncFromGroup();
            }),
        );
        this.syncFromGroup();
    }

    /**
     * Фокус содержимого группы: активная вкладка либо филлер пустой группы.
     * Зовёт `EditorPartComponent` по фокус-командам и после сплита.
     */
    public focusContent(): void {
        const pane = this.group.activePane;
        if (pane !== null) pane.focusEditor();
        else this.emptyFiller.focus();
    }

    /**
     * Меню правого клика по вкладке. Цель — вкладка ПОД КУРСОРОМ: активную она
     * не меняет (как в VS Code), поэтому её адрес и признаки состава группы
     * уезжают в `menuContext` — оттуда пункты берут аргументы команд и решают
     * свою видимость. Владелец меню — view группы: у неё свой overlay-слой.
     */
    private showTabContextMenu(index: number, screenX: number, screenY: number): void {
        const panes = this.group.getPanes();
        const pane = panes.at(index);
        /* v8 ignore start -- индекс приходит из tab strip и всегда указывает на существующую вкладку */
        // Stryker disable next-line ConditionalExpression: ветка недостижима по той же причине, что и для покрытия
        if (pane === undefined) return;
        /* v8 ignore stop */
        const menuContext: EditorTitleMenuContext = {
            groupId: this.group.id,
            index,
            // Путь есть только у текстовой вкладки файла: у безымянного буфера и
            // у диффа его нет, и файловые пункты (пути, reveal) прячутся.
            path: pane instanceof TextEditorPane ? pane.absoluteFilePath : null,
            tabCount: panes.length,
            hasTabsToTheRight: index < panes.length - 1,
            hasSavedTabs: panes.some((candidate) => !candidate.isModified),
            isPreview: !this.group.isPinned(pane),
        };
        this.contextMenuService.showContextMenu({
            getOwner: () => this.view,
            getAnchor: () => ({ screenX, screenY }),
            menuId: MenuId.EditorTitleContext,
            menuContext,
        });
    }

    /** Вставляет жителя контент-слота: [tabStrip, слот] одним replaceChildren. */
    private syncSlot(slot: TUIElement): void {
        slot.layoutStyle = { height: vflexFill(), width: "fill" };
        this.vflex.replaceChildren([this.tabStrip, slot]);
        this.contentSlot = slot;
    }

    /** Приводит контрол к состоянию группы: контент активной вкладки + табы. */
    private syncFromGroup(): void {
        const activeView = this.group.activePane?.view ?? null;
        const next = activeView ?? this.emptyFiller;
        // Пустая группа — легальный адресат фокуса (Ctrl+P откроет файл в неё);
        // при появлении вкладки филлер из фокус-порядка уходит.
        this.emptyFiller.focusable = this.group.editorCount === 0;
        // Guard от повторной вставки того же view: replaceChildren перевешивает
        // parent, а активная вкладка меняется реже, чем файрится onDidChangeEditors.
        if (this.contentSlot !== next) {
            this.syncSlot(next);
        }
        this.syncTabs();
    }

    private syncTabs(): void {
        const editors = this.group.getPanes();
        const labels = computeTabLabels(editors, (editor) => this.editorService.displayName(editor));
        const tabs: TabInfo[] = editors.map((editor, i) => {
            const fi = getFileIcon(this.editorService.displayName(editor));
            return {
                label: labels[i],
                icon: fi.icon,
                iconColor: fi.color,
                isModified: editor.isModified,
                isReadOnly: editor.readOnly,
            };
        });

        this.tabStrip.setTabs(tabs);
        this.tabStrip.activeIndex = this.group.activeIndex;
    }
}
