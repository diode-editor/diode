import * as path from "node:path";

import type { TUIElement } from "@tuidom/all/dom/tuiElement";
import { OverlayHostElement } from "@tuidom/all/ui/contextview/overlayHostElement";
import type { TabInfo } from "@tuidom/all/ui/editorgroup/editorTabStripElement";
import { EditorTabStripElement } from "@tuidom/all/ui/editorgroup/editorTabStripElement";
import { FillerElement } from "@tuidom/all/ui/layout/fillerElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/all/ui/layout/vFlexElement";
import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";
import { Component } from "../../component.ts";

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
 * группу (`activateTab`/`closeTab`; закрытие «грязной» вкладки — через
 * `EditorService.onRequestConfirmClose` с координатой группы). Любой фокус
 * внутри поддерева группы (клик в текст, таб, филлер) капчурится и делает
 * группу активной ({@link EditorService.notifyGroupFocused}).
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
        private readonly editorService: EditorService,
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
                this.editorService.notifyGroupFocused(this.group);
            },
            { capture: true },
        );
        this.tabStrip.onTabActivate = (index) => {
            this.group.activateTab(index);
        };
        this.tabStrip.onTabClose = (index) => {
            // Индекс приходит из tab strip и всегда указывает на существующую вкладку.
            // Именно getPane, а не getEditor: закрывать надо вкладку любого вида,
            // иначе не-текстовую панель (дифф) нельзя было бы закрыть крестиком.
            const editor = this.group.getPane(index);
            /* v8 ignore start -- индекс из tab strip всегда указывает на существующую вкладку; null — недостижимый инвариант-гард */
            if (editor === null) return;
            /* v8 ignore stop */
            // Диалог — только у последней поверхности документа: пока он виден
            // где-то ещё, несохранённые правки живут в общей модели и не теряются.
            const needsConfirm = this.editorService.needsCloseConfirm(editor);
            if (needsConfirm && this.editorService.onRequestConfirmClose) {
                this.editorService.onRequestConfirmClose(this.group, index);
            } else {
                this.group.closeTab(index);
            }
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
        this.tabStrip.activeIndex = this.group.activeIndex;
    }

    /**
     * Метки вкладок: обычно это имя файла, но если несколько открытых файлов
     * ЭТОЙ группы делят один basename, к ним добавляется минимальный различающий
     * суффикс родительского пути (как в VS Code), чтобы вкладки нельзя было
     * спутать. Дизамбигуация пер-стрип: чужие группы свои метки разводят сами.
     */
    private computeTabLabels(): string[] {
        const editors = this.group.getPanes();
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
