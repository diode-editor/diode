import { Disposable } from "../../base/common/lifecycle.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import type { NotificationService } from "../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

export const OpenFailureNotificationContributionDIToken =
    // Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
    token<OpenFailureNotificationContribution>("OpenFailureNotificationContribution");

/**
 * Молчать нельзя: открытие промахивается на недисковых ресурсах (`jdt:`,
 * `git:`), когда расширение схемы не установлено или не активировалось, — без
 * сообщения Go to Definition в библиотеку выглядит как сломанная клавиша.
 */
export class OpenFailureNotificationContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [EditorServiceDIToken, NotificationServiceDIToken] as const;

    public constructor(editors: IEditorService, notifications: NotificationService) {
        super();
        this.register(
            editors.onDidFailOpen(({ uri, reason }) => {
                notifications.show({
                    severity: "error",
                    message: `Unable to open '${uri.toString()}': ${reason}`,
                    modal: false,
                    items: [],
                });
            }),
        );
    }
}
