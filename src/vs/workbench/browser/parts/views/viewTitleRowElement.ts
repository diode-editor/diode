import type { Point } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

const ICON_EXPANDED = ""; //  nf-fa-angle_down
const ICON_COLLAPSED = ""; //  nf-fa-angle_right

const MENU_ICON = "⋯";

/** Пробел-глиф-пробел: hover-фон читается кнопкой, соседние кнопки не слипаются. */
const BUTTON_WIDTH = 3;

/**
 * Черта, а не рамка: рамка вокруг каждой кнопки в одну строку слишком тяжела, а без границы
 * глиф не выглядит нажимаемым.
 */
const SEPARATOR = "\u2502"; // │

/** Inline-кнопка заголовка — пункт меню группы `navigation`, у которого есть иконка. */
export interface IViewTitleAction {
    /** Что вернёт {@link ViewTitleRowElement.hitZone}; обычно id команды. */
    readonly id: string;
    readonly icon: string;
    /** `false` — кнопка на месте, но приглушена и не срабатывает (`enablement` пункта). */
    readonly enabled?: boolean;
}

export type ViewTitleZone = { kind: "title" } | { kind: "action"; actionId: string } | { kind: "menu" };

export interface IViewTitleRowOptions {
    readonly chevron?: boolean;
}

/**
 * `[ ␣шеврон? ␣НАЗВАНИЕ ][ fill ][ виджет? ][ inline-кнопки ][ ⋯ ]`
 *
 * Жесты ведёт владелец: мышь по лейблам он забирает себе (иначе pointer capture для drag
 * границы не сработает), поэтому попадание по кнопке — арифметика зон {@link hitZone}.
 * Исключение — {@link hitTestWidget}: виджет — настоящий контрол.
 */
export class ViewTitleRowElement extends HFlexElement {
    private readonly titleLabel: TextLabelElement;
    private readonly filler = new FillerElement();
    private readonly menuLabel: TextLabelElement;
    private readonly chevron: boolean;

    private title: string;
    private expanded = true;
    private spinner: string | null = null;
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
        // «⋯» доступна всегда: она открывает попап, а не исполняет команду.
        this.menuLabel.style = buttonStyle(true);
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

    public setActions(actions: readonly IViewTitleAction[]): void {
        if (sameActions(this.actions, actions)) return;
        this.actions = [...actions];
        this.syncChildren();
    }

    /** В таб-строке панели пустая «⋯» стоит в ряду с табами и только мешает. */
    public setMenuVisible(visible: boolean): void {
        if (this.menuVisible === visible) return;
        this.menuVisible = visible;
        this.syncChildren();
    }

    /**
     * Сразу после названия, чтобы ряд кнопок не дёргался: лишние колонки съедает филлер, а
     * `hitZone` считает по разложенным ширинам.
     */
    public setSpinnerFrame(frame: string | null): void {
        this.spinner = frame;
        this.titleLabel.setText(this.composeTitle());
    }

    /** Для инспектора/e2e; сам кадр крутится, его не отдаём. */
    public get isBusy(): boolean {
        return this.spinner !== null;
    }

    public setTitleWidget(widget: TUIElement | null): void {
        if (this.titleWidget === widget) return;
        this.titleWidget = widget;
        this.syncChildren();
    }

    /** Кнопка, схлопнутая layout'ом в ноль колонок на узком заголовке, зоны не имеет. */
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
     * Лейблы не участвуют в хит-тесте (мышь забирает заголовок), поэтому `hover` им ставит
     * владелец по mousemove.
     */
    public setHoveredZone(zone: ViewTitleZone | null): void {
        const hoveredAction = zone?.kind === "action" ? zone.actionId : null;
        this.actionLabels.forEach((label, i) => {
            label.setStyleState("hover", this.actions[i].id === hoveredAction);
        });
        this.menuLabel.setStyleState("hover", zone?.kind === "menu");
    }

    /** Только виджет: лейблы презентационные, а виджет обязан получать клики, иначе не нажимается. */
    public hitTestWidget(point: Point): TUIElement | null {
        return this.titleWidget?.elementFromPoint(point) ?? null;
    }

    private composeTitle(): string {
        const tail = this.spinner === null ? "" : ` ${this.spinner}`;
        if (!this.chevron) return ` ${this.title}${tail}`;
        return ` ${this.expanded ? ICON_EXPANDED : ICON_COLLAPSED} ${this.title}${tail}`;
    }

    private syncChildren(): void {
        this.actionLabels = this.actions.map((action) => {
            const label = new TextLabelElement(buttonLabel(action.icon));
            label.style = buttonStyle(action.enabled !== false);
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
        // Черта только МЕЖДУ контролами: ведущая/хвостовая превратила бы ряд в рамку.
        const controls: TUIElement[] = [...this.actionLabels];
        if (this.menuVisible) controls.push(this.menuLabel);
        controls.forEach((control, index) => {
            if (index > 0) children.push(separatorLabel());
            children.push(control);
        });
        this.replaceChildren(children);
    }
}

/** Приглушена, но видима всегда (мыши может не быть вовсе); `hover` ставит владелец. */
function buttonStyle(enabled: boolean): TUIElement["style"] {
    // У выключенной кнопки hover-варианта нет вовсе: подсвеченный фон читался бы
    // как «нажимается», а она не нажимается.
    if (!enabled) return { fg: "disabledForeground" };
    return {
        fg: "descriptionForeground",
        when: [{ states: ["hover"], bg: "toolbar.hoverBackground" }],
    };
}

/** Разделитель между кнопками — та же приглушённая палитра, что у пунктов меню. */
function separatorLabel(): TextLabelElement {
    const label = new TextLabelElement(SEPARATOR);
    label.style = { fg: "menu.separatorBackground" };
    label.layoutStyle = { width: hflexFixed(1), height: 1 };
    return label;
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

// Stryker disable next-line BlockStatement: пустое тело = «составы всегда разные» = лишняя пересборка, ненаблюдаемая по кадру
function sameActions(a: readonly IViewTitleAction[], b: readonly IViewTitleAction[]): boolean {
    // Stryker disable next-line ConditionalExpression: «считать составы всегда разными» даёт лишнюю пересборку — кнопки от неё те же; пропуск нужной закрыт тестами ниже
    if (a.length !== b.length) return false;
    // Stryker disable next-line ConditionalExpression,ArrowFunction: ослабление сравнения даёт лишнюю пересборку — кнопки от неё те же; обратная подмена (пропустить нужную) закрыта тестами
    return a.every((action, index) => sameAction(action, b[index]));
}

/**
 * Доступность сравнивается наравне с id и иконкой: иначе ранний выход `setActions` съест
 * её смену, и кнопка навсегда останется такой, какой её собрали.
 */
function sameAction(a: IViewTitleAction, b: IViewTitleAction): boolean {
    // Stryker disable next-line ConditionalExpression: «кнопки всегда разные» — это лишняя пересборка, ненаблюдаемая по кадру; пропуск нужной закрыт тестами на смену id, иконки и доступности
    return a.id === b.id && a.icon === b.icon && (a.enabled !== false) === (b.enabled !== false);
}
