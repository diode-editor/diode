import type { INotificationSink } from "../../services/extensions/node/extensionHost.ts";
import type { NotificationService } from "../../services/notification/browser/notificationService.ts";
import type { NotificationSeverity } from "../../services/notification/common/notification.ts";
import type { IWireShowMessageRequest, WireMessageSeverity } from "../common/wireTypes.ts";

/**
 * Мост `window.show{Information,Warning,Error}Message` расширений к тостам
 * приложения (реализация {@link INotificationSink}): сообщение субпроцесса
 * становится записью {@link NotificationService}, а нажатая кнопка уезжает
 * обратно расширению индексом. Проводка — `extensionHostModule`.
 *
 * `clear()` приходит, когда субпроцесс умер: живые сообщения снимаются, их
 * обещания дорешиваются «человек закрыл». Сообщения НАШИХ сервисов при этом
 * тоже уходят — отдельного учёта «чьё сообщение» сервис не ведёт, а единственный
 * их автор (открыватель ссылок) не переживает смерть того, кто его позвал.
 */
export class NotificationExtensionAdapter implements INotificationSink {
    public constructor(private readonly notificationService: NotificationService) {}

    public show(request: IWireShowMessageRequest): Promise<number | undefined> {
        return this.notificationService.notify({
            severity: toSeverity(request.severity),
            message: request.message,
            items: request.items,
        });
    }

    public clear(): void {
        this.notificationService.clearAll();
    }
}

/** Строгость с провода → строгость модели (`warn` там, `warning` здесь). */
function toSeverity(severity: WireMessageSeverity): NotificationSeverity {
    if (severity === "error") return "error";
    if (severity === "warn") return "warning";
    return "info";
}
