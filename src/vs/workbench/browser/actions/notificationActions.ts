import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseChord } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { NotificationServiceDIToken } from "../../services/notification/browser/notificationService.ts";
import {
    CLEAR_NOTIFICATIONS_COMMAND_ID,
    FOCUS_NOTIFICATION_TOASTS_COMMAND_ID,
} from "../parts/notifications/notificationCommandIds.ts";
import { NotificationsToastsComponentDIToken } from "../parts/notifications/notificationsToastsComponent.ts";

/**
 * Единственная дверь с клавиатуры к кнопкам сообщения: тосты — passthrough-оверлей
 * и фокус сами не забирают (иначе сообщение вырывало бы каретку из редактора у
 * печатающего человека). Гейт `notificationToastsVisible` — чтобы аккорд не
 * съедал клавиши, когда показывать нечего; сам аккорд компонент печатает в
 * тосте, иначе про команду было бы неоткуда узнать.
 */
export const focusNotificationToastsAction: CommandAction = {
    id: FOCUS_NOTIFICATION_TOASTS_COMMAND_ID,
    title: "Notifications: Focus Notification Toast",
    when: "notificationToastsVisible",
    keybinding: parseChord("ctrl+k ctrl+n"),
    run(accessor) {
        accessor.get(NotificationsToastsComponentDIToken).focusToasts();
    },
};

/**
 * Закрыть все сообщения. Без аккорда (как и в VS Code): Escape по
 * сфокусированному стеку делает то же самое, а команда нужна палитре — и тому,
 * кто хочет свой бинд.
 */
export const clearNotificationsAction: CommandAction = {
    id: CLEAR_NOTIFICATIONS_COMMAND_ID,
    title: "Notifications: Clear All Notifications",
    run(accessor) {
        accessor.get(NotificationServiceDIToken).clearAll();
    },
};

export const NOTIFICATION_ACTIONS: readonly CommandAction[] = [focusNotificationToastsAction, clearNotificationsAction];
