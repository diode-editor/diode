import { DisplayLine } from "@tuidom/core/common/displayLine";
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

/** ASCII, а не `•`/`●`: у точек в терминале неоднозначная ширина (East Asian Ambiguous). */
export const MASK_CHAR = "*";

/**
 * Составной: хром рисует {@link QuickPickFrameElement}, запрос — `InputElement`,
 * результаты — `ListViewElement`. Фильтрацию не делает: `items` приходят
 * отфильтрованными, с `labelMatchRanges`. Живёт в Diode, а не в `@tuidom/elements`:
 * его API — понятия редактора, а движок держит только виджеты общего назначения.
 */
export class QuickPickElement extends TUIElement {
    public placeholder = "Type to search…";
    public maxVisibleItems = 10;

    /**
     * Уходит рамке сразу, а не из layout: пометка посреди раскладки достаётся
     * следующему кадру, и заголовок, меняемый на ходу, отставал бы на кадр.
     */
    public get title(): string | undefined {
        return this.frame.title;
    }
    public set title(value: string | undefined) {
        this.frame.setTitle(value);
    }
    /** Перебивается {@link validationMessage}. */
    public prompt: string | undefined = undefined;
    /** При severity "error" блокирует Enter. */
    public validationMessage: string | null = null;
    public validationSeverity: ValidationSeverity = "error";
    /** `"item"` — onAccept только на непустом списке; `"value"` — всегда onAcceptValue(getQuery()). */
    public acceptMode: QuickPickAcceptMode = "item";
    /** Enter принимает набор отмеченных; подсветка сама по себе выбором не считается. */
    public canPickMany = false;
    /** Маска — только представление: getQuery и валидация видят настоящий текст, inspectState — маску. */
    public password = false;
    public onAcceptValue: ((value: string) => void) | null = null;
    public preferredWidth = 60;

    public onQueryChange: ((query: string) => void) | null = null;
    public onAccept: ((item: QuickPickItem, index: number) => void) | null = null;
    /** Файрится и на пустом наборе, и на пустом списке. */
    public onAcceptMany: (() => void) | null = null;
    /** Enter на пустом списке в режиме "item": `QuickPick.onDidAccept` эталона файрится и без выбора. */
    public onAcceptEmpty: (() => void) | null = null;
    /** Только по действию человека (`Space`, клик). */
    public onCheckedChange: (() => void) | null = null;
    public onCancel: (() => void) | null = null;
    /**
     * Только по воле пользователя (стрелки, PageUp/Down) — для живого превью; на
     * `items =`, {@link refreshItems} и {@link setActiveIndex} не файрится.
     */
    public onActiveItemChanged: ((item: QuickPickItem, index: number) => void) | null = null;

    public readonly inputElement: InputElement;

    private readonly frame: QuickPickFrameElement;
    private readonly body: VFlexElement;
    private readonly inputRow: PaddingContainerElement;
    private readonly messageLabel: TextLabelElement;
    private readonly messageRow: PaddingContainerElement;
    /** Фона не красит: линия рамки видна из-под неё. */
    private readonly separatorRow: TUIElement;
    private readonly list: ListViewElement;

    private itemsValue: readonly QuickPickItem[] = [];
    /** По идентичности, а не по индексу: отметки обязаны пережить смену фильтра. */
    private readonly checkedValue = new Set<QuickPickItem>();
    private selectedIndexValue = 0;
    /** -1 — рядов нет. */
    private rowsWidth = -1;
    private structureKey = "";
    /** Список отдаёт в onSelect элемент, а не индекс. */
    private rowElements: TUIElement[] = [];
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
     * Без прыжка курсора наверх — для того же запроса: прежний предмет ищется по
     * label + description, исчез — прежний индекс клампится.
     */
    public refreshItems(value: readonly QuickPickItem[]): void {
        if (this.selectedIndexValue < 0) {
            this.itemsValue = value;
            this.rebuildRows();
            this.clearCursorIfNoActive();
            // Stryker disable next-line CallExpression: пересборка рядов метит список грязным, а `performLayout` начинается с того же `syncStructure` — состав догоняет до кадра
            this.syncStructure();
            return;
        }
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

    /** `-1` — ни одна ({@link clearActive}). */
    public get selectedIndex(): number {
        return this.selectedIndexValue;
    }

    /** Состояние `activeItems = []` эталона: Enter принимает набранное ({@link onAcceptEmpty}). */
    public clearActive(): void {
        this.selectedIndexValue = -1;
        this.clearCursorIfNoActive();
    }

    /** Порядок — порядок отметки; упорядочить по списку — дело того, кто список отдал. */
    public get checkedItems(): ReadonlySet<QuickPickItem> {
        return this.checkedValue;
    }

    /**
     * Обязательный первый шаг любого показа: виджет общий, и без сброса чекбоксы и
     * маска прошлого показа оставались висеть (Enter палитры уходил в onAcceptMany).
     */
    public resetFlavorState(): void {
        this.canPickMany = false;
        this.checkedValue.clear();
        this.onAcceptMany = null;
        this.onAcceptEmpty = null;
        this.onCheckedChange = null;
        this.password = false;
    }

    public setCheckedItems(items: Iterable<QuickPickItem>): void {
        this.checkedValue.clear();
        for (const item of items) this.checkedValue.add(item);
        this.rebuildKeepingView();
    }

    /** {@link onActiveItemChanged} не файрит — это не пользовательская навигация. */
    public setActiveIndex(index: number): void {
        if (this.itemsValue.length === 0) return;
        const clamped = Math.max(0, Math.min(this.itemsValue.length - 1, index));
        this.selectedIndexValue = clamped;
        this.moveCursorTo(clamped, { notify: false });
    }

    public getQuery(): string {
        return this.inputElement.inputState.value;
    }

    /** `[start, end)` в графемах; курсор в `end`. Набранное следом заменит выделенное. */
    public setQuerySelection(start: number, end: number): void {
        const state = this.inputElement.inputState;
        const length = new DisplayLine(state.value).slots.length;
        const to = Math.max(0, Math.min(length, end));
        const from = Math.max(0, Math.min(to, start));
        state.moveCursorToStart();
        for (let i = 0; i < from; i++) state.moveCursorRight();
        for (let i = from; i < to; i++) state.selectRight();
        // Stryker disable next-line CallExpression: без пометки не перезапустится раскладка, и выделение дорисует следующий кадр — наблюдаемо только в живом приложении (TestApp раскладывает кадр безусловно); гейт — e2e-сценарий quick-input (кадр file-dialog-typed)
        this.markDirty();
    }

    public setQuery(value: string): void {
        this.inputElement.inputState.value = value;
        this.markDirty();
    }

    public override focus(): void {
        this.inputElement.focus();
    }

    /**
     * Запрос отдаётся как виден — под маской, секрет не уходит в инспектор и e2e-снимок.
     * Отмеченные строки — тоже: иначе отметку не видно ниоткуда, кроме кадра.
     */
    public override inspectState(): Record<string, unknown> {
        return {
            query: this.visibleQuery,
            activeIndex: this.selectedIndexValue,
            title: this.title,
            items: this.itemsValue.map((item) => item.label),
            ...(this.canPickMany
                ? { checked: this.itemsValue.filter((item) => this.checkedValue.has(item)).map((item) => item.label) }
                : {}),
        };
    }

    /** По одной {@link MASK_CHAR} на графемный кластер — так считает и `InputElement`. */
    private get visibleQuery(): string {
        const query = this.getQuery();
        if (!this.password) return query;
        return MASK_CHAR.repeat(new DisplayLine(query).slots.length);
    }

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

    private syncStructure(): void {
        // Поля правят сервисы, а рисует строка запроса — переносим на каждом синке.
        this.inputElement.placeholder = this.placeholder;
        this.inputElement.maskChar = this.password ? MASK_CHAR : undefined;
        const message = this.message;
        const hasItems = this.visibleItemCount > 0;

        // Сервисы правят поля без сеттеров, а syncStructure зовётся с каждого layout —
        // пересобираем состав только когда он действительно изменился.
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

    /** Ряды неизменяемые: без возврата прокрутки и курсора длинный список прыгал бы на каждый `Space`. */
    private rebuildKeepingView(): void {
        const keepIndex = this.selectedIndexValue;
        const keepScroll = this.list.scrollTop;
        this.rebuildRows();
        this.list.scrollTop = keepScroll;
        this.clearCursorIfNoActive();
        // Stryker disable next-line ObjectLiteral: отсутствующий `notify` читается как `!undefined`, то есть ровно как `notify: false`
        this.moveCursorTo(keepIndex, { notify: false });
    }

    private moveCursorTo(index: number, opts: { notify: boolean }): void {
        if (index < 0 || index >= this.itemsValue.length) return;
        this.suppressActiveNotification = !opts.notify;
        try {
            this.list.setCursorTo(rowId(index));
        } finally {
            this.suppressActiveNotification = false;
        }
    }

    /** Пересборка рядов возвращает курсор списка — снятую подсветку надо снять снова. */
    private clearCursorIfNoActive(): void {
        if (this.selectedIndexValue < 0) this.list.clearCursor();
    }

    private notifyActive(): void {
        if (this.suppressActiveNotification) return;
        this.onActiveItemChanged?.(this.itemsValue[this.selectedIndexValue], this.selectedIndexValue);
    }

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
                // Вне множественного выбора пробел — символ запроса: без preventDefault.
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
        // Без подсветки стрелки встают на край списка, а не шагают от «-1».
        // Stryker disable next-line EqualityOperator: `delta` не бывает нулём — стрелки и страницы шагают минимум на 1
        const from = this.selectedIndexValue < 0 ? (delta > 0 ? -1 : this.itemsValue.length) : this.selectedIndexValue;
        const next = Math.max(0, Math.min(this.itemsValue.length - 1, from + delta));
        if (next === this.selectedIndexValue) return;
        this.moveCursorTo(next, { notify: true });
    }

    private toggleChecked(): void {
        if (this.selectedIndexValue < 0) return;
        const item = this.itemsValue.at(this.selectedIndexValue);
        if (item === undefined) return;
        if (!this.checkedValue.delete(item)) this.checkedValue.add(item);
        this.rebuildKeepingView();
        this.onCheckedChange?.();
    }

    private accept(): void {
        if (this.validationMessage !== null && this.validationSeverity === "error") return;
        if (this.acceptMode === "value") {
            this.onAcceptValue?.(this.getQuery());
            return;
        }
        if (this.canPickMany) {
            // Пустой набор — пустой ответ, а не отмена и не строка под курсором.
            // Stryker disable next-line OptionalChaining: колбэк ставит владелец показа до открытия; пары «множественный выбор без onAcceptMany» в приложении не бывает, а проверка стоит защитой
            this.onAcceptMany?.();
            return;
        }
        if (this.selectedIndexValue >= 0 && this.itemsValue.length > 0) {
            this.onAccept?.(this.itemsValue[this.selectedIndexValue], this.selectedIndexValue);
            return;
        }
        this.onAcceptEmpty?.();
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        const index = this.itemIndexFromEvent(event);
        if (index === null || index === this.selectedIndexValue) return;
        // Молча: наведение — не навигация, живое превью от него не дёргается.
        this.moveCursorTo(index, { notify: false });
    }

    /** В множественном выборе клик переключает отметку: иначе первый клик закрыл бы пикер. */
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

    /** Геометрию берём у самого списка, а не пересчитываем «шапку» руками. */
    private itemIndexFromEvent(event: TUIMouseEvent): number | null {
        if (this.visibleItemCount === 0) return null;
        const row = event.screenY - this.list.globalPosition.y;
        // Окно списка ровно по числу видимых строк, поэтому попадание в него уже
        // означает валидный индекс — второй проверки границ не нужно.
        if (row < 0 || row >= this.list.layoutSize.height) return null;
        return this.list.scrollTop + row;
    }

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

        // Ресайз: бюджеты лейбла и описания посчитаны на старую ширину — пересобираем ДО раскладки детей.
        const innerWidth = Math.max(0, size.width - BORDER_THICKNESS * 2);
        if (this.itemsValue.length > 0 && innerWidth !== this.rowsWidth) {
            const keep = this.selectedIndexValue;
            this.rebuildRows();
            this.moveCursorTo(keep, { notify: false });
            this.clearCursorIfNoActive();
        }

        super.performLayout(BoxConstraints.tight(size));

        // Обрезаем по месту, а не клипом: хвостовой символ усечения должен быть виден.
        // `setText` только при изменении: он метит дерево грязным, а мы внутри layout —
        // оверлей с `prompt` оставался layout-dirty и замирал на первом кадре.
        const message = this.message;
        if (message !== null) {
            const avail = Math.max(0, size.width - BORDER_THICKNESS * 2 - CONTENT_PAD * 2);
            const text = truncateEnd(message.text, avail);
            // Stryker disable next-line ConditionalExpression: сравнение и есть починка — без него дерево остаётся грязным после каждого кадра и оверлей замирает; наблюдаемо только на живом кадре, гейт — демо-сценарий `quick-input` (e2e)
            if (this.messageLabel.getText() !== text) this.messageLabel.setText(text);
        }

        this.layoutChild(this.frame, 0, 0, BoxConstraints.tight(size));
        return size;
    }
}

/** Предметы пересобираются на каждый рефреш — сравниваем поля, а не ссылки. */
function sameItem(a: QuickPickItem, b: QuickPickItem): boolean {
    return a.label === b.label && a.description === b.description;
}
