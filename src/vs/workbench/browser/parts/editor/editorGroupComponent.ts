import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import type { TabInfo } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFit } from "@tuidom/elements/layout/hFlexElement";
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

import { EditorTitleActions, type IEditorTitleActionsServices } from "./editorTitleActions.ts";
import { computeTabLabels } from "./tabLabels.ts";
import { TextEditorPane } from "./textEditorPane.ts";

/**
 * Пустой слот занимает филлер; у пустой группы он focusable — «фокус в группе»
 * существует и без вкладок (US-4/47). Любой фокус в поддереве делает группу активной.
 */
export class EditorGroupComponent extends Component {
    public readonly view: OverlayHostElement;

    private readonly vflex = new VFlexElement();
    private readonly tabStrip = new EditorTabStripElement();
    private readonly titleRow = new HFlexElement();
    private readonly titleActions: EditorTitleActions | null;
    private readonly emptyFiller = new FillerElement();
    private contentSlot: TUIElement;

    public constructor(
        public readonly group: EditorGroup,
        private readonly editorService: IEditorService,
        private readonly contextMenuService: ContextMenuService,
        private readonly groups: IEditorGroupsService,
        titleActions?: IEditorTitleActionsServices,
    ) {
        super();
        this.titleActions =
            titleActions === undefined ? null : this.register(new EditorTitleActions(group.id, titleActions));
        this.titleRow.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.view = new OverlayHostElement();
        // id группы, не ViewColumn: номер колонки пересчитывается при схлопывании.
        this.view.id = `editorGroup-${String(group.id)}`;
        // emptyFiller наследует фон через каскад.
        this.view.style = { fg: "editor.foreground", bg: "editor.background" };
        this.tabStrip.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.contentSlot = this.emptyFiller;
        this.syncSlot(this.emptyFiller);
        this.view.setContent(this.vflex);
        // Capture: до того, как фокус обработают вложенные виджеты.
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
            // Диалог — только у последней поверхности документа: это решает сервис.
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
        if (this.titleActions !== null) {
            this.register(
                this.titleActions.onDidChangeVisibility(() => {
                    this.syncSlot(this.contentSlot);
                }),
            );
        }
        this.syncFromGroup();
    }

    public focusContent(): void {
        const pane = this.group.activePane;
        if (pane !== null) pane.focusEditor();
        else this.emptyFiller.focus();
    }

    /**
     * Цель — вкладка ПОД КУРСОРОМ: активную она не меняет (как в VS Code), поэтому
     * её адрес уезжает в `menuContext`, откуда пункты берут аргументы и видимость.
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
            path: pane instanceof TextEditorPane ? pane.absoluteFilePath : null,
            resourceScheme: pane.uri.scheme,
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

    private syncSlot(slot: TUIElement): void {
        slot.layoutStyle = { height: vflexFill(), width: "fill" };
        this.vflex.replaceChildren([this.syncTitleRow(), slot]);
        this.contentSlot = slot;
    }

    /** С пустой панелью действий — tab strip как есть (дерево и кадр — как до панели). */
    private syncTitleRow(): TUIElement {
        if (this.titleActions?.isVisible !== true) {
            this.tabStrip.layoutStyle = { height: vflexFixed(1), width: "fill" };
            return this.tabStrip;
        }
        this.tabStrip.layoutStyle = { height: 1, width: hflexFill() };
        this.titleActions.element.layoutStyle = { height: 1, width: hflexFit() };
        this.titleRow.replaceChildren([this.tabStrip, this.titleActions.element]);
        return this.titleRow;
    }

    private syncFromGroup(): void {
        const activeView = this.group.activePane?.view ?? null;
        const next = activeView ?? this.emptyFiller;
        // Пустая группа — легальный адресат фокуса (Ctrl+P откроет файл в неё).
        this.emptyFiller.focusable = this.group.editorCount === 0;
        // replaceChildren перевешивает parent, а onDidChangeEditors файрится чаще
        // смены активной вкладки.
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
                isDeleted: editor.isOrphaned === true,
            };
        });

        this.tabStrip.setTabs(tabs);
        this.tabStrip.activeIndex = this.group.activeIndex;
    }
}
