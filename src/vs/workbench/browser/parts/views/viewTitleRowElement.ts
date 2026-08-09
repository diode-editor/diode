import type { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";

const ICON_EXPANDED = ""; //  nf-fa-angle_down — как в ListViewElement/TreeViewElement
const ICON_COLLAPSED = ""; //  nf-fa-angle_right

/** Глиф кнопки overflow-меню. */
const MENU_ICON = "⋯"; // ⋯

/**
 * Ширина кнопки заголовка: пробел-глиф-пробел, чтобы hover-фон читался как
 * кнопка, а соседние кнопки не слипались.
 */
const BUTTON_WIDTH = 3;

/** Inline-кнопка заголовка — пункт меню группы `navigation`, у которого есть иконка. */
export interface IViewTitleAction {
    /** Что вернёт {@link ViewTitleRowElement.hitZone}; обычно id команды. */
    readonly id: string;
    readonly icon: string;
}

/** Куда попал клик по строке заголовка. */
export type ViewTitleZone = { kind: "title" } | { kind: "action"; actionId: string } | { kind: "menu" };

export interface IViewTitleRowOptions {
    /**
     * Рисовать шеврон свёрнутости слева от названия. Заголовок контейнера и
     * несворачиваемая merged-секция шеврона не имеют.
     */
    readonly chevron?: boolean;
}

/**
 * Строка заголовка view/контейнера — общая презентация для
 * {@link import("./paneHeaderElement.ts").PaneHeaderElement} (секция сайдбара) и
 * {@link import("./viewContainerHeaderElement.ts").ViewContainerHeaderElement}
 * (заголовок активити):
 *
 * ```
 * [ ␣шеврон? ␣НАЗВАНИЕ ][ fill ][ виджет? ][ inline-кнопки ][ ⋯ ]
 * ```
 *
 * Жестов у строки нет — их ведёт владелец: мышь по лейблам он забирает себе
 * (иначе pointer capture для drag границы не сработает), поэтому попадание по
 * кнопке считается арифметикой зон, а не хит-тестом ребёнка — {@link hitZone}
 * и есть эта арифметика. Исключение — {@link hitTestWidget}: виджет заголовка
 * настоящий контрол, клики обязаны доходить до него.
 */
export class ViewTitleRowElement extends HFlexElement {
    private readonly titleLabel: TextLabelElement;
    private readonly filler = new FillerElement();
    private readonly menuLabel: TextLabelElement;
    private readonly chevron: boolean;

    private title: string;
    private expanded = true;
    private actions: readonly IViewTitleAction[] = [];
    private actionLabels: TextLabelElement[] = [];
    private titleWidget: TUIElement | null = null;
    private menuVisible = true;

    public constructor(title: string, options?: IViewTitleRowOptions) {
        super();
        this.title = title;
        this.chevron = options?.chevron ?? true;
        this.titleLabel = new TextLabelElement(this.composeTitle());
        this.menuLabel = new TextLabelElement(buttonLabel(MENU_ICON));
        this.menuLabel.style = buttonStyle();
        this.syncChildren();
    }

    public getTitle(): string {
        return this.title;
    }

    public setTitle(title: string): void {
        if (this.title === title) return;
        this.title = title;
        this.titleLabel.setText(this.composeTitle());
    }

    public get isExpanded(): boolean {
        return this.expanded;
    }

    public setExpanded(expanded: boolean): void {
        if (this.expanded === expanded) return;
        this.expanded = expanded;
        this.titleLabel.setText(this.composeTitle());
    }

    /** Inline-кнопки слева от «⋯», в порядке передачи. */
    public setActions(actions: readonly IViewTitleAction[]): void {
        if (sameActions(this.actions, actions)) return;
        this.actions = [...actions];
        this.syncChildren();
    }

    /**
     * Прятать ли кнопку «⋯». Заголовки сайдбара держат её всегда, а полоса
     * контролов в таб-строке панели — только когда в меню есть что показать:
     * там она стоит в одном ряду с табами и пустой кнопкой только мешает.
     */
    public setMenuVisible(visible: boolean): void {
        if (this.menuVisible === visible) return;
        this.menuVisible = visible;
        this.syncChildren();
    }

    /** Произвольный контрол между названием и кнопками (переключатель каналов Output). */
    public setTitleWidget(widget: TUIElement | null): void {
        if (this.titleWidget === widget) return;
        this.titleWidget = widget;
        this.syncChildren();
    }

    /**
     * Зона под локальной X: кнопка / «⋯» / название. Кнопка, схлопнутая
     * layout'ом в ноль колонок на узком заголовке, зоны не имеет — по ней
     * нельзя попасть, потому что её не видно.
     */
    public hitZone(localX: number): ViewTitleZone {
        for (let i = 0; i < this.actionLabels.length; i++) {
            if (inZone(this.actionLabels[i], localX)) return { kind: "action", actionId: this.actions[i].id };
        }
        // Скрытая «⋯» зоны не имеет: она осталась вне дерева со старым layout'ом,
        // и без этой проверки её прошлые колонки продолжали бы «кликаться».
        if (this.menuVisible && inZone(this.menuLabel, localX)) return { kind: "menu" };
        return { kind: "title" };
    }

    /** Локальная X кнопки «⋯» — якорь меню, открытого с клавиатуры. */
    public get menuAnchorX(): number {
        return this.menuLabel.localPosition.dx;
    }

    /**
     * Хит-тест ТОЛЬКО виджета заголовка. Лейблы строки презентационные (их
     * клики считает {@link hitZone}), а виджет — настоящий интерактивный
     * контрол (селектор каналов Output), и мышь обязана доходить до него:
     * иначе он рисуется, но не нажимается.
     */
    public hitTestWidget(point: Point): TUIElement | null {
        return this.titleWidget?.elementFromPoint(point) ?? null;
    }

    private composeTitle(): string {
        if (!this.chevron) return ` ${this.title}`;
        return ` ${this.expanded ? ICON_EXPANDED : ICON_COLLAPSED} ${this.title}`;
    }

    private syncChildren(): void {
        this.actionLabels = this.actions.map((action) => {
            const label = new TextLabelElement(buttonLabel(action.icon));
            label.style = buttonStyle();
            label.layoutStyle = { width: hflexFixed(BUTTON_WIDTH), height: 1 };
            return label;
        });
        this.titleLabel.layoutStyle = { width: hflexFit(), height: 1 };
        this.filler.layoutStyle = { width: hflexFill(), height: 1 };
        this.menuLabel.layoutStyle = { width: hflexFixed(BUTTON_WIDTH), height: 1 };
        const children: TUIElement[] = [this.titleLabel, this.filler];
        if (this.titleWidget !== null) {
            this.titleWidget.layoutStyle = { width: hflexFit(), height: 1 };
            children.push(this.titleWidget);
        }
        children.push(...this.actionLabels);
        if (this.menuVisible) children.push(this.menuLabel);
        this.replaceChildren(children);
    }
}

/** Кнопка приглушена, но видима всегда (hover в TUI ненадёжен — мыши может не быть). */
function buttonStyle(): TUIElement["style"] {
    return {
        fg: "descriptionForeground",
        when: [{ states: ["in:hover"], bg: "toolbar.hoverBackground" }],
    };
}

function buttonLabel(icon: string): string {
    return ` ${icon} `;
}

function inZone(label: TextLabelElement, localX: number): boolean {
    const width = label.layoutSize.width;
    if (width === 0) return false;
    const start = label.localPosition.dx;
    return localX >= start && localX < start + width;
}

function sameActions(a: readonly IViewTitleAction[], b: readonly IViewTitleAction[]): boolean {
    return a.length === b.length && a.every((action, i) => action.id === b[i].id && action.icon === b[i].icon);
}
