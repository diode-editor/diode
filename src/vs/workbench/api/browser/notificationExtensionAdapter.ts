import type { INotificationRequest, INotificationSink } from "../../services/extensions/node/extensionHost.ts";
import type { NotificationService } from "../../services/notification/browser/notificationService.ts";
import type { IWireMessageItem } from "../common/wireTypes.ts";

/**
 * Мост `window.show{Information,Warning,Error}Message` расширений к поверхности
 * сообщений приложения (реализация {@link INotificationSink}): просьба
 * субпроцесса поднимает тот же тост/диалог, которым пользуются наши команды, а
 * нажатая кнопка уезжает обратно расширению. Проводка — `extensionHostModule`
 * (сток `ExtensionHost.notificationSink`).
 *
 * Адаптер держит показы по `handle`: гасить по смерти субпроцесса можно только
 * СВОИ — сообщения, поднятые ядром, к расширению отношения не имеют.
 */
export class NotificationExtensionAdapter implements INotificationSink {
    /** id внутри сервиса по handle показа — живут только незакрытые сообщения. */
    private readonly openMessages = new Map<number, number>();

    public constructor(private readonly notifications: NotificationService) {}

    public async showMessage(request: INotificationRequest): Promise<number | undefined> {
        const handle = this.notifications.show({
            severity: request.severity,
            message: request.message,
            detail: request.detail,
            modal: request.modal,
            items: request.items.map((item) => item.title),
            closeAffordance: findCloseAffordance(request.items),
        });
        this.openMessages.set(request.handle, handle.id);
        // Без try/finally: `answered` только резолвится — сервис его не отклоняет,
        // так что «забыть показ» достаточно сделать здесь, после ответа.
        const answer = await handle.answered;
        this.openMessages.delete(request.handle);
        return answer;
    }

    public cancel(handle: number): void {
        const id = this.openMessages.get(handle);
        // Stryker disable next-line ConditionalExpression: без гарда `dismiss(undefined)` не найдёт показа и тоже ничего не сделает — ветки неотличимы; гард стоит ради типа
        if (id === undefined) return;
        // Stryker disable next-line CallExpression: та же гигиена карты, что в showMessage
        this.openMessages.delete(handle);
        this.notifications.dismiss(id);
    }
}

/**
 * Индекс кнопки, которую вернуть при закрытии модального окна по Escape
 * (`MessageItem.isCloseAffordance`). Первая помеченная — как в эталоне;
 * `undefined` — расширение не помечало ни одной.
 */
export function findCloseAffordance(items: readonly IWireMessageItem[]): number | undefined {
    const index = items.findIndex((item) => item.isCloseAffordance);
    return index < 0 ? undefined : index;
}
