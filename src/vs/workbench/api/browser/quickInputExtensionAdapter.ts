import { renderCodicons } from "../../../base/common/codicons.ts";
import type { InputValidation, QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../common/quickPickItem.ts";
import type { IQuickInputBoxRequest, IQuickInputSink } from "../common/iExtensionWindowSinks.ts";
import type { IWireQuickPickRequest, IWireValidationMessage } from "../common/wireTypes.ts";

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
