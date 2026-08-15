import type { TUIContextMenuEvent, TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIStyle } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import type { HFlexChildSize } from "@tuidom/elements/layout/hFlexElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { CHECKED_ICON } from "../../../../platform/actions/common/menuRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStatusBarEntry, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";
import { Component } from "../../component.ts";

export const StatusBarComponentDIToken = token<StatusBarComponent>("StatusBarComponent");

/**
 * Стиль кликабельного сегмента: подсветка под курсором, как у элемента с
 * командой в VS Code. Инертные сегменты (`Ln X, Col Y`, язык) её не получают —
 * подсветка обещает клик, которого нет.
 */
const CLICKABLE_STYLE: TUIStyle = {
    when: [{ states: ["hover"], bg: "statusBarItem.hoverBackground", fg: "statusBarItem.hoverForeground" }],
};
const INERT_STYLE: TUIStyle = {};

/**
 * Компонент статус-бара: собирает полосу из примитивов tuidom (HFlex +
 * TextLabel + Filler) и отражает в ней записи {@link StatusBarService}
 * (обновление по `onDidChangeEntries`). Про поставщиков записей ничего не
 * знает — сегменты публикуют contribution-сервисы (`EditorStatusContribution`
 * и др.).
 *
 * Дерево строится один раз и мутируется на месте (паттерн FindComponent):
 * пока состав сторон не меняется, обновляются только тексты лейблов — путь
 * курсора `Ln X, Col Y` не пересобирает поддерево на каждое нажатие.
 * Пересборка `replaceChildren` происходит лишь при смене числа сегментов;
 * лейблы живут в монотонно растущем пуле.
 *
 * Правый клик по полосе открывает меню видимости сегментов (галочки +
 * «Hide 'X'» для сегмента под курсором) — переключает {@link StatusBarService}.
 */
export class StatusBarComponent extends Component {
    public static dependencies = [StatusBarServiceDIToken, ContextMenuServiceDIToken] as const;

    public readonly view: HFlexElement;

    /**
     * Краевые паддинги полосы. Правый — не только воздух: нижне-правую ячейку
     * терминала рендер вообще никогда не пишет (запись туда провоцирует
     * hardware scroll — см. terminalRenderer), и паддинг гарантирует, что в
     * эту нерисуемую ячейку не попадёт значимый символ последнего сегмента.
     */
    private readonly padLeft = new FillerElement();
    private readonly padRight = new FillerElement();
    /** Заполняет середину между сторонами и красит фон полосы. */
    private readonly centerFill = new FillerElement();
    private readonly leftLabels: TextLabelElement[] = [];
    private readonly rightLabels: TextLabelElement[] = [];
    private currentLeft: readonly IStatusBarEntry[] = [];
    private currentRight: readonly IStatusBarEntry[] = [];

    public constructor(
        private readonly statusBarService: StatusBarService,
        private readonly contextMenuService: ContextMenuService,
    ) {
        super();
        this.view = new HFlexElement();
        this.view.id = "statusBar";
        // Лейблы и паддинги своих цветов не задают — наследуют fg/bg полосы
        // через каскад; токены резолвит тема на корне.
        this.view.style = { fg: "statusBar.foreground", bg: "statusBar.background" };
        this.view.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            this.showVisibilityMenu(event as TUIContextMenuEvent);
        });
        this.register(
            this.statusBarService.onDidChangeEntries(() => {
                this.renderEntries();
            }),
        );
        this.renderEntries();
    }

    private renderEntries(): void {
        const entries = this.statusBarService.entries();
        const left = entries.filter((entry) => entry.alignment !== "right");
        const right = entries.filter((entry) => entry.alignment === "right");
        const structureChanged = left.length !== this.currentLeft.length || right.length !== this.currentRight.length;
        this.currentLeft = left;
        this.currentRight = right;

        this.ensureLabels(this.leftLabels, "left", left.length);
        this.ensureLabels(this.rightLabels, "right", right.length);
        left.forEach((entry, i) => {
            this.syncLabel(this.leftLabels[i], entry);
        });
        right.forEach((entry, i) => {
            this.syncLabel(this.rightLabels[i], entry);
        });

        if (structureChanged) {
            this.rebuildChildren();
        }
    }

    /**
     * Приводит лейбл к записи: текст с краевыми пробелами (подсветка под
     * курсором накрывает сегмент с воздухом, как блок элемента в VS Code),
     * hover-стиль по кликабельности и id по записи. Присваивание стиля равным
     * значением сеттер отсекает сам, текст сверяем здесь — иначе каждое
     * движение курсора помечало бы лейбл грязным.
     *
     * Id лейбла едет за записью, а не за индексом в пуле: селектор
     * `#statusBarItem-status-scm-branch` должен указывать на сегмент ветки,
     * какой бы лейбл пула его сейчас ни рисовал. Точки в id меняем на дефисы —
     * селекторы инспектора/e2e их не поддерживают (как в `ViewsService`).
     */
    private syncLabel(label: TextLabelElement, entry: IStatusBarEntry): void {
        const text = ` ${entry.text} `;
        if (label.getText() !== text) label.setText(text);
        label.style = entry.onClick !== undefined ? CLICKABLE_STYLE : INERT_STYLE;
        label.id = `statusBarItem-${entry.id.replaceAll(".", "-")}`;
    }

    /**
     * Доращивает пул лейблов до нужного размера. Клик-слушатель вешается один
     * раз при создании и замыкает (сторона, индекс): колбэк записи резолвится
     * в момент клика из текущего снапшота, поэтому переиспользование лейбла
     * под другую запись ничего не перевешивает, а запись без onClick инертна.
     *
     * Команду запускает только ЛЕВАЯ кнопка: правый клик по сегменту — это
     * запрос меню видимости, и заодно чекаутить ветку он не должен.
     */
    private ensureLabels(pool: TextLabelElement[], side: "left" | "right", count: number): void {
        while (pool.length < count) {
            const index = pool.length;
            const label = new TextLabelElement("");
            label.addEventListener("click", (event) => {
                if ((event as TUIMouseEvent).button !== "left") return;
                const current = side === "left" ? this.currentLeft : this.currentRight;
                current[index]?.onClick?.();
            });
            pool.push(label);
        }
    }

    /**
     * Пересобирает детей полосы: [padL, левые сегменты, centerFill, правые
     * сегменты, padR]. Отдельных разделителей нет — соседние сегменты
     * разделяют собственные краевые пробелы, как блоки элементов в VS Code.
     * Каждая колонка покрыта каким-то ребёнком, поэтому фон полосы красится
     * без собственного render у HFlex. При нехватке ширины centerFill
     * схлопывается в 0 — правая группа теряет правое выравнивание и обрезается
     * краем экрана.
     */
    private rebuildChildren(): void {
        const children: TUIElement[] = [];
        const push = (element: TUIElement, width: HFlexChildSize): void => {
            element.layoutStyle = { width, height: 1 };
            children.push(element);
        };

        push(this.padLeft, hflexFixed(1));
        this.currentLeft.forEach((_, i) => {
            push(this.leftLabels[i], hflexFit());
        });
        push(this.centerFill, hflexFill());
        this.currentRight.forEach((_, i) => {
            push(this.rightLabels[i], hflexFit());
        });
        push(this.padRight, hflexFixed(1));

        this.view.replaceChildren(children);
    }

    /**
     * Меню видимости: галочки по всем именованным записям (включая скрытые —
     * иначе их нечем вернуть) и «Hide 'X'» для сегмента под курсором. Правый
     * клик мимо сегментов даёт меню без «Hide» — это и есть путь назад, когда
     * скрыто всё.
     */
    private showVisibilityMenu(event: TUIContextMenuEvent): void {
        const target = this.entryOfLabel(event.target);
        this.contextMenuService.showContextMenu({
            getOwner: () => this.view,
            getAnchor: () => ({ screenX: event.screenX, screenY: event.screenY }),
            getEntries: () => this.visibilityMenuEntries(target),
        });
    }

    private visibilityMenuEntries(target: IStatusBarEntry | null): MenuEntry[] {
        const entries: MenuEntry[] = this.statusBarService
            .allEntries()
            .filter((entry) => entry.name !== undefined)
            .map((entry) => {
                const visible = !this.statusBarService.isHidden(entry.id);
                return {
                    label: entry.name!,
                    id: entry.id,
                    icon: visible ? CHECKED_ICON : undefined,
                    onSelect: () => {
                        this.statusBarService.setHidden(entry.id, visible);
                    },
                };
            });
        if (target?.name === undefined) return entries;
        return [
            ...entries,
            { type: "separator" },
            {
                label: `Hide '${target.name}'`,
                onSelect: () => {
                    this.statusBarService.setHidden(target.id, true);
                },
            },
        ];
    }

    /**
     * Запись, которой принадлежит лейбл-цель события (null — клик мимо
     * сегментов). Ищем среди ТЕКУЩИХ записей, а не по всему пулу: лейбл,
     * оставшийся в пуле от снятой записи, отцеплен от дерева и целью события
     * быть не может.
     */
    private entryOfLabel(target: TUIElement | null): IStatusBarEntry | null {
        const left = this.currentLeft.findIndex((_, i) => this.leftLabels[i] === target);
        if (left >= 0) return this.currentLeft[left];
        const right = this.currentRight.findIndex((_, i) => this.rightLabels[i] === target);
        return right >= 0 ? this.currentRight[right] : null;
    }
}
