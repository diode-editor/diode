import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import type { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { type TUIContextMenuEvent, TUIMouseEvent, type TUIMouseEventType } from "../../dom/events/tuiMouseEvent.ts";
import type { RenderContext } from "../../dom/tuiElement.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import type { CellPatch } from "../../rendering/grid.ts";
import { ScrollableElement, type ScrollViewportInfo } from "../scrollbar/scrollableElement.ts";

const DEFAULT_INDENT_SIZE = 2;
// Окно, в течение которого напечатанные символы складываются в одну последовательность
// быстрого поиска; после паузы буфер сбрасывается (как в VS Code / файловых менеджерах).
const TYPEAHEAD_TIMEOUT_MS = 800;
const ICON_EXPANDED = ""; //  nf-fa-angle_down — chevron, как в TreeViewElement
const ICON_COLLAPSED = ""; //  nf-fa-angle_right

export interface IListRowOptions {
    /** Родительская строка; глубина/отступ выводятся из цепочки родителей. */
    readonly parentId?: string;
    /**
     * Текст для typeahead-поиска; строки без label быстрый поиск пропускает.
     * Сам typeahead выключается опцией конструктора `typeahead: false`.
     */
    readonly label?: string;
}

interface ListRow {
    readonly element: TUIElement;
    readonly host: ListRowHostElement;
    readonly id: string;
    readonly parentId: string | null;
    readonly depth: number;
    readonly label: string | undefined;
    hidden: boolean;
}

/**
 * Внутренняя обёртка строки: владеет when-вариантами состояний
 * (hover < selected < selected+in:focus — порядок = приоритет) и сдвигом
 * контента (гуттер иерархии). Состояния ставит список; in:focus видит
 * focus-состояние самого списка (строки презентационные и фокуса не имеют).
 * Пост-рендерный оверлей прежней реализации умер: смена состояния меняет
 * resolvedStyle строки, дети без собственных цветов наследуют результат, а
 * явные посимвольные подсветки (match highlight) выделение переживают.
 */
class ListRowHostElement extends TUIElement {
    public contentX = 0;
    private readonly child: TUIElement;

    public constructor(child: TUIElement) {
        super();
        this.child = child;
        this.appendChild(child);
        this.style = {
            when: [
                { states: ["hover"], bg: "list.hoverBackground" },
                {
                    states: ["selected"],
                    fg: "list.inactiveSelectionForeground",
                    bg: "list.inactiveSelectionBackground",
                },
                {
                    states: ["selected", "in:focus"],
                    fg: "list.activeSelectionForeground",
                    bg: "list.activeSelectionBackground",
                },
            ],
        };
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.layoutChild(
            this.child,
            this.contentX,
            0,
            BoxConstraints.tight(new Size(Math.max(0, size.width - this.contentX), 1)),
        );
        return size;
    }
}

/**
 * Виртуализирующий список: настоящие TUIElement-дети высотой ровно 1 строка.
 *
 * Потребитель императивно собирает произвольные строки-элементы и добавляет их
 * через {@link appendRow}; контейнер прячет внутри виртуализацию (layout и render
 * получают только строки видимого окна), иерархию со сворачиванием (`parentId` +
 * {@link setCollapsed}), скрытие ({@link setRowHidden}) и общие механики списка:
 * курсор, множественный выбор, клавиатуру, hover, typeahead и сигнал контекстного
 * меню. У каждой строки обязан быть непустой `element.id` — без него appendRow
 * бросает ошибку.
 *
 * Контракт строк: строки — презентационные. Хит-тест всегда возвращает сам
 * контейнер, поэтому строки не получают mouse-событий и фокуса; вся семантика
 * клика/клавиатуры принадлежит списку. Единственное исключение — делегация
 * левого клика без модификаторов: контейнер ре-диспатчит click/dblclick в
 * поддерево видимой строки, и если чей-то listener вызвал `preventDefault()`,
 * клик считается потреблённым — курсор, выделение и активация не трогаются.
 * Так строка может нести инлайн-кнопки (обычные элементы с click-listener'ом),
 * не зная ничего про список. Выделение и hover рисуются пост-оверлеем
 * поверх отрендеренной строки: перекрашиваются только ячейки, чьи цвета совпадают
 * с унаследованными fg/bg контейнера, так что собственные цвета строки (подсветка
 * совпадения, приглушённый номер) выделение переживают. Строка, явно выставившая
 * цвет, равный унаследованному, неотличима от ненастроенной и тоже будет
 * перекрашена — это осознанное ограничение механизма.
 */
export class ListViewElement extends ScrollableElement {
    private readonly indentSize: number;
    private readonly typeaheadEnabled: boolean;

    private rowById = new Map<string, ListRow>();
    /** Дети по родителю в порядке добавления; ключ null — верхний уровень. */
    private childIds = new Map<string | null, string[]>();
    private collapsedIds = new Set<string>();

    /** Ленивая DFS-проекция видимых строк; null = требуется пересборка. */
    private visibleRows: ListRow[] | null = null;
    private visibleIndexById = new Map<string, number>();
    private hasCollapsibleRows = false;
    /**
     * Окно строк, реально разложенное последним performLayout. Делегация кликов
     * (см. {@link delegateToRowChild}) доверяет позициям детей только внутри него:
     * скролл или пересборка проекции между кадрами делают layout недействительным
     * (-1), и незалейаученные строки с ленивыми позициями (0,0)/80×24 не ловят
     * чужие клики.
     */
    private lastLayoutScrollTop = -1;
    private lastLayoutViewportHeight = 0;

    private cursorIndex = 0;
    private anchorIndex = 0;
    private selectedIds = new Set<string>();
    private hoveredIndex: number | null = null;
    /** Курсор, запомненный по id на время грязной проекции (restoreSelection дерева). */
    private pendingCursorId: string | null = null;
    private pendingCursorIndex = 0;

    private typeaheadBuffer = "";
    private typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

    public onSelect: ((element: TUIElement) => void) | null = null;
    public onActivate: ((element: TUIElement) => void) | null = null;
    public onCollapsedChanged: ((element: TUIElement, collapsed: boolean) => void) | null = null;
    public onContextMenu: ((element: TUIElement, screenX: number, screenY: number) => void) | null = null;

    public constructor(options?: { indentSize?: number; typeahead?: boolean }) {
        super();
        this.focusable = true;
        this.indentSize = options?.indentSize ?? DEFAULT_INDENT_SIZE;
        this.typeaheadEnabled = options?.typeahead ?? true;
    }

    // ─── Rows ───

    public appendRow(element: TUIElement, options?: IListRowOptions): void {
        const id = element.id;
        if (id === undefined || id === "") {
            throw new Error(
                `ListViewElement: every row element must have a non-empty id (row #${this.rowById.size} has none)`,
            );
        }
        if (this.rowById.has(id)) {
            throw new Error(`ListViewElement: duplicate row id "${id}"`);
        }
        const parentId = options?.parentId ?? null;
        let depth = 0;
        if (parentId !== null) {
            const parent = this.rowById.get(parentId);
            if (!parent) {
                throw new Error(`ListViewElement: unknown parentId "${parentId}" for row "${id}"`);
            }
            depth = parent.depth + 1;
        }

        const host = new ListRowHostElement(element);
        const row: ListRow = { element, host, id, parentId, depth, label: options?.label, hidden: false };
        this.rowById.set(id, row);
        let siblings = this.childIds.get(parentId);
        if (!siblings) {
            siblings = [];
            this.childIds.set(parentId, siblings);
        }
        siblings.push(id);
        this.appendChild(host);

        this.invalidateProjection();
        this.markDirty();
    }

    public clear(): void {
        this.setChildren([]);
        this.rowById.clear();
        this.childIds.clear();
        this.collapsedIds.clear();
        this.selectedIds.clear();
        this.visibleRows = null;
        this.visibleIndexById.clear();
        this.lastLayoutScrollTop = -1;
        this.cursorIndex = 0;
        this.anchorIndex = 0;
        this.hoveredIndex = null;
        this.pendingCursorId = null;
        this.pendingCursorIndex = 0;
        this.scrollTop = 0;
        this.scrollLeft = 0;
        this.markDirty();
    }

    public get rowCount(): number {
        return this.rowById.size;
    }

    // ─── Visibility: collapse / hide ───

    public setCollapsed(id: string, collapsed: boolean): void {
        const row = this.requireRow(id);
        if (!this.rowHasChildren(id)) return;
        if (this.collapsedIds.has(id) === collapsed) return;
        if (collapsed) {
            this.collapsedIds.add(id);
        } else {
            this.collapsedIds.delete(id);
        }
        this.onCollapsedChanged?.(row.element, collapsed);
        this.invalidateProjection();
        this.markDirty();
    }

    public toggleCollapsed(id: string): void {
        this.setCollapsed(id, !this.collapsedIds.has(id));
    }

    public isCollapsed(id: string): boolean {
        return this.collapsedIds.has(id);
    }

    public setRowHidden(id: string, hidden: boolean): void {
        const row = this.requireRow(id);
        if (row.hidden === hidden) return;
        row.hidden = hidden;
        this.invalidateProjection();
        this.markDirty();
    }

    // ─── Cursor / selection ───

    public getCursorElement(): TUIElement | null {
        const rows = this.ensureProjection();
        if (this.cursorIndex >= 0 && this.cursorIndex < rows.length) {
            return rows[this.cursorIndex].element;
        }
        return null;
    }

    /**
     * Все выбранные строки. Если множественный выбор пуст, возвращает строку под
     * курсором (в виде массива из одного элемента). Порядок — как в списке.
     */
    public getSelectedElements(): TUIElement[] {
        const rows = this.ensureProjection();
        if (this.selectedIds.size === 0) {
            const cursor = this.getCursorElement();
            return cursor ? [cursor] : [];
        }
        const result: TUIElement[] = [];
        for (const row of rows) {
            if (this.selectedIds.has(row.id)) {
                result.push(row.element);
            }
        }
        return result;
    }

    /** Ставит курсор на строку, раскрывая свёрнутых предков, и проматывает к ней. */
    public setCursorTo(id: string): void {
        const row = this.requireRow(id);
        for (let parentId = row.parentId; parentId !== null; ) {
            const parent = this.rowById.get(parentId);
            /* v8 ignore start -- defensive: parent chains are validated at appendRow time */
            if (!parent) break;
            /* v8 ignore stop */
            if (this.collapsedIds.has(parent.id)) {
                this.setCollapsed(parent.id, false);
            }
            parentId = parent.parentId;
        }
        this.ensureProjection();
        const index = this.visibleIndexById.get(id);
        if (index !== undefined) {
            this.setSelectedIndex(index);
        }
    }

    public focusPageDown(): void {
        const pageSize = Math.max(1, this.layoutSize.height - 1);
        this.setSelectedIndex(this.cursorIndex + pageSize);
    }

    public focusPageUp(): void {
        const pageSize = Math.max(1, this.layoutSize.height - 1);
        this.setSelectedIndex(this.cursorIndex - pageSize);
    }

    public focusFirst(): void {
        this.setSelectedIndex(0);
    }

    public focusLast(): void {
        this.setSelectedIndex(this.ensureProjection().length - 1);
    }

    // ─── ScrollableElement contract ───

    public get contentHeight(): number {
        return this.ensureProjection().length;
    }

    public get contentWidth(): number {
        // Горизонтального скролла нет: строки живут в ширине вьюпорта и клипятся справа.
        return this.layoutSize.width;
    }

    // ─── TUIElement overrides ───

    /**
     * Строки презентационные: в хит-тест не спускаемся — вся семантика мыши
     * живёт в контейнере (и закуленные строки с непосчитанным layout не крадут
     * хиты у чужих углов экрана).
     */
    protected override hitTestChildren(_point: Point): TUIElement | null {
        return null;
    }

    /** Строки не участвуют в Tab-обходе — фокусируется только сам список. */
    public override getDepthFirstFocusableOrder(): TUIElement[] {
        return this.focusable ? [this] : [];
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const rows = this.ensureProjection();
        const start = this.scrollTop;
        const end = Math.min(rows.length, start + size.height);
        for (let i = start; i < end; i++) {
            const row = rows[i];
            const y = i - start;
            row.host.contentX = this.rowContentX(row);
            // Состояния строк синхронизируются здесь: layout идёт в кадре ДО
            // резолва стилей. Вариант ДЛЯ layout — без markDirty, иначе кадр
            // оставлял бы корень грязным и следующий ввод рендерил бы пустой кадр.
            row.host.setStyleStateDuringLayout("selected", i === this.cursorIndex || this.selectedIds.has(row.id));
            row.host.setStyleStateDuringLayout("hover", i === this.hoveredIndex);
            this.layoutChild(row.host, 0, y, BoxConstraints.tight(new Size(size.width, 1)));
        }
        this.lastLayoutScrollTop = start;
        this.lastLayoutViewportHeight = size.height;
        return size;
    }

    public override inspectState(): Record<string, unknown> {
        const rows = this.ensureProjection();
        return {
            cursorId: this.rowIdAt(this.cursorIndex),
            selectedIds: [...this.selectedIds].sort(),
            collapsedIds: [...this.collapsedIds].sort(),
            visibleCount: rows.length,
            totalCount: this.rowById.size,
            scrollTop: this.scrollTop,
        };
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "keypress") {
            this.handleKeypress(event as TUIKeyboardEvent);
        } else if (event.type === "click") {
            this.handleClick(event as TUIMouseEvent);
        } else if (event.type === "contextmenu") {
            this.handleContextMenu(event as TUIContextMenuEvent);
        } else if (event.type === "dblclick") {
            this.handleDblClick(event as TUIMouseEvent);
        } else if (event.type === "wheel") {
            this.handleWheel(event as TUIMouseEvent);
        } else if (event.type === "mousemove") {
            this.handleMouseMove(event as TUIMouseEvent);
        } else if (event.type === "mouseleave") {
            this.handleMouseLeave();
        } else {
            super.performDefaultAction(event);
        }
    }

    /**
     * Единый вход контекстного меню: от мыши — строка под кликом (мультивыбор по
     * выбранной строке не сбрасывается), от клавиатуры — строка курсора с якорем
     * на её глобальной позиции. Виджет только сигналит {@link onContextMenu} —
     * сборка и показ меню на стороне владельца.
     */
    private handleContextMenu(event: TUIContextMenuEvent): void {
        const rows = this.ensureProjection();
        if (event.trigger === "mouse") {
            const index = this.scrollTop + event.localY;
            if (index < 0 || index >= rows.length) return;
            const row = rows[index];
            // Не сбрасываем множественный выбор, если кликнули по уже выбранной строке.
            if (!this.selectedIds.has(row.id)) {
                this.setSelectedIndex(index);
            } else {
                this.cursorIndex = index;
                this.applyCursor(index);
            }
            this.onContextMenu?.(row.element, event.screenX, event.screenY);
            return;
        }
        if (this.cursorIndex < 0 || this.cursorIndex >= rows.length) return;
        this.onContextMenu?.(
            rows[this.cursorIndex].element,
            this.globalPosition.x,
            this.globalPosition.y + (this.cursorIndex - this.scrollTop),
        );
    }

    // ─── Render ───

    protected override renderViewport(context: RenderContext, viewport: ScrollViewportInfo): void {
        const rows = this.ensureProjection();
        const { scrollTop, viewportWidth, viewportHeight } = viewport;
        const resolved = this.resolvedStyle;

        for (let screenY = 0; screenY < viewportHeight; screenY++) {
            const rowIndex = scrollTop + screenY;

            // 1. Заливка строки фоном списка (гуттер и область за строками).
            for (let x = 0; x < viewportWidth; x++) {
                context.setCell(x, screenY, { char: " ", fg: resolved.fg, bg: resolved.bg, width: 1 });
            }
            if (rowIndex >= rows.length) continue;
            const row = rows[rowIndex];

            // 2. Строка-обёртка: её when-состояния (hover/selected) уже
            // отрезолвлены каскадом — фон льёт база, дети наследуют результат.
            const host = row.host;
            const hostOffset = new Offset(host.localPosition.dx, host.localPosition.dy);
            const hostClip = new Rect(host.globalPosition, host.layoutSize);
            host.render(context.withOffset(hostOffset).withClip(hostClip));

            // 3. Шеврон сворачиваемой строки — поверх, на фоне строки.
            if (this.hasCollapsibleRows && this.rowHasChildren(row.id)) {
                const icon = this.collapsedIds.has(row.id) ? ICON_COLLAPSED : ICON_EXPANDED;
                context.setCell(row.depth * this.indentSize, screenY, {
                    char: icon,
                    fg: this.styleVar("list.deemphasizedForeground"),
                    bg: host.resolvedStyle.bg,
                    width: 1,
                });
            }
        }
    }

    // ─── Private: projection ───

    private ensureProjection(): ListRow[] {
        if (this.visibleRows !== null) return this.visibleRows;

        const out: ListRow[] = [];
        this.visibleIndexById.clear();
        let hasCollapsible = false;
        const walk = (parentId: string | null): void => {
            const ids = this.childIds.get(parentId);
            if (!ids) return;
            for (const id of ids) {
                /* v8 ignore next -- defensive: childIds and rowById are mutated in lock-step */
                const row = this.rowById.get(id);
                if (!row || row.hidden) continue;
                if (this.rowHasChildren(id)) hasCollapsible = true;
                this.visibleIndexById.set(id, out.length);
                out.push(row);
                if (!this.collapsedIds.has(id)) walk(id);
            }
        };
        walk(null);
        this.visibleRows = out;
        this.hasCollapsibleRows = hasCollapsible;

        // Курсор возвращается на прежнюю строку по id; если она пропала (скрыта,
        // свёрнута под родителя) — на ближайший оставшийся индекс, не прыгая наверх.
        if (this.pendingCursorId !== null && this.visibleIndexById.has(this.pendingCursorId)) {
            this.cursorIndex = this.visibleIndexById.get(this.pendingCursorId)!;
        } else if (out.length === 0) {
            this.cursorIndex = 0;
        } else {
            this.cursorIndex = Math.min(Math.max(this.pendingCursorIndex, 0), out.length - 1);
        }
        this.anchorIndex = this.cursorIndex;
        this.pendingCursorId = null;
        return out;
    }

    private invalidateProjection(): void {
        this.lastLayoutScrollTop = -1;
        if (this.visibleRows !== null) {
            this.pendingCursorId = this.rowIdAt(this.cursorIndex);
            this.pendingCursorIndex = this.cursorIndex;
            this.visibleRows = null;
        }
    }

    private rowIdAt(index: number): string | null {
        if (this.visibleRows !== null && index >= 0 && index < this.visibleRows.length) {
            return this.visibleRows[index].id;
        }
        return null;
    }

    private requireRow(id: string): ListRow {
        const row = this.rowById.get(id);
        if (!row) {
            throw new Error(`ListViewElement: unknown row id "${id}"`);
        }
        return row;
    }

    private rowHasChildren(id: string): boolean {
        const ids = this.childIds.get(id);
        return ids !== undefined && ids.length > 0;
    }

    private rowContentX(row: ListRow): number {
        // Гуттер под шевроны резервируется, только если в списке вообще есть что сворачивать.
        return row.depth * this.indentSize + (this.hasCollapsibleRows ? 2 : 0);
    }

    // ─── Private: selection ───

    private setSelectedIndex(index: number): void {
        const rows = this.ensureProjection();
        if (index < 0) index = 0;
        if (index >= rows.length) index = rows.length - 1;
        if (index < 0) return;

        this.cursorIndex = index;
        this.anchorIndex = index;
        this.selectedIds.clear();
        this.applyCursor(index);
    }

    /** Двигает курсор и расширяет множественный выбор диапазоном от якоря (Shift+стрелки). */
    private extendSelectionTo(index: number): void {
        const rows = this.ensureProjection();
        if (index < 0) index = 0;
        if (index >= rows.length) index = rows.length - 1;
        if (index < 0) return;

        this.cursorIndex = index;
        this.selectRange(this.anchorIndex, index);
        this.applyCursor(index);
    }

    private selectRange(anchor: number, cursor: number): void {
        const rows = this.ensureProjection();
        const lo = Math.min(anchor, cursor);
        const hi = Math.max(anchor, cursor);
        this.selectedIds.clear();
        for (let i = lo; i <= hi; i++) {
            this.selectedIds.add(rows[i].id);
        }
    }

    /** Переключает выбор одной строки (Ctrl/Cmd+клик), не сбрасывая остальное. */
    private toggleSelectionAt(index: number): void {
        const rows = this.ensureProjection();
        /* v8 ignore start -- defensive: the mouse handler bounds-checks the row before calling */
        if (index < 0 || index >= rows.length) return;
        /* v8 ignore stop */
        // Первый Ctrl+клик: включаем в набор текущий курсор, чтобы он не потерялся.
        if (this.selectedIds.size === 0 && this.cursorIndex < rows.length) {
            this.selectedIds.add(rows[this.cursorIndex].id);
        }
        const id = rows[index].id;
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
        } else {
            this.selectedIds.add(id);
        }
        this.cursorIndex = index;
        this.anchorIndex = index;
        this.applyCursor(index);
    }

    private applyCursor(index: number): void {
        this.ensureVisible(index);
        const rows = this.ensureProjection();
        this.onSelect?.(rows[index].element);
        this.markDirty();
    }

    private ensureVisible(index: number): void {
        const viewportHeight = this.layoutSize.height;
        if (index < this.scrollTop) {
            this.scrollTo(this.scrollLeft, index);
        } else if (index >= this.scrollTop + viewportHeight) {
            this.scrollTo(this.scrollLeft, index - viewportHeight + 1);
        }
    }

    // ─── Private: input handlers ───

    private handleKeypress(event: TUIKeyboardEvent): void {
        switch (event.key) {
            case "ArrowUp":
                if (event.shiftKey) {
                    this.extendSelectionTo(this.cursorIndex - 1);
                } else {
                    this.setSelectedIndex(this.cursorIndex - 1);
                }
                break;
            case "ArrowDown":
                if (event.shiftKey) {
                    this.extendSelectionTo(this.cursorIndex + 1);
                } else {
                    this.setSelectedIndex(this.cursorIndex + 1);
                }
                break;
            case "ArrowRight":
                this.handleExpandOrMoveToChild();
                break;
            case "ArrowLeft":
                this.handleCollapseOrMoveToParent();
                break;
            case "Enter":
                this.activateCursorRow();
                break;
            case " ":
                this.toggleCursorRow();
                break;
            // Page/Home/End дублируются здесь при живых глобальных командах list.*
            // (workbench перехватывает их раньше performDefaultAction): standalone-
            // использование контейнера вне workbench не должно терять навигацию.
            case "PageDown":
                this.focusPageDown();
                break;
            case "PageUp":
                this.focusPageUp();
                break;
            case "Home":
                this.focusFirst();
                break;
            case "End":
                this.focusLast();
                break;
            default:
                this.handleTypeahead(event);
                return;
        }
    }

    // ─── Private: type-ahead поиск ───

    /**
     * Быстрый поиск по набору: печатаешь символы — курсор перепрыгивает к первой строке,
     * чей label начинается с набранной последовательности. Повтор одного и того же
     * символа циклически перебирает совпадения; набор из разных символов уточняет
     * префикс, начиная с текущей строки. Буфер копится, пока не выйдет тайм-аут.
     */
    private handleTypeahead(event: TUIKeyboardEvent): void {
        if (!this.typeaheadEnabled) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const ch = event.key;
        // Только одиночные печатные символы: имена клавиш ("Enter", "F1"), управляющие
        // символы и пробел (уже занят сворачиванием) в поиск не идут.
        if (ch.length !== 1 || ch === " " || ch.charCodeAt(0) < 0x20) return;

        this.typeaheadBuffer += ch;
        this.restartTypeaheadTimer();
        this.jumpToTypeaheadMatch();
    }

    private restartTypeaheadTimer(): void {
        if (this.typeaheadTimer !== null) {
            clearTimeout(this.typeaheadTimer);
        }
        this.typeaheadTimer = setTimeout(() => {
            this.typeaheadTimer = null;
            this.typeaheadBuffer = "";
        }, TYPEAHEAD_TIMEOUT_MS);
        // Незавершённый таймер поиска не должен удерживать процесс от выхода.
        this.typeaheadTimer.unref();
    }

    private jumpToTypeaheadMatch(): void {
        const rows = this.ensureProjection();
        const count = rows.length;
        if (count === 0) return;

        const buffer = this.typeaheadBuffer.toLowerCase();
        // Повтор одного символа ("aa", "aaa") трактуем как перебор совпадений по одной
        // букве, а не как буквальный префикс — так работает быстрый поиск в проводниках.
        const allSameChar = Array.from(buffer).every((c) => c === buffer[0]);
        const prefix = allSameChar ? buffer[0] : buffer;
        const cycling = buffer.length >= 2 && allSameChar;
        const start = cycling ? this.cursorIndex + 1 : this.cursorIndex;

        for (let i = 0; i < count; i++) {
            const idx = (start + i) % count;
            const label = rows[idx].label;
            if (label !== undefined && label.toLowerCase().startsWith(prefix)) {
                this.setSelectedIndex(idx);
                return;
            }
        }
    }

    private handleExpandOrMoveToChild(): void {
        const rows = this.ensureProjection();
        const row = rows[this.cursorIndex];
        if (!row || !this.rowHasChildren(row.id)) return;

        if (this.collapsedIds.has(row.id)) {
            this.setCollapsed(row.id, false);
        } else if (this.cursorIndex + 1 < rows.length && rows[this.cursorIndex + 1].depth > row.depth) {
            // Уже раскрыта — перейти на первого ребёнка.
            this.setSelectedIndex(this.cursorIndex + 1);
        }
    }

    private handleCollapseOrMoveToParent(): void {
        const rows = this.ensureProjection();
        const row = rows[this.cursorIndex];
        if (!row) return;

        if (this.rowHasChildren(row.id) && !this.collapsedIds.has(row.id)) {
            this.setCollapsed(row.id, true);
        } else if (row.parentId !== null) {
            const parentIndex = this.visibleIndexById.get(row.parentId);
            /* v8 ignore start -- defensive: a visible child's parent is always visible too */
            if (parentIndex !== undefined) {
                this.setSelectedIndex(parentIndex);
            }
            /* v8 ignore stop */
        }
    }

    private activateCursorRow(): void {
        const rows = this.ensureProjection();
        const row = rows[this.cursorIndex];
        if (!row) return;
        this.onActivate?.(row.element);
    }

    private toggleCursorRow(): void {
        const rows = this.ensureProjection();
        const row = rows[this.cursorIndex];
        if (!row || !this.rowHasChildren(row.id)) return;
        this.toggleCollapsed(row.id);
    }

    /**
     * Ре-диспатчит click/dblclick в поддерево видимой строки; true = ребёнок
     * потребил событие (какой-то listener вызвал `preventDefault()`).
     *
     * Хит-тест идёт от элемента строки, так что результат по построению лежит в её
     * поддереве. Доверять позициям детей можно только строкам, разложенным последним
     * performLayout на своих местах: скролл или пересборка проекции между кадрами
     * инвалидируют окно, и делегация отключается до следующего кадра — иначе
     * незалейаученная строка с ленивыми (0,0)/80×24 поймала бы чужой клик.
     */
    private delegateToRowChild(index: number, row: ListRow, event: TUIMouseEvent): boolean {
        if (this.scrollTop !== this.lastLayoutScrollTop) return false;
        if (index >= this.lastLayoutScrollTop + this.lastLayoutViewportHeight) return false;
        const hit = row.element.elementFromPoint(new Point(event.screenX, event.screenY));
        if (hit === null || hit === row.element) return false;
        const synthetic = new TUIMouseEvent(event.type as TUIMouseEventType, {
            button: event.button,
            screenX: event.screenX,
            screenY: event.screenY,
            localX: event.screenX - hit.globalPosition.x,
            localY: event.screenY - hit.globalPosition.y,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
        });
        return !hit.dispatchEvent(synthetic);
    }

    private handleClick(event: TUIMouseEvent): void {
        const rows = this.ensureProjection();
        const index = this.scrollTop + event.localY;
        if (index < 0 || index >= rows.length) return;
        const row = rows[index];

        if (event.button !== "left") return; // правый клик несёт событие contextmenu

        if (event.ctrlKey) {
            this.toggleSelectionAt(index);
            return;
        }

        if (event.shiftKey) {
            this.cursorIndex = index;
            this.selectRange(this.anchorIndex, index);
            this.applyCursor(index);
            return;
        }

        if (this.delegateToRowChild(index, row, event)) return;

        this.setSelectedIndex(index);

        // Клик по колонке шеврона сворачивает/раскрывает.
        if (this.hasCollapsibleRows && this.rowHasChildren(row.id)) {
            const chevronX = row.depth * this.indentSize;
            if (event.localX >= chevronX && event.localX <= chevronX + 1) {
                this.toggleCollapsed(row.id);
            }
        }
    }

    private handleDblClick(event: TUIMouseEvent): void {
        const rows = this.ensureProjection();
        const index = this.scrollTop + event.localY;
        if (index < 0 || index >= rows.length) return;

        const row = rows[index];
        if (this.delegateToRowChild(index, row, event)) return;
        if (this.rowHasChildren(row.id)) {
            this.toggleCollapsed(row.id);
        } else {
            this.onActivate?.(row.element);
        }
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        const rows = this.ensureProjection();
        const index = this.scrollTop + event.localY;
        const newHovered = index >= 0 && index < rows.length ? index : null;
        if (newHovered !== this.hoveredIndex) {
            this.hoveredIndex = newHovered;
            this.markDirty();
        }
    }

    private handleMouseLeave(): void {
        if (this.hoveredIndex !== null) {
            this.hoveredIndex = null;
            this.markDirty();
        }
    }

    private handleWheel(event: TUIMouseEvent): void {
        if (event.wheelDirection === "up") {
            this.scrollBy(0, -3);
        } else if (event.wheelDirection === "down") {
            this.scrollBy(0, 3);
        }
    }
}
