import { Disposable } from "../../base/common/lifecycle.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { UndoRedoService } from "../../platform/undoRedo/common/undoRedoService.ts";
import { UndoRedoServiceDIToken } from "../../platform/undoRedo/common/undoRedoService.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";
import type { NotificationService } from "../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

export const UndoRefusalNotificationContributionDIToken =
    // Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
    token<UndoRefusalNotificationContribution>("UndoRefusalNotificationContribution");

/**
 * Говорит человеку, почему Ctrl+Z не откатил шаг нескольких документов
 * ({@link UndoRedoService.onDidRefuse}): «Could not undo '…' across all files
 * because changes were made to b.ts». Эталон шлёт то же предупреждение из
 * самого сервиса отмены; у нас сервис платформенный и о сообщениях не знает —
 * проводка та же, что у `OpenFailureNotificationContribution`.
 *
 * Молчать нельзя: отказ выглядел бы как сломанная клавиша.
 */
export class UndoRefusalNotificationContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [UndoRedoServiceDIToken, NotificationServiceDIToken] as const;

    public constructor(undoRedo: UndoRedoService, notifications: NotificationService) {
        super();
        this.register(
            undoRedo.onDidRefuse(({ message }) => {
                notifications.show({ severity: "warn", message, modal: false, items: [] });
            }),
        );
    }
}
