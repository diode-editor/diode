import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

/** Вкладка нижней панели (Problems, Output, Terminal, …). */
export interface PanelView {
    readonly id: string;
    readonly title: string;
    /** Контент вкладки; `null` рисует {@link placeholder}. */
    content: TUIElement | null;
    /**
     * Контролы вкладки, прижатые к правому краю таб-строки (область
     * `MenuId.ViewTitle` у VS Code) — например, селектор каналов Output.
     */
    actions?: TUIElement | null;
    /** Empty-state сообщение, пока `content` = null (à la VS Code view welcome). */
    readonly placeholder?: string;
}

interface TabSegment {
    readonly id: string;
    readonly start: number;
    readonly end: number;
}

/** По пробелу отбивки с каждой стороны названия вкладки. */
const TAB_PAD = 1;
/** Отступ таб-строки от левого края. */
const TAB_INDENT = 1;
/** Строка, на которой живёт шапка с вкладками (под полосой верхней границы). */
const TAB_ROW = 1;
/** Первая строка контента (под полосой границы + шапкой). */
const CONTENT_TOP = 2;
/** Левый отступ контента/placeholder'а (выравнивание под названием вкладки). */
const CONTENT_LEFT = 2;

/**
 * Кнопка закрытия панели в правом конце таб-строки. Глиф — тот же `×`, что у
 * кнопки закрытия вкладки редактора (`EditorTabItemElement`), а не codicon:
 * иконки приватной области Unicode не видно в текстовом дампе кадра, и сценарий
 * не смог бы её проверить.
 */
const CLOSE_LABEL = " × ";
const CLOSE_WIDTH = CLOSE_LABEL.length;

/**
 * Нижняя **Panel** (VS Code `ViewContainerLocation.Panel`): полоса верхней
 * границы + строка вкладок (PROBLEMS, OUTPUT, …) с кнопкой закрытия в правом
 * конце, левая граница, отделяющая панель от сайдбара, и контент активной
 * вкладки под ними. Вкладки регистрирует {@link addView}; показывается активная.
 * Вкладка без контента рисует своё {@link PanelView.placeholder}.
 *
 * Названия вкладок приглушены (`panelTitle.inactiveForeground`), активная
 * подчёркнута. Цвета приходят каскадом от компонента (`panel.*` /
 * `panelTitle.*`), как и у `EditorElement`.
 *
 * Жил в `@tuidom/elements/panel`; переехал к нам по критерию
 * `docs/TODO/EngineWidgetRepatriation.md` — публичный API оперирует понятиями
 * VS Code (вкладка панели, её title-контролы, welcome-состояние), а кнопка
 * закрытия добавила к ним ещё и команду воркбенча.
 */
export class PanelContainerElement extends TUIElement {
    /** Клик по вкладке (активная уже переключена). */
    public onActivateView?: (id: string) => void;
    /** Клик по кнопке закрытия панели в таб-строке. */
    public onClose?: () => void;

    private views: PanelView[] = [];
    private activeId: string | null = null;
    /** Курсор над кнопкой закрытия — подсветка фона, как у кнопок заголовков view. */
    private closeHovered = false;

    public constructor() {
        super();
        this.style = { bg: "panel.background" };
        this.addEventListener("mousedown", (event) => {
            if (event.button !== "left") return;
            // Событие, всплывшее из дочернего контрола (селектор в шапке), не наше:
            // без этой проверки клик по нему ещё и переключал бы вкладку.
            if (event.target !== this) return;
            const localY = event.screenY - this.globalPosition.y;
            if (localY !== TAB_ROW) return; // переключают вкладки только на строке шапки
            const localX = event.screenX - this.globalPosition.x;
            // Кнопка закрытия раньше вкладок: на узкой панели она рисуется ПОВЕРХ
            // хвоста таб-строки, и в этих колонках она и должна срабатывать —
            // иначе из панели не выйти там, где она нужнее всего.
            if (this.isCloseHit(localX)) {
                this.onClose?.();
                return;
            }
            const segment = this.tabSegments().find((s) => localX >= s.start && localX < s.end);
            if (segment === undefined) return;
            this.setActiveView(segment.id);
            this.onActivateView?.(segment.id);
        });
        // Проверки источника события, как у mousedown, здесь не нужно: колонки
        // кнопки layout не отдаёт никому, а контент вкладки живёт ниже
        // таб-строки — ни один ребёнок в эту зону попасть не может.
        this.addEventListener("mousemove", (event) => {
            const localY = event.screenY - this.globalPosition.y;
            const localX = event.screenX - this.globalPosition.x;
            this.setCloseHovered(localY === TAB_ROW && this.isCloseHit(localX));
        });
        this.addEventListener("mouseleave", () => {
            this.setCloseHovered(false);
        });
    }

    public addView(view: PanelView): void {
        this.views.push(view);
        this.activeId ??= view.id;
        this.syncChildren();
    }

    /** Подменяет контролы вкладки в таб-строке (null — убрать). */
    public setViewActions(id: string, actions: TUIElement | null): void {
        const view = this.views.find((v) => v.id === id);
        if (view === undefined) return;
        view.actions = actions;
        this.syncChildren();
    }

    /** Подменяет контент вкладки (например, placeholder на настоящую view). */
    public setViewContent(id: string, content: TUIElement | null): void {
        const view = this.views.find((v) => v.id === id);
        if (view === undefined) return;
        view.content = content;
        this.syncChildren();
    }

    public setActiveView(id: string): void {
        if (this.views.every((v) => v.id !== id) || this.activeId === id) return;
        this.activeId = id;
        this.syncChildren();
    }

    /**
     * Все вкладки живут в дереве постоянно; неактивные — hidden (root и стили
     * доходят до них всегда). Раньше getChildren() отдавал только активную, и
     * контент/actions, прицепленные до укоренения панели, оставались с
     * протухшим root — модель бага #204 (селектор каналов Output молча не
     * открывал выпадашку после restore сессии).
     *
     * Перерисовку будит он же: `setChildren` зовёт `markDirty` безусловно, и
     * своего вызова после `syncChildren()` сеттерам не нужно.
     */
    private syncChildren(): void {
        const children: TUIElement[] = [];
        for (const view of this.views) {
            const isActive = view.id === this.activeId;
            if (view.actions != null) {
                view.actions.hidden = !isActive;
                children.push(view.actions);
            }
            if (view.content !== null) {
                view.content.hidden = !isActive;
                children.push(view.content);
            }
        }
        this.setChildren(children);
    }

    public getActiveViewId(): string | null {
        return this.activeId;
    }

    public getViewIds(): string[] {
        return this.views.map((v) => v.id);
    }

    /**
     * Наблюдаемое состояние панели для инспектора: какие вкладки есть, какая
     * активна, абсолютная геометрия хит-боксов вкладок и кнопки закрытия.
     * Заменяет e2e-хелпер, который пересчитывал координаты из TAB_INDENT/TAB_PAD
     * руками, — тест кликает `tabs[i].centerX` / `close.centerX` на `tabRow`.
     */
    public override inspectState(): Record<string, unknown> {
        const originX = this.globalPosition.x;
        let x = TAB_INDENT;
        const tabs = this.views.map((view) => {
            const width = view.title.length + TAB_PAD * 2;
            const start = x;
            x += width;
            return {
                id: view.id,
                title: view.title,
                active: view.id === this.activeId,
                x: originX + start,
                width,
                centerX: originX + start + Math.floor(width / 2),
            };
        });
        const closeStart = this.closeStart();
        const close =
            closeStart === null
                ? null
                : {
                      x: originX + closeStart,
                      width: CLOSE_WIDTH,
                      centerX: originX + closeStart + Math.floor(CLOSE_WIDTH / 2),
                  };
        return { activeId: this.activeId, tabRow: this.globalPosition.y + TAB_ROW, tabs, close };
    }

    /** Правая граница таб-строки — за неё контролы вкладки заезжать не должны. */
    private tabsEnd(): number {
        return this.views.reduce((x, view) => x + view.title.length + TAB_PAD * 2, TAB_INDENT);
    }

    /**
     * Локальная X первой колонки кнопки закрытия; `null` — панель уже самой
     * кнопки, рисовать нечего (и кликать, соответственно, не по чему).
     */
    private closeStart(): number | null {
        const width = this.layoutSize.width;
        return width < CLOSE_WIDTH ? null : width - CLOSE_WIDTH;
    }

    private isCloseHit(localX: number): boolean {
        const start = this.closeStart();
        return start !== null && localX >= start && localX < start + CLOSE_WIDTH;
    }

    private setCloseHovered(hovered: boolean): void {
        if (this.closeHovered === hovered) return;
        this.closeHovered = hovered;
        this.markDirty();
    }

    private activeView(): PanelView | undefined {
        return this.views.find((v) => v.id === this.activeId);
    }

    /** Раскладка шапки: сегменты ` Название ` после отступа, с хит-диапазонами. */
    private tabSegments(): TabSegment[] {
        const segments: TabSegment[] = [];
        let x = TAB_INDENT;
        for (const view of this.views) {
            const width = view.title.length + TAB_PAD * 2;
            segments.push({ id: view.id, start: x, end: x + width });
            x += width;
        }
        return segments;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        // Контролы вкладки прижаты вправо на строке табов — как в шапке Panel у
        // VS Code. Ширину берём интринсиковую и не даём заехать ни на сами табы,
        // ни на кнопку закрытия: её ведущий пробел и служит зазором между ними.
        const actions = this.activeView()?.actions;
        if (actions != null) {
            const available = Math.max(0, containerSize.width - CLOSE_WIDTH);
            const actionsWidth = Math.min(actions.getMaxIntrinsicWidth(1), available);
            const x = Math.max(this.tabsEnd(), available - actionsWidth);
            this.layoutChild(actions, x, TAB_ROW, BoxConstraints.tight(new Size(Math.max(0, available - x), 1)));
        }
        const content = this.activeView()?.content;
        if (content != null) {
            const contentWidth = Math.max(0, containerSize.width - CONTENT_LEFT);
            const contentHeight = Math.max(0, containerSize.height - CONTENT_TOP);
            this.layoutChild(
                content,
                CONTENT_LEFT,
                CONTENT_TOP,
                BoxConstraints.tight(new Size(contentWidth, contentHeight)),
            );
        }
        return containerSize;
    }

    public override render(context: RenderContext): void {
        const { width, height } = this.layoutSize;

        // Fill the panel with its background first.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                context.setCell(x, y, { char: " ", bg: this.resolvedStyle.bg });
            }
        }

        // Top border strip (row 0).
        for (let x = 0; x < width; x++) {
            context.setCell(x, 0, { char: "─", fg: this.styleVar("panel.border"), bg: this.resolvedStyle.bg });
        }

        // Tab header (dim). The active tab is underlined — but only under the title
        // glyphs, leaving the surrounding padding un-underlined.
        const segments = this.tabSegments();
        for (let i = 0; i < this.views.length; i++) {
            const view = this.views[i];
            const segment = segments[i];
            const isActive = view.id === this.activeId;
            for (let x = segment.start; x < segment.end && x < width; x++) {
                const textIndex = x - segment.start - TAB_PAD;
                const isGlyph = textIndex >= 0 && textIndex < view.title.length;
                const char = isGlyph ? view.title[textIndex] : " ";
                const style = isActive && isGlyph ? StyleFlags.Underline : StyleFlags.None;
                context.setCell(x, TAB_ROW, {
                    char,
                    fg: this.styleVar("panelTitle.inactiveForeground"),
                    bg: this.resolvedStyle.bg,
                    style,
                });
            }
        }

        // View-specific controls in the title row (drawn after the tabs so they win
        // the shared row), then the active view's content below — renderChildren
        // рисует только видимых детей, скрытые вкладки пропускаются базой.
        this.renderChildren(context);

        // Кнопка закрытия панели — последней: она старше и табов, и контролов
        // вкладки, потому что на узкой панели перекрывает их хвост.
        this.renderCloseButton(context);

        // Placeholder empty-state message, если у активной вкладки нет контента.
        const active = this.activeView();
        if (active?.content == null && active?.placeholder !== undefined && height > CONTENT_TOP) {
            const message = active.placeholder;
            for (let i = 0; i < message.length && i + CONTENT_LEFT < width; i++) {
                context.setCell(i + CONTENT_LEFT, CONTENT_TOP, {
                    char: message[i],
                    fg: this.styleVar("panelTitle.inactiveForeground"),
                    bg: this.resolvedStyle.bg,
                });
            }
        }
    }

    private renderCloseButton(context: RenderContext): void {
        const start = this.closeStart();
        if (start === null) return;
        const bg = this.closeHovered ? this.styleVar("toolbar.hoverBackground") : this.resolvedStyle.bg;
        for (let i = 0; i < CLOSE_WIDTH; i++) {
            context.setCell(start + i, TAB_ROW, {
                char: CLOSE_LABEL[i],
                fg: this.styleVar("descriptionForeground"),
                bg,
            });
        }
    }
}
