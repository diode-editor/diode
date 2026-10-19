import { renderCodicons } from "../../../base/common/codicons.ts";
import type { InputValidation, QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import type {
    QuickPickSession,
    QuickPickSessionItem,
    QuickPickSessionState,
} from "../../browser/parts/quickinput/quickPickSession.ts";
import type { QuickPickItem } from "../../common/quickPickItem.ts";
import type { IQuickInputBoxRequest, IQuickInputSink } from "../common/iExtensionWindowSinks.ts";
import type {
    IWireQuickPickEvent,
    IWireQuickPickRequest,
    IWireQuickPickSessionItem,
    IWireQuickPickUpdate,
    IWireValidationMessage,
} from "../common/wireTypes.ts";

/** Строка объектного пикера расширения: handle едет обратно в событиях. */
interface IExtensionQuickPickItem extends QuickPickSessionItem {
    readonly handle: number;
}

/** Объектный пикер расширения на нашей стороне: сессия плюс handle → строка. */
interface IExtensionQuickPick {
    readonly session: QuickPickSession<IExtensionQuickPickItem>;
    byHandle: ReadonlyMap<number, IExtensionQuickPickItem>;
}

/**
 * Мост `window.showInputBox` / `window.showQuickPick` расширений к
 * QuickInput-оверлею приложения (реализация {@link IQuickInputSink}): просьба
 * субпроцесса поднимает тот же виджет, которым пользуются палитра, Quick Open и
 * наши команды, а введённое/выбранное уезжает обратно расширению. Проводка —
 * `extensionHostModule` (сток `ExtensionHost.quickInputSink`).
 *
 * Все ЯРЛЫКИ просьбы (заголовок, подсказка, placeholder, метки и описания
 * пунктов, сообщение валидации) проходят через {@link renderCodicons}: разметку
 * `$(check)` расширения пишут именно в них, и без подмены человек видел бы
 * литерал. Исключение одно — `value`: это не ярлык, а текст, который правят и
 * который уезжает обратно расширению. Перечень раковин и обоснование по каждому
 * полю — в `extensionTextSinks.test.ts`.
 *
 * Оверлей один на всё приложение, и хозяев у него теперь четверо. Отсюда
 * {@link currentHandle}: гасить по токену расширения можно ТОЛЬКО свой живой
 * показ — если оверлей уже перехватили (открылся Quick Open, пришла следующая
 * просьба), наш промис сервис к этому моменту уже довёл до `undefined` сам.
 */
export class QuickInputExtensionAdapter implements IQuickInputSink {
    /** Handle показа, который сейчас держит оверлей; null — ничего нашего не открыто. */
    private currentHandle: number | null = null;
    /** Живые объектные пикеры расширений по handle. */
    private readonly quickPicks = new Map<number, IExtensionQuickPick>();

    public constructor(private readonly quickInput: QuickInputService) {}

    public async showInputBox(request: IQuickInputBoxRequest): Promise<string | undefined> {
        const ask = request.validate;
        // Валидатор отдаём ВСЕГДА, даже когда расширение его не прислало: без
        // канала он отвечает «значение в порядке» на любой текст, и для виджета
        // это ровно то же, что отсутствие валидации. Ветка здесь была бы
        // неотличимой от этой — лишний шов.
        const validateInput = async (value: string): Promise<InputValidation | null> =>
            // Stryker disable next-line OptionalChaining: без `?.` validateInput отклоняется, когда расширение валидатора не прислало, — а зовут его из fire-and-forget ветки runValidation, мимо стека теста. Тесты «без валидации» при этом ПРОХОДЯТ: unhandled rejection роняет раннер (RuntimeError) вместо падения теста. Дыра в локализации ошибок слушателей (docs/TESTING.md → #275), а не пробел в тестах этой строки.
            toValidation(await ask?.(value));
        this.currentHandle = request.handle;
        try {
            // Условных спредов нет: у опций пикера отсутствие поля и
            // `undefined` — одно и то же, так что ветка была бы лишним швом.
            return await this.quickInput.input({
                title: renderLabel(request.title),
                prompt: renderLabel(request.prompt),
                placeholder: renderLabel(request.placeHolder),
                // `value` — НЕ ярлык: это текст, который человек правит и который
                // уезжает обратно расширению. Подмена испортила бы данные.
                value: request.value,
                password: request.password,
                validateInput,
            });
        } finally {
            this.release(request.handle);
        }
    }

    public async showQuickPick(request: IWireQuickPickRequest): Promise<readonly number[] | undefined> {
        // Предметы строим один раз и отвечаем ИНДЕКСАМИ в этом массиве: расширение
        // должно получить обратно свои объекты, а не пересобранные по проводу.
        const items: QuickPickItem[] = request.items.map((item) => ({
            label: renderCodicons(item.label),
            description: renderLabel(item.description),
        }));
        this.currentHandle = request.handle;
        try {
            if (!request.canPickMany) {
                const picked = await this.quickInput.quickPick({
                    title: renderLabel(request.title),
                    placeholder: renderLabel(request.placeHolder),
                    items,
                });
                if (picked === undefined) return undefined;
                return [items.indexOf(picked)];
            }
            const picked = await this.quickInput.quickPickMany({
                title: renderLabel(request.title),
                placeholder: renderLabel(request.placeHolder),
                items,
                picked: request.picked.map((index) => items[index]),
            });
            if (picked === undefined) return undefined;
            return picked.map((item) => items.indexOf(item));
        } finally {
            this.release(request.handle);
        }
    }

    public updateQuickPick(update: IWireQuickPickUpdate, emit: (event: IWireQuickPickEvent) => void): void {
        let pick = this.quickPicks.get(update.handle);
        if (pick === undefined) {
            pick = this.createQuickPick(update.handle, emit);
            this.quickPicks.set(update.handle, pick);
        }
        const changes = toSessionChanges(update, pick);
        // Скрытие — до применения диффа, показ — после: открываться пикер
        // должен уже в новом состоянии, а закрываться — не мигнув им.
        if (update.visible === false) pick.session.hide();
        pick.session.update(changes);
        if (update.visible === true) pick.session.show();
    }

    public disposeQuickPick(handle: number): void {
        const pick = this.quickPicks.get(handle);
        if (pick === undefined) return;
        this.quickPicks.delete(handle);
        pick.session.dispose();
    }

    private createQuickPick(handle: number, emit: (event: IWireQuickPickEvent) => void): IExtensionQuickPick {
        const handles = (items: readonly IExtensionQuickPickItem[]): number[] => items.map((item) => item.handle);
        const session = this.quickInput.createQuickPick<IExtensionQuickPickItem>({
            onDidChangeValue: (value) => {
                emit({ handle, kind: "changeValue", value });
            },
            onDidAccept: () => {
                emit({ handle, kind: "accept" });
            },
            onDidChangeActive: (items) => {
                emit({ handle, kind: "changeActive", items: handles(items) });
            },
            onDidChangeSelection: (items) => {
                emit({ handle, kind: "changeSelection", items: handles(items) });
            },
            onDidHide: () => {
                emit({ handle, kind: "hide" });
            },
        });
        return { session, byHandle: new Map() };
    }

    public cancel(handle: number): void {
        if (this.currentHandle !== handle) return;
        this.currentHandle = null;
        this.quickInput.cancel();
    }

    /**
     * Показ закончился (человек ответил, отменил или его перехватили). Слот
     * чистим, только если он всё ещё наш: перехват уже поставил туда чужой
     * handle, и затирать его нельзя.
     */
    private release(handle: number): void {
        if (this.currentHandle === handle) this.currentHandle = null;
    }
}

/**
 * Ответ расширения на валидацию → исход для QuickInputService. Молчание
 * (`undefined` — валидатора нет вовсе) и `null` значат одно: значение годное.
 */
function toValidation(message: IWireValidationMessage | null | undefined): InputValidation | null {
    if (message == null) return null;
    return { message: renderCodicons(message.message), severity: message.severity };
}

/**
 * {@link renderCodicons} для необязательного ярлыка: «поля нет» остаётся
 * `undefined` — у опций пикера отсутствие и пустая строка значат разное.
 */
function renderLabel(text: string | undefined): string | undefined {
    return text === undefined ? undefined : renderCodicons(text);
}

/**
 * Дифф провода → изменения сессии. Ярлыки (лейбл, описание, заголовок,
 * placeholder, prompt) проходят {@link renderCodicons}; `value` — нет: это
 * текст, который человек правит и который уезжает обратно расширению.
 *
 * Предметы пересобираются целиком (новый набор handle'ов), и уже по НОВОМУ
 * набору разрешаются `activeItems`/`selectedItems` того же диффа.
 */
function toSessionChanges(
    update: IWireQuickPickUpdate,
    pick: IExtensionQuickPick,
): Partial<QuickPickSessionState<IExtensionQuickPickItem>> {
    const changes: Record<string, unknown> = {};
    for (const key of LABEL_FIELDS) {
        if (key in update) changes[key] = renderLabel(update[key] ?? undefined);
    }
    for (const key of PLAIN_FIELDS) {
        if (key in update) changes[key] = update[key] ?? undefined;
    }
    if (update.items !== undefined) {
        const items = update.items.map(toSessionItem);
        pick.byHandle = new Map(items.map((item) => [item.handle, item]));
        changes.items = items;
    }
    const resolve = (handles: readonly number[]): IExtensionQuickPickItem[] =>
        handles.flatMap((handle) => {
            const item = pick.byHandle.get(handle);
            return item === undefined ? [] : [item];
        });
    if (update.activeItems !== undefined) changes.activeItems = resolve(update.activeItems);
    if (update.selectedItems !== undefined) changes.selectedItems = resolve(update.selectedItems);
    return changes as Partial<QuickPickSessionState<IExtensionQuickPickItem>>;
}

/** Поля диффа — ярлыки: значки `$(name)` в них подменяются. */
const LABEL_FIELDS = ["title", "placeholder", "prompt"] as const;

/**
 * Поля диффа, которые едут как есть (`null` — «сброшено»). `value` среди них:
 * это не ярлык, а текст, который человек правит и который уезжает обратно.
 */
const PLAIN_FIELDS = [
    "step",
    "totalSteps",
    "value",
    "canSelectMany",
    "matchOnDescription",
    "matchOnDetail",
    "keepScrollPosition",
] as const;

/**
 * Строка провода → строка сессии. `detail` отдельной строкой наш однострочный
 * ряд не умеет — он встаёт НА МЕСТО описания, когда описания нет (та же
 * политика, что у `showQuickPick`), а для поиска остаётся собой.
 */
function toSessionItem(item: IWireQuickPickSessionItem): IExtensionQuickPickItem {
    const shown = nonEmpty(item.description) ?? nonEmpty(item.detail);
    return {
        handle: item.handle,
        label: renderCodicons(item.label),
        description: renderLabel(shown),
        detail: item.detail,
        alwaysShow: item.alwaysShow,
    };
}

/** Текст, если в нём что-то есть; пустая строка и отсутствие — одно и то же. */
function nonEmpty(text: string | undefined): string | undefined {
    return text === "" ? undefined : text;
}
