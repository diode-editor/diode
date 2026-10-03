import { Disposable } from "../../base/common/lifecycle.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";
import type { NotificationService } from "../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

export const OpenFailureNotificationContributionDIToken =
    // Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
    token<OpenFailureNotificationContribution>("OpenFailureNotificationContribution");

/**
 * Показывает человеку, почему ресурс не открылся. Единственный потребитель
 * {@link EditorService.onOpenFailed}.
 *
 * Отдельная проводка, а не зависимость сервиса редакторов от сообщений: открыть
 * ресурс `EditorService` обязан, а решать, как об этом рассказать, — нет
 * (ровно так же у него разведены `canAddGroupHook` и остальные хуки).
 *
 * Молчать здесь нельзя. Промахивается открытие на недисковых ресурсах — `jdt:`
 * у Java, `git:`-ревизия, — и типовая причина «расширение, поставляющее схему,
 * не установлено или ещё не активировалось». Без сообщения Go to Definition в
 * библиотеку выглядит как сломанная клавиша: ни вкладки, ни ошибки, ни следа.
 */
export class OpenFailureNotificationContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [EditorServiceDIToken, NotificationServiceDIToken] as const;

    public constructor(editors: EditorService, notifications: NotificationService) {
        super();
        editors.onOpenFailed = (uri, reason) => {
            // Тост без кнопок: выбирать человеку нечего, а уезжает он сам.
            notifications.show({
                severity: "error",
                message: `Unable to open '${uri.toString()}': ${reason}`,
                modal: false,
                items: [],
            });
        };
        this.register({
            dispose: () => {
                editors.onOpenFailed = undefined;
            },
        });
    }
}
