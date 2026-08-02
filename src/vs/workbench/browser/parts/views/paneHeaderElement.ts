import { BoxConstraints, type Point, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import type { TUIEventBase } from "../../../../../../tuidom/dom/events/tuiEventBase.ts";
import type { TUIKeyboardEvent } from "../../../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import type { TUIContextMenuEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";

const ICON_EXPANDED = ""; //  nf-fa-angle_down — как в ListViewElement/TreeViewElement
const ICON_COLLAPSED = ""; //  nf-fa-angle_right

/** Кнопка «⋯» — правые 3 колонки заголовка (пробел-глиф-пробел, чтобы hover-фон читался как кнопка). */
const MENU_LABEL = " ⋯ ";
const MENU_ZONE_WIDTH = 3;

/** Экранная точка для якоря меню секции (куда откроется popup). */
export interface IPaneMenuAnchor {
    readonly screenX: number;
    readonly screenY: number;
}

/**
 * Заголовок view-секции сайдбара ({@link PaneViewElement}): шеврон + название +
 * всегда видимая кнопка «⋯» справа. Composed из готовых контролов (HFlex,
 * TextLabel, Filler), но дети — презентационные: хит-тест всегда возвращает сам
 * заголовок (как строки ListViewElement), потому что pointer capture работает
 * только когда захватчик — цель хит-теста.
 *
 * Заголовок — одновременно и drag-handle границы над собой (аналог
 * {@link SashElement}, отдельный сэш-ряд съел бы строку): пока зажата левая
 * кнопка, capture шлёт move/up сюда, и сдвиг по Y репортится наверх через
 * {@link onDrag}. Клик без сдвига — {@link onToggle} (или {@link onMenu}, если
 * попал в зону «⋯»); работать надо на сырых mousedown/up, потому что capture
 * синтезирует `click` даже после drag. Клавиатура: Enter/Space — toggle,
 * Shift+F10/правый клик — единое событие `contextmenu` движка → {@link onMenu}.
 */
export class PaneHeaderElement extends TUIElement {
    /** Клик по заголовку вне зоны «⋯» (без drag) — свернуть/развернуть секцию. */
    public onToggle?: () => void;
    /** Перетаскивание границы: абсолютная экранная строка, куда тянут верх заголовка. */
    public onDrag?: (boundaryScreenY: number) => void;
    /** Запрос меню секции (кнопка «⋯», правый клик или Shift+F10). */
    public onMenu?: (anchor: IPaneMenuAnchor) => void;

    private readonly titleLabel: TextLabelElement;
    private readonly menuLabel: TextLabelElement;
    private readonly row: HFlexElement;
    private readonly title: string;
    private expanded = true;
    private dragEnabled = false;

    // Состояние нажатия для различения click/drag (см. док-коммент класса).
    private pressed = false;
    private dragMoved = false;
    private pressScreenX = 0;
    private pressScreenY = 0;
    private pressLocalX = 0;

    public constructor(title: string) {
        super();
        this.title = title;
        this.focusable = true;
        this.capturesPointer = true;
        // Цвета покоя наследуются от вьюлета (sideBar.*) — как в VS Code, где
        // sideBarSectionHeader.background прозрачен; свой токен не берём, потому
        // что альфа при парсинге тем отбрасывается и «прозрачный» из dark+
        // выродился бы в чёрный.
        this.style = { when: [{ states: ["focus"], bg: "list.hoverBackground" }] };

        this.titleLabel = new TextLabelElement(this.composeTitle());
        this.menuLabel = new TextLabelElement(MENU_LABEL);
        // «⋯» приглушена, но видима всегда (hover в TUI ненадёжен — мыши может
        // не быть); подсветка фоном — когда курсор где-то на заголовке (in:hover).
        this.menuLabel.style = {
            fg: "descriptionForeground",
            when: [{ states: ["in:hover"], bg: "toolbar.hoverBackground" }],
        };
        this.row = new HFlexElement();
        this.row.addChild(this.titleLabel, { width: hflexFit(), height: 1 });
        this.row.addChild(new FillerElement(), { width: hflexFill(), height: 1 });
        this.row.addChild(this.menuLabel, { width: hflexFixed(MENU_ZONE_WIDTH), height: 1 });
        this.appendChild(this.row);

        this.addEventListener("mousedown", (event) => {
            if (event.button !== "left") return;
            this.pressed = true;
            this.dragMoved = false;
            this.pressScreenX = event.screenX;
            this.pressScreenY = event.screenY;
            this.pressLocalX = event.localX;
        });
        this.addEventListener("mousemove", (event) => {
            if (!this.pressed) return;
            if (!this.dragMoved && event.screenY === this.pressScreenY) return;
            // Любой сдвиг по Y — это drag: отпускание больше не считается кликом,
            // даже если ресайз в эту сторону запрещён.
            this.dragMoved = true;
            if (this.dragEnabled) this.onDrag?.(event.screenY);
        });
        this.addEventListener("mouseup", (event) => {
            if (!this.pressed) return;
            this.pressed = false;
            if (this.dragMoved || event.defaultPrevented) return;
            if (this.isInMenuZone(this.pressLocalX)) {
                this.onMenu?.({ screenX: this.pressScreenX, screenY: this.pressScreenY });
            } else {
                this.onToggle?.();
            }
        });
        this.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            const menuEvent = event as TUIContextMenuEvent;
            const anchor =
                menuEvent.trigger === "keyboard"
                    ? this.menuZoneAnchor()
                    : { screenX: menuEvent.screenX, screenY: menuEvent.screenY };
            this.onMenu?.(anchor);
        });
    }

    public get isExpanded(): boolean {
        return this.expanded;
    }

    public setExpanded(expanded: boolean): void {
        if (this.expanded === expanded) return;
        this.expanded = expanded;
        this.titleLabel.setText(this.composeTitle());
    }

    /** Контейнер отключает drag, когда выше/ниже нет развёрнутой секции. */
    public setDragEnabled(enabled: boolean): void {
        this.dragEnabled = enabled;
    }

    public get isDragEnabled(): boolean {
        return this.dragEnabled;
    }

    private composeTitle(): string {
        return ` ${this.expanded ? ICON_EXPANDED : ICON_COLLAPSED} ${this.title}`;
    }

    private isInMenuZone(localX: number): boolean {
        // Позиция «⋯» известна из последнего layout; на узком заголовке HFlex
        // клипует её в ноль — зона исчезает вместе с кнопкой.
        if (this.menuLabel.layoutSize.width === 0) return false;
        const zoneStart = this.menuLabel.localPosition.dx;
        return localX >= zoneStart && localX < zoneStart + MENU_ZONE_WIDTH;
    }

    private menuZoneAnchor(): IPaneMenuAnchor {
        return {
            screenX: this.globalPosition.x + this.menuLabel.localPosition.dx,
            screenY: this.globalPosition.y,
        };
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.layoutChild(this.row, 0, 0, BoxConstraints.tight(size));
        return size;
    }

    protected override hitTestChildren(_point: Point): TUIElement | null {
        // Дети презентационные: вся мышь принадлежит заголовку — иначе pointer
        // capture (drag границы) не сработает, когда нажатие пришлось на лейбл.
        return null;
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const keyEvent = event as TUIKeyboardEvent;
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
            event.preventDefault();
            this.onToggle?.();
        }
    }

    public override inspectState(): Record<string, unknown> {
        return { title: this.title, expanded: this.expanded, dragEnabled: this.dragEnabled };
    }
}
