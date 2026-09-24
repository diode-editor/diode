import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { truncateEnd } from "@tuidom/core/common/textTruncation";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { INHERITED_BG, INHERITED_FG } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { QuickPickAcceptMode, QuickPickItem, ValidationSeverity } from "../../../common/quickPickItem.ts";

import { CONTENT_PAD, QuickPickFrameElement } from "./quickPickFrameElement.ts";
import { buildItemRow, rowId } from "./quickPickRows.ts";

/**
 * Quick-open / палитра команд / InputBox — один переиспользуемый пикер.
 *
 * **Составной**, а не «толстый» элемент: собственного посимвольного render'а
 * здесь нет вообще. Хром рисует {@link QuickPickFrameElement}, строку запроса
 * ведёт движковый `InputElement`, результаты — движковый `ListViewElement` с
 * нашими строками ({@link buildItemRow}). Наш код — это поведение (клавиатура,
 * мышь, курсор) и API для сервисов.
 *
 * Живёт в Diode, а не в `@tuidom/elements`: его публичный API — сплошь понятия
 * редактора (fuzzy-диапазоны, шорткат команды, флейвор InputBox), а движок
 * держит только виджеты общего назначения (docs/arch/Workbench.md).
 *
 * Фильтрацию виджет не делает — ему отдают уже отфильтрованные `items` с
 * проставленными `labelMatchRanges`.
 *
 * Клавиатура (события всплывают из сфокусированного `InputElement`):
 *   ArrowDown/Up   — двигают выделение (без заворота)
 *   PageDown/Up    — на экран списка
 *   Enter          — принять (блокируется жёсткой ошибкой валидации)
 *   Escape         — отмена
 *   остальное      — достаётся строке запроса
 */
export class QuickPickElement extends TUIElement {
    public placeholder = "Type to search…";
    /** Сколько строк списка показывать одновременно (дальше — скролл). */
    public maxVisibleItems = 10;

    /** Заголовок, врезанный в верхнюю рамку (например, "Save As"). */
    public title: string | undefined = undefined;
    /**
     * Подсказка под строкой запроса (dim) — флейвор InputBox. Перебивается
     * {@link validationMessage}, когда та выставлена.
     */
    public prompt: string | undefined = undefined;
    /** Текст валидации под строкой запроса; при severity "error" блокирует Enter. */
    public validationMessage: string | null = null;
    public validationSeverity: ValidationSeverity = "error";
    /**
     * Как трактовать Enter:
     *   "item"  — onAccept(item, index), только на непустом списке (Quick Open);
     *   "value" — всегда onAcceptValue(getQuery()) — флейвор InputBox.
     */
    public acceptMode: QuickPickAcceptMode = "item";
    /**
     * Множественный выбор: у КАЖДОЙ строки появляется чекбокс, `Space`
     * переключает отметку под курсором, а `Enter` принимает набор отмеченных
     * (см. {@link checkedItems}) — подсветка сама по себе выбором не считается.
     */
    public canPickMany = false;
    public onAcceptValue: ((value: string) => void) | null = null;
    /** Желаемая ширина пикера в колонках (клампится constraints'ами). */
    public preferredWidth = 60;

    public onQueryChange: ((query: string) => void) | null = null;
    public onAccept: ((item: QuickPickItem, index: number) => void) | null = null;
    /**
     * Enter в множественном выборе ({@link canPickMany}): набор берётся из
     * {@link checkedItems}, поэтому аргументов у колбэка нет. Файрится и на
     * пустом наборе, и на пустом списке.
     */
    public onAcceptMany: (() => void) | null = null;
    public onCancel: (() => void) | null = null;
    /**
     * Выделенная строка сменилась ПО ВОЛЕ ПОЛЬЗОВАТЕЛЯ (стрелки, PageUp/Down) —
     * шов живого превью (палитра тем применяет тему по мере навигации).
     * НЕ файрится на `items =` / {@link refreshItems} / {@link setActiveIndex}:
     * это программное перепозиционирование, а не намерение пользователя.
     */
    public onActiveItemChanged: ((item: QuickPickItem, index: number) => void) | null = null;

    public readonly inputElement: InputElement;

    private readonly frame: QuickPickFrameElement;
    private readonly body: VFlexElement;
    private readonly inputRow: PaddingContainerElement;
    private readonly messageLabel: TextLabelElement;
    private readonly messageRow: PaddingContainerElement;
    /** Строка-распорка под сепаратор: фона не красит, линия рамки видна из-под неё. */
    private readonly separatorRow: TUIElement;
    private readonly list: ListViewElement;

    private itemsValue: readonly QuickPickItem[] = [];
    /**
     * Отмеченные предметы множественного выбора — по идентичности объекта, а не
     * по индексу: фильтрация набором меняет состав и индексы `items`, а отметки
     * обязаны пережить её (набрал фильтр, отметил, стёр фильтр — отметка на месте).
     */
    private readonly checkedValue = new Set<QuickPickItem>();
    private selectedIndexValue = 0;
    /** Ширина, на которую построены текущие ряды; -1 — рядов нет. */
    private rowsWidth = -1;
    /** Слепок состава VFlex — чтобы не пересобирать детей на каждом кадре. */
    private structureKey = "";
    /** Строки в порядке предметов: список отдаёт в onSelect элемент, а не индекс. */
    private rowElements: TUIElement[] = [];
    /** Программное перемещение курсора не будит {@link onActiveItemChanged}. */
    private suppressActiveNotification = false;

    public constructor() {
        super();
        this.focusable = true;
        this.style = { fg: "quickInput.foreground", bg: "quickInput.background" };

        this.inputElement = new InputElement();
        this.inputElement.showBorder = false;
        // Строка запроса — часть пикера: наследует его цвета, а не input.*.
        this.inputElement.style = { fg: INHERITED_FG, bg: INHERITED_BG };
        this.inputElement.onChange = (value) => {
            this.onQueryChange?.(value);
        };
        this.inputRow = new PaddingContainerElement(this.inputElement, { left: CONTENT_PAD, right: CONTENT_PAD });

        this.messageLabel = new TextLabelElement("");
        this.messageRow = new PaddingContainerElement(this.messageLabel, { left: CONTENT_PAD, right: CONTENT_PAD });

        this.separatorRow = new TUIElement();

        this.list = new ListViewElement({ typeahead: false });
        // Фокус живёт в строке запроса: список не должен его перехватывать, а
        // typeahead увёл бы курсор от букв самого запроса.
        this.list.focusable = false;
        this.list.onSelect = (element) => {
            this.selectedIndexValue = this.rowElements.indexOf(element);
            this.notifyActive();
        };

        this.inputRow.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.messageRow.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.separatorRow.layoutStyle = { height: vflexFixed(1), width: "fill" };
        this.list.layoutStyle = { height: vflexFill(), width: "fill" };

        this.body = new VFlexElement();
        this.frame = new QuickPickFrameElement(this.body);
        this.appendChild(this.frame);

        this.syncStructure();
        this.addEventListener("keydown", (event) => {
            this.handleKeyDown(event.key, event);
        });
        this.addEventListener("mousemove", (event) => {
            this.handleMouseMove(event);
        });
        this.addEventListener("click", (event) => {
            this.handleClick(event);
        });
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    public get items(): readonly QuickPickItem[] {
        return this.itemsValue;
    }

    public set items(value: readonly QuickPickItem[]) {
        this.itemsValue = value;
        this.selectedIndexValue = 0;
        this.rebuildRows();
        this.moveCursorTo(0, { notify: false });
        this.list.scrollTop = 0;
        this.syncStructure();
    }

    /**
     * Замена строк БЕЗ прыжка курсора наверх — когда список обновился для ТОГО ЖЕ
     * запроса (индекс файлов дорос в фоне). Прежний предмет ищется по
     * идентичности (label + description); если он исчез, прежний индекс
     * клампится в новые границы, а строка остаётся на экране.
     */
    public refreshItems(value: readonly QuickPickItem[]): void {
        const hadPrevious = this.itemsValue.length > 0;
        const previous = this.itemsValue[this.selectedIndexValue];
        this.itemsValue = value;

        if (value.length === 0) {
            this.selectedIndexValue = 0;
            this.rebuildRows();
            this.syncStructure();
            return;
        }

        let next = hadPrevious ? value.findIndex((item) => sameItem(item, previous)) : -1;
        if (next < 0) next = Math.min(this.selectedIndexValue, value.length - 1);
        this.selectedIndexValue = Math.max(0, next);

        this.rebuildRows();
        this.moveCursorTo(this.selectedIndexValue, { notify: false });
        this.syncStructure();
    }

    public get selectedIndex(): number {
        return this.selectedIndexValue;
    }

    /**
     * Отмеченные предметы множественного выбора. Порядок множества —
     * порядок отметки; упорядочить по списку — дело того, кто список отдал
     * ({@link import("./quickInputService.ts").QuickInputService}).
     */
    public get checkedItems(): ReadonlySet<QuickPickItem> {
        return this.checkedValue;
    }

    /**
     * Вернуть состояние множественного выбора в исходное — ОБЯЗАТЕЛЬНЫЙ первый
     * шаг любого показа на этом виджете.
     *
     * Виджет общий (палитра, Quick Open, наши команды, расширения), и остальные
     * флейворные поля каждый хозяин и так выставляет за себя. Эти три — нет:
     * без сброса чекбоксы прошлого множественного выбора вылезали в палитре, а
     * её `Enter` уходил в {@link onAcceptMany} вместо {@link onAccept} и команда
     * не исполнялась.
     */
    public resetMultiSelect(): void {
        this.canPickMany = false;
        this.checkedValue.clear();
        this.onAcceptMany = null;
    }

    /**
     * Программно выставить набор отметок (предотмеченные пункты при открытии).
     * Прежние отметки заменяются целиком.
     */
    public setCheckedItems(items: Iterable<QuickPickItem>): void {
        this.checkedValue.clear();
        for (const item of items) this.checkedValue.add(item);
        this.rebuildKeepingView();
    }

    /**
     * Программно подсветить строку (например, текущую тему при открытии).
     * Клампится в границы, держит строку на экране, {@link onActiveItemChanged}
     * НЕ файрит — это не пользовательская навигация.
     */
    public setActiveIndex(index: number): void {
        if (this.itemsValue.length === 0) return;
        const clamped = Math.max(0, Math.min(this.itemsValue.length - 1, index));
        this.selectedIndexValue = clamped;
        this.moveCursorTo(clamped, { notify: false });
    }

    public getQuery(): string {
        return this.inputElement.inputState.value;
    }

    public setQuery(value: string): void {
        this.inputElement.inputState.value = value;
        this.markDirty();
    }

    /** Фокус делегируется строке запроса — печатает пользователь именно в неё. */
    public override focus(): void {
        this.inputElement.focus();
    }

    /**
     * Наблюдаемое состояние: запрос, лейблы строк и активный индекс. В
     * множественном выборе добавляются лейблы отмеченных строк — иначе отметку
     * не видно ниоткуда, кроме кадра.
     */
    public override inspectState(): Record<string, unknown> {
        return {
            query: this.getQuery(),
            activeIndex: this.selectedIndexValue,
            title: this.title,
            items: this.itemsValue.map((item) => item.label),
            ...(this.canPickMany
                ? { checked: this.itemsValue.filter((item) => this.checkedValue.has(item)).map((item) => item.label) }
                : {}),
        };
    }

    // ─── Structure ──────────────────────────────────────────────────────────

    /** Текст и цвет строки сообщения; null — строки нет. */
    private get message(): { text: string; fg: string } | null {
        if (this.validationMessage !== null) {
            const fg =
                this.validationSeverity === "warning"
                    ? "editorWarning.foreground"
                    : this.validationSeverity === "info"
                      ? "editorInfo.foreground"
                      : "editorError.foreground";
            return { text: this.validationMessage, fg };
        }
        if (this.prompt !== undefined) {
            return { text: this.prompt, fg: "quickPick.promptForeground" };
        }
        return null;
    }

    private get visibleItemCount(): number {
        return Math.min(this.itemsValue.length, this.maxVisibleItems);
    }

    /** Строки «шапки»: сама строка запроса плюс, если есть, строка сообщения. */
    private get headerRows(): number {
        return 1 + (this.message !== null ? 1 : 0);
    }

    private get totalHeight(): number {
        const listRows = this.visibleItemCount;
        const chrome = BORDER_THICKNESS + this.headerRows;
        // Верхняя рамка + шапка + [сепаратор + строки] + нижняя рамка.
        if (listRows === 0) return chrome + BORDER_THICKNESS;
        return chrome + 1 + listRows + BORDER_THICKNESS;
    }

    /**
     * Пересобирает состав VFlex под текущее состояние (есть ли строка сообщения,
     * есть ли список) и сообщает рамке, где рисовать сепаратор.
     */
    private syncStructure(): void {
        // Плейсхолдер живёт полем на пикере (его правят сервисы), а рисует его
        // строка запроса — переносим на каждом синке, а не сеттером.
        this.inputElement.placeholder = this.placeholder;
        const message = this.message;
        const hasItems = this.visibleItemCount > 0;

        // Заголовок, сообщение и наличие списка сервисы правят прямо полями, без
        // сеттеров, — поэтому состав пересобираем от актуального состояния, но
        // только когда он ДЕЙСТВИТЕЛЬНО изменился: syncStructure зовётся с
        // каждого layout, а перестановка детей на каждом кадре была бы тратой.
        const key = `${message === null ? "-" : message.fg}|${hasItems ? "list" : "-"}`;
        if (key !== this.structureKey) {
            this.structureKey = key;
            const children: TUIElement[] = [this.inputRow];
            if (message !== null) {
                this.messageLabel.style = { fg: message.fg };
                children.push(this.messageRow);
            }
            if (hasItems) {
                children.push(this.separatorRow);
                children.push(this.list);
            }
            this.body.replaceChildren(children);
            this.markDirty();
        }

        this.frame.setTitle(this.title);
        this.frame.setSeparatorRow(hasItems ? BORDER_THICKNESS + this.headerRows : null);
    }

    private rebuildRows(): void {
        const innerWidth = Math.max(0, this.preferredWidth - BORDER_THICKNESS * 2);
        this.rowsWidth = innerWidth;
        this.list.clear();
        this.rowElements = [];
        const hasIcons = this.itemsValue.some((item) => item.icon !== undefined);
        for (const [index, item] of this.itemsValue.entries()) {
            const row = buildItemRow(item, index, innerWidth, {
                hasIcons,
                ...(this.canPickMany ? { checked: this.checkedValue.has(item) } : {}),
            });
            this.rowElements.push(row);
            this.list.appendRow(row);
        }
    }

    /**
     * Пересобирает строки, оставив экран на месте: чекбокс меняется на одной
     * строке, а ряды у нас неизменяемые — перестраивается весь список, и без
     * возврата прокрутки с курсором длинный список прыгал бы на каждый `Space`.
     */
    private rebuildKeepingView(): void {
        const keepIndex = this.selectedIndexValue;
        const keepScroll = this.list.scrollTop;
        this.rebuildRows();
        this.list.scrollTop = keepScroll;
        this.moveCursorTo(keepIndex, { notify: false });
        this.markDirty();
    }

    /** Двигает курсор списка; программные перемещения молчат по контракту. */
    private moveCursorTo(index: number, opts: { notify: boolean }): void {
        if (index < 0 || index >= this.itemsValue.length) return;
        this.suppressActiveNotification = !opts.notify;
        try {
            this.list.setCursorTo(rowId(index));
        } finally {
            this.suppressActiveNotification = false;
        }
    }

    private notifyActive(): void {
        if (this.suppressActiveNotification) return;
        this.onActiveItemChanged?.(this.itemsValue[this.selectedIndexValue], this.selectedIndexValue);
    }

    // ─── Input ──────────────────────────────────────────────────────────────

    private handleKeyDown(key: string, event: { preventDefault(): void }): void {
        switch (key) {
            case "ArrowDown":
                event.preventDefault();
                this.moveSelection(1);
                break;
            case "ArrowUp":
                event.preventDefault();
                this.moveSelection(-1);
                break;
            case "PageDown":
                event.preventDefault();
                this.moveSelection(Math.max(1, this.visibleItemCount));
                break;
            case "PageUp":
                event.preventDefault();
                this.moveSelection(-Math.max(1, this.visibleItemCount));
                break;
            case " ":
                // Пробел переключает отметку ТОЛЬКО в множественном выборе; в
                // остальных случаях это обычный символ запроса, и default-action
                // строки ввода обязан его получить — поэтому без preventDefault.
                if (this.canPickMany) {
                    event.preventDefault();
                    this.toggleChecked();
                }
                break;
            case "Enter":
                event.preventDefault();
                this.accept();
                break;
            case "Escape":
                event.preventDefault();
                this.onCancel?.();
                break;
        }
    }

    private moveSelection(delta: number): void {
        if (this.itemsValue.length === 0) return;
        const next = Math.max(0, Math.min(this.itemsValue.length - 1, this.selectedIndexValue + delta));
        if (next === this.selectedIndexValue) return;
        this.moveCursorTo(next, { notify: true });
    }

    /** Переключает отметку строки под курсором (множественный выбор). */
    private toggleChecked(): void {
        const item = this.itemsValue.at(this.selectedIndexValue);
        if (item === undefined) return;
        if (!this.checkedValue.delete(item)) this.checkedValue.add(item);
        this.rebuildKeepingView();
    }

    private accept(): void {
        // Жёсткая ошибка валидации блокирует Enter в любом режиме.
        if (this.validationMessage !== null && this.validationSeverity === "error") return;
        if (this.acceptMode === "value") {
            this.onAcceptValue?.(this.getQuery());
            return;
        }
        if (this.canPickMany) {
            // Принимается НАБОР отметок, в том числе пустой: «ничего не
            // отмечено» — это пустой ответ, а не отмена и не строка под курсором.
            this.onAcceptMany?.();
            return;
        }
        if (this.itemsValue.length > 0) {
            this.onAccept?.(this.itemsValue[this.selectedIndexValue], this.selectedIndexValue);
        }
    }

    /** Наведение мышью ведёт выделение за собой (поведение VS Code). */
    private handleMouseMove(event: TUIMouseEvent): void {
        const index = this.itemIndexFromEvent(event);
        if (index === null || index === this.selectedIndexValue) return;
        // Молча: наведение — не навигация, живое превью от него не дёргается.
        this.moveCursorTo(index, { notify: false });
    }

    /**
     * Клик по строке выделяет её и принимает — как Enter. В множественном
     * выборе принимать нечего: клик переключает отметку строки, как `Space`
     * (иначе первый же клик закрыл бы пикер с полупустым набором).
     */
    private handleClick(event: TUIMouseEvent): void {
        if (event.button !== "left") return;
        const index = this.itemIndexFromEvent(event);
        if (index === null) return;
        event.preventDefault();
        this.moveCursorTo(index, { notify: false });
        if (this.canPickMany) {
            this.toggleChecked();
            return;
        }
        this.accept();
    }

    /**
     * Экранная точка → индекс строки списка. Геометрию берём у самого списка
     * (его позиция и `scrollTop` публичны), а не пересчитываем «шапку» руками.
     */
    private itemIndexFromEvent(event: TUIMouseEvent): number | null {
        if (this.visibleItemCount === 0) return null;
        const row = event.screenY - this.list.globalPosition.y;
        // Окно списка ровно по числу видимых строк, поэтому попадание в него уже
        // означает валидный индекс — второй проверки границ не нужно.
        if (row < 0 || row >= this.list.layoutSize.height) return null;
        return this.list.scrollTop + row;
    }

    // ─── Layout ─────────────────────────────────────────────────────────────

    public override getMinIntrinsicWidth(_height: number): number {
        return 20;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.preferredWidth;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.totalHeight;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.totalHeight;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        this.syncStructure();
        const natural = new Size(this.getMaxIntrinsicWidth(1), this.getMaxIntrinsicHeight(0));
        const size = constraints.constrain(natural);

        // Ширина поменялась (ресайз терминала) — бюджеты лейбла и описания в
        // рядах посчитаны на старую, пересобираем ДО раскладки детей.
        const innerWidth = Math.max(0, size.width - BORDER_THICKNESS * 2);
        if (this.itemsValue.length > 0 && innerWidth !== this.rowsWidth) {
            const keep = this.selectedIndexValue;
            this.rebuildRows();
            this.moveCursorTo(keep, { notify: false });
        }

        super.performLayout(BoxConstraints.tight(size));

        // Сообщение обрезаем по месту, а не полагаемся на клип: у усечения свой
        // хвостовой символ, и он должен быть виден.
        //
        // ТОЛЬКО при изменении текста: `setText` метит дерево грязным безусловно,
        // а мы здесь внутри layout'а. Безусловный вызов оставлял пикер layout-dirty
        // после КАЖДОГО кадра, а damage-обход такое поддерево считает не
        // разложенным и не рисует — оверлей с строкой сообщения (флейвор InputBox
        // с `prompt`) замирал на первом кадре: набранное в поле не появлялось.
        const message = this.message;
        if (message !== null) {
            const avail = Math.max(0, size.width - BORDER_THICKNESS * 2 - CONTENT_PAD * 2);
            const text = truncateEnd(message.text, avail);
            if (this.messageLabel.getText() !== text) this.messageLabel.setText(text);
        }

        this.layoutChild(this.frame, 0, 0, BoxConstraints.tight(size));
        return size;
    }
}

/**
 * Идентичность строки для {@link QuickPickElement.refreshItems}: предметы
 * пересобираются заново на каждый рефреш, поэтому сравниваем поля, которые
 * строку определяют (для файла это basename + каталог).
 */
function sameItem(a: QuickPickItem, b: QuickPickItem): boolean {
    return a.label === b.label && a.description === b.description;
}
