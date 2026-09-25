import type { InputValidation, QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../common/quickPickItem.ts";
import type { IQuickInputBoxRequest, IQuickInputSink } from "../../services/extensions/node/extensionHost.ts";
import type { IWireQuickPickRequest, IWireValidationMessage } from "../common/wireTypes.ts";

/**
 * Мост `window.showInputBox` / `window.showQuickPick` расширений к
 * QuickInput-оверлею приложения (реализация {@link IQuickInputSink}): просьба
 * субпроцесса поднимает тот же виджет, которым пользуются палитра, Quick Open и
 * наши команды, а введённое/выбранное уезжает обратно расширению. Проводка —
 * `extensionHostModule` (сток `ExtensionHost.quickInputSink`).
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
            toValidation(await ask?.(value));
        this.currentHandle = request.handle;
        try {
            // Поля кладём как есть: у опций пикера отсутствие и `undefined` —
            // одно и то же, поэтому условные спреды тут были бы лишним швом.
            return await this.quickInput.input({
                title: request.title,
                prompt: request.prompt,
                placeholder: request.placeHolder,
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
            label: item.label,
            description: item.description,
        }));
        this.currentHandle = request.handle;
        try {
            if (!request.canPickMany) {
                const picked = await this.quickInput.quickPick({
                    title: request.title,
                    placeholder: request.placeHolder,
                    items,
                });
                if (picked === undefined) return undefined;
                return [items.indexOf(picked)];
            }
            const picked = await this.quickInput.quickPickMany({
                title: request.title,
                placeholder: request.placeHolder,
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
    return { message: message.message, severity: message.severity };
}
