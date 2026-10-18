import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { EventEmitter, QuickPickItemKind } from "./vscodeTypes.ts";
import type { IWireQuickPickEvent, IWireQuickPickSessionItem } from "./wireTypes.ts";

/** Изменённые поля, копящиеся до отправки; `null` — «сброшено в undefined». */
type PendingUpdate = Record<string, unknown>;

/**
 * Объектная форма пикера (`window.createQuickPick`) на стороне субпроцесса —
 * `ExtHostQuickPick` эталона (`extHostQuickOpen.ts`).
 *
 * Объект держит СВОЮ копию состояния (геттеры отвечают сразу, без раунд-трипа),
 * а каждый сеттер кладёт поле в дифф: пока пикер виден, дифф уходит хосту
 * таймером на следующий тик (пачка присваиваний подряд — одна отправка), а
 * `show()`/`hide()` шлют накопленное немедленно. Действия человека хост
 * пересказывает событиями `window.quickPick.event`; пункты в них — handle'ы,
 * то есть индексы в массиве `items` расширения: расширение получает обратно
 * СВОИ объекты.
 *
 * Кнопок (`buttons`, кнопки пунктов) нет: их декларации в нашем `vscode.d.ts`
 * не подняты, а оверлей их не рисует.
 */
export class ExtHostQuickPick<T extends vscode.QuickPickItem> implements vscode.QuickPick<T> {
    private titleValue: string | undefined;
    private stepValue: number | undefined;
    private totalStepsValue: number | undefined;
    private enabledValue = true;
    private busyValue = false;
    // Дефолты геттеров — эталонные (`extHostQuickOpen.ts`), даже там, где d.ts
    // говорит иное: хост получает поле только после присваивания, и до него
    // действуют его собственные дефолты.
    private ignoreFocusOutValue = true;
    private valueValue = "";
    private placeholderValue: string | undefined;
    private promptValue: string | undefined;
    private itemsValue: readonly T[] = [];
    private readonly handlesToItems = new Map<number, T>();
    private readonly itemsToHandles = new Map<T, number>();
    private canSelectManyValue = false;
    private matchOnDescriptionValue = true;
    private matchOnDetailValue = true;
    private keepScrollPositionValue = false;
    private activeItemsValue: readonly T[] = [];
    private selectedItemsValue: readonly T[] = [];

    private visible = false;
    /**
     * Ждём ли `hide` от хоста: событие скрытия отдаём расширению ровно один раз
     * на показ, даже если пришло и от хоста, и от `dispose()` (эталон, #135747).
     */
    private expectingHide = false;
    private disposed = false;
    private pending: PendingUpdate = {};
    private updateTimer: ReturnType<typeof setTimeout> | undefined;

    private readonly onDidChangeValueEmitter = new EventEmitter<string>();
    private readonly onDidAcceptEmitter = new EventEmitter<void>();
    private readonly onDidChangeActiveEmitter = new EventEmitter<readonly T[]>();
    private readonly onDidChangeSelectionEmitter = new EventEmitter<readonly T[]>();
    private readonly onDidHideEmitter = new EventEmitter<void>();

    public readonly onDidChangeValue = this.onDidChangeValueEmitter.event;
    public readonly onDidAccept = this.onDidAcceptEmitter.event;
    public readonly onDidChangeActive = this.onDidChangeActiveEmitter.event;
    public readonly onDidChangeSelection = this.onDidChangeSelectionEmitter.event;
    public readonly onDidHide = this.onDidHideEmitter.event;

    public constructor(
        private readonly rpc: SubprocessRpc,
        public readonly handle: number,
        private readonly onDispose: () => void,
    ) {}

    public get title(): string | undefined {
        return this.titleValue;
    }
    public set title(title: string | undefined) {
        this.titleValue = title;
        this.update({ title });
    }

    public get step(): number | undefined {
        return this.stepValue;
    }
    public set step(step: number | undefined) {
        this.stepValue = step;
        this.update({ step });
    }

    public get totalSteps(): number | undefined {
        return this.totalStepsValue;
    }
    public set totalSteps(totalSteps: number | undefined) {
        this.totalStepsValue = totalSteps;
        this.update({ totalSteps });
    }

    public get enabled(): boolean {
        return this.enabledValue;
    }
    public set enabled(enabled: boolean) {
        this.enabledValue = enabled;
        this.update({ enabled });
    }

    public get busy(): boolean {
        return this.busyValue;
    }
    public set busy(busy: boolean) {
        this.busyValue = busy;
        this.update({ busy });
    }

    public get ignoreFocusOut(): boolean {
        return this.ignoreFocusOutValue;
    }
    public set ignoreFocusOut(ignoreFocusOut: boolean) {
        // Хосту не шлём: общий оверлей закрывается кликом мимо всегда — у
        // `showInputBox`/`showQuickPick` опция не поддержана точно так же
        // (docs/public/API-COVERAGE.md).
        this.ignoreFocusOutValue = ignoreFocusOut;
    }

    public get value(): string {
        return this.valueValue;
    }
    public set value(value: string) {
        this.valueValue = value;
        this.update({ value });
    }

    public get placeholder(): string | undefined {
        return this.placeholderValue;
    }
    public set placeholder(placeholder: string | undefined) {
        this.placeholderValue = placeholder;
        this.update({ placeholder });
    }

    public get prompt(): string | undefined {
        return this.promptValue;
    }
    public set prompt(prompt: string | undefined) {
        this.promptValue = prompt;
        this.update({ prompt });
    }

    public get items(): readonly T[] {
        return this.itemsValue;
    }
    public set items(items: readonly T[]) {
        this.itemsValue = items.slice();
        this.handlesToItems.clear();
        this.itemsToHandles.clear();
        const wire: IWireQuickPickSessionItem[] = [];
        for (const [handle, item] of items.entries()) {
            this.handlesToItems.set(handle, item);
            this.itemsToHandles.set(item, handle);
            // Разделитель — не строка списка: наш однострочный список его не
            // рисует, а выбрать его нельзя и в эталоне. Сравнение — числом:
            // enum у расширения из его копии d.ts, значения те же.
            if ((item.kind as number | undefined) === QuickPickItemKind.Separator) continue;
            wire.push({
                handle,
                label: item.label,
                description: item.description,
                detail: item.detail,
                alwaysShow: item.alwaysShow === true,
            });
        }
        this.update({ items: wire });
    }

    public get canSelectMany(): boolean {
        return this.canSelectManyValue;
    }
    public set canSelectMany(canSelectMany: boolean) {
        this.canSelectManyValue = canSelectMany;
        this.update({ canSelectMany });
    }

    public get matchOnDescription(): boolean {
        return this.matchOnDescriptionValue;
    }
    public set matchOnDescription(matchOnDescription: boolean) {
        this.matchOnDescriptionValue = matchOnDescription;
        this.update({ matchOnDescription });
    }

    public get matchOnDetail(): boolean {
        return this.matchOnDetailValue;
    }
    public set matchOnDetail(matchOnDetail: boolean) {
        this.matchOnDetailValue = matchOnDetail;
        this.update({ matchOnDetail });
    }

    public get keepScrollPosition(): boolean {
        return this.keepScrollPositionValue;
    }
    public set keepScrollPosition(keepScrollPosition: boolean) {
        this.keepScrollPositionValue = keepScrollPosition;
        this.update({ keepScrollPosition });
    }

    public get activeItems(): readonly T[] {
        return this.activeItemsValue;
    }
    public set activeItems(activeItems: readonly T[]) {
        this.activeItemsValue = activeItems.filter((item) => this.itemsToHandles.has(item));
        this.update({ activeItems: this.toHandles(this.activeItemsValue) });
    }

    public get selectedItems(): readonly T[] {
        return this.selectedItemsValue;
    }
    public set selectedItems(selectedItems: readonly T[]) {
        this.selectedItemsValue = selectedItems.filter((item) => this.itemsToHandles.has(item));
        this.update({ selectedItems: this.toHandles(this.selectedItemsValue) });
    }

    public show(): void {
        this.visible = true;
        this.expectingHide = true;
        this.update({ visible: true });
    }

    public hide(): void {
        this.visible = false;
        this.update({ visible: false });
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.fireDidHide();
        if (this.updateTimer !== undefined) clearTimeout(this.updateTimer);
        this.updateTimer = undefined;
        this.onDidChangeValueEmitter.dispose();
        this.onDidAcceptEmitter.dispose();
        this.onDidChangeActiveEmitter.dispose();
        this.onDidChangeSelectionEmitter.dispose();
        this.onDidHideEmitter.dispose();
        this.onDispose();
        this.rpc.notify("window.quickPick.dispose", { handle: this.handle });
    }

    /** Событие хоста про этот пикер. */
    public acceptEvent(event: IWireQuickPickEvent): void {
        switch (event.kind) {
            case "changeValue":
                this.valueValue = event.value;
                this.onDidChangeValueEmitter.fire(event.value);
                break;
            case "accept":
                this.onDidAcceptEmitter.fire();
                break;
            case "changeActive":
                this.activeItemsValue = this.toItems(event.items);
                this.onDidChangeActiveEmitter.fire(this.activeItemsValue);
                break;
            case "changeSelection":
                this.selectedItemsValue = this.toItems(event.items);
                this.onDidChangeSelectionEmitter.fire(this.selectedItemsValue);
                break;
            case "hide":
                // Видимость объекта НЕ снимаем — как эталон: ответ хоста на
                // прошлый hide() может прийти уже во время следующего показа.
                // Цена та же, что в vscode: после Escape `dispose()` даёт
                // второй onDidHide.
                this.fireDidHide();
                break;
        }
    }

    private fireDidHide(): void {
        if (!this.expectingHide) return;
        // Показ между `hide()` и пришедшим `hide` уже ждёт своего скрытия —
        // флаг наследует видимость (эталон: show→hide→show→hide = два события).
        this.expectingHide = this.visible;
        this.onDidHideEmitter.fire();
    }

    private toHandles(items: readonly T[]): number[] {
        // Отфильтровано сеттером: у каждого предмета handle есть.
        return items.map((item) => this.itemsToHandles.get(item) ?? -1);
    }

    private toItems(handles: readonly number[]): T[] {
        const items: T[] = [];
        for (const handle of handles) {
            const item = this.handlesToItems.get(handle);
            if (item !== undefined) items.push(item);
        }
        return items;
    }

    private update(properties: PendingUpdate): void {
        if (this.disposed) return;
        for (const [key, value] of Object.entries(properties)) {
            this.pending[key] = value === undefined ? null : value;
        }
        if ("visible" in this.pending) {
            if (this.updateTimer !== undefined) clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
            this.dispatchUpdate();
        } else if (this.visible && this.updateTimer === undefined) {
            // Пачка присваиваний подряд — одна отправка и один кадр.
            this.updateTimer = setTimeout(() => {
                this.updateTimer = undefined;
                this.dispatchUpdate();
            }, 0);
        }
    }

    private dispatchUpdate(): void {
        this.rpc.notify("window.quickPick.update", { ...this.pending, handle: this.handle });
        this.pending = {};
    }
}
