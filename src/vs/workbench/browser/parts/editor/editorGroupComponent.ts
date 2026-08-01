import * as path from "node:path";

import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { OverlayHostElement } from "../../../../../../tuidom/ui/contextview/overlayHostElement.ts";
import type { TabInfo } from "../../../../../../tuidom/ui/editorgroup/editorTabStripElement.ts";
import { EditorTabStripElement } from "../../../../../../tuidom/ui/editorgroup/editorTabStripElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import { VFlexElement, vflexFill, vflexFixed } from "../../../../../../tuidom/ui/layout/vFlexElement.ts";
import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";
import { Component } from "../../component.ts";

import type { IEditorPane } from "./iEditorPane.ts";

export const EditorGroupComponentDIToken = token<EditorGroupComponent>("EditorGroupComponent");

/**
 * Компонент группы редакторов: собирает группу из примитивов tuidom —
 * {@link OverlayHostElement} (локальный OverlayLayer для find-виджета) поверх
 * VFlex [tab strip (1 ряд), контент-слот (остаток)] — и отражает в ней
 * состояние {@link EditorService} — по {@link EditorService.onDidChangeEditors}
 * вставляет view активного {@link TextEditorPane} и перерисовывает табы (метки с
 * разводкой тёзок, иконки, маркер изменённости, активная вкладка). Пустой слот
 * занимает филлер, крашеный editor.background. Клики по табам возвращаются в
 * сервис (`activateTab`/`closeTab`; закрытие «грязной» вкладки — через
 * `onRequestConfirmClose`).
 */
export class EditorGroupComponent extends Component {
    public static dependencies = [EditorServiceDIToken] as const;

    public readonly view: OverlayHostElement;

    private readonly vflex = new VFlexElement();
    private readonly tabStrip = new EditorTabStripElement();
    /** Держит и красит пустую область группы, пока не открыт ни один редактор. */
    private readonly emptyFiller = new FillerElement();
    /** Текущий житель контент-слота: view активной pane либо emptyFiller. */
    private contentSlot: TUIElement;

    public constructor(private readonly editorService: EditorService) {
        super();
        this.view = new OverlayHostElement();
        this.view.id = "editorGroup";
        // emptyFiller наследует editor.background от view через каскад.
        this.view.style = { fg: "editor.foreground", bg: "editor.background" };
        this.tabStrip.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.contentSlot = this.emptyFiller;
        this.syncSlot(this.emptyFiller);
        this.view.setContent(this.vflex);
        this.tabStrip.onTabActivate = (index) => {
            this.editorService.activateTab(index);
        };
        this.tabStrip.onTabClose = (index) => {
            // Индекс приходит из tab strip и всегда указывает на существующую вкладку.
            // Именно getPane, а не getEditor: закрывать надо вкладку любого вида,
            // иначе не-текстовую панель (дифф) нельзя было бы закрыть крестиком.
            const editor = this.editorService.getPane(index);
            /* v8 ignore start -- индекс из tab strip всегда указывает на существующую вкладку; null — недостижимый инвариант-гард */
            if (editor === null) return;
            /* v8 ignore stop */
            if (editor.isModified && this.editorService.onRequestConfirmClose) {
                this.editorService.onRequestConfirmClose(index);
            } else {
                this.editorService.closeTab(index);
            }
        };
        this.register(
            this.editorService.onDidChangeEditors(() => {
                this.syncFromService();
            }),
        );
        this.syncFromService();
    }

    /** Вставляет жителя контент-слота: [tabStrip, слот] одним replaceChildren. */
    private syncSlot(slot: TUIElement): void {
        slot.layoutStyle = { height: vflexFill(), width: "fill" };
        this.vflex.replaceChildren([this.tabStrip, slot]);
        this.contentSlot = slot;
    }

    /** Приводит контрол к состоянию сервиса: контент активного редактора + табы. */
    private syncFromService(): void {
        // Именно ВКЛАДКА: `getActivePane()` следует за фокусом и при работе в
        // нижней панели вернул бы её detached-редактор — группа вставила бы его
        // вместо файла, и область редактора оказывалась пустой.
        const activeView = this.editorService.getActiveTabPane()?.view ?? null;
        const next = activeView ?? this.emptyFiller;
        // Guard от повторной вставки того же view: replaceChildren перевешивает
        // parent, а активный редактор меняется реже, чем файрится onDidChangeEditors.
        if (this.contentSlot !== next) {
            this.syncSlot(next);
        }
        this.syncTabs();
    }

    private syncTabs(): void {
        const editors = this.editorService.getPanes();
        const labels = this.computeTabLabels();
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
        this.tabStrip.activeIndex = this.editorService.activeIndex;
    }

    /**
     * Метки вкладок: обычно это имя файла, но если несколько открытых файлов
     * делят один basename, к ним добавляется минимальный различающий суффикс
     * родительского пути (как в VS Code), чтобы вкладки нельзя было спутать.
     */
    private computeTabLabels(): string[] {
        const editors = this.editorService.getPanes();
        const names = editors.map((editor) => this.editorService.displayName(editor));
        const groups = new Map<string, number[]>();
        names.forEach((name, i) => {
            const arr = groups.get(name);
            if (arr) arr.push(i);
            else groups.set(name, [i]);
        });

        const labels = [...names];
        for (const indices of groups.values()) {
            if (indices.length < 2) continue;
            const dirs = indices.map((i) => {
                const uri = editors[i].uri;
                // Гейт по схеме, а не по «путь непустой»: fsPath у не-file схемы вернёт
                // мусор, а не бросит. В группу тёзок не-file и не попадёт — метки
                // безымянных буферов уникальны по построению (Untitled-N).
                /* v8 ignore start -- defensive: одинаковый displayName бывает только у файлов */
                if (uri.scheme !== "file") return [];
                /* v8 ignore stop */
                // Путь уже абсолютный: подъём в Uri.file идёт через path.resolve.
                return path.dirname(uri.fsPath).split(path.sep).filter(Boolean);
            });
            const maxK = Math.max(0, ...dirs.map((d) => d.length));
            indices.forEach((editorIndex, a) => {
                // Минимальный хвост родительского пути, отличающий этот файл от
                // остальных в группе. Файлы-тёзки всегда различаются по пути
                // (дедуп в openFile), поэтому уникальный хвост существует всегда.
                let suffix = dirs[a].slice(-maxK).join(path.sep);
                for (let k = 1; k <= maxK; k++) {
                    const mine = dirs[a].slice(-k).join(path.sep);
                    const collision = dirs.some((d, b) => b !== a && d.slice(-k).join(path.sep) === mine);
                    if (!collision) {
                        suffix = mine;
                        break;
                    }
                }
                labels[editorIndex] = `${names[editorIndex]} — ${suffix}`;
            });
        }
        return labels;
    }
}
