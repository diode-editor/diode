import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { NotificationServiceDIToken } from "../../services/notification/browser/notificationService.ts";
import {
    FOCUS_MESSAGE_COMMAND_ID,
    NotificationsComponentDIToken,
} from "../parts/notifications/notificationsComponent.ts";

/** Живые вопросы получают «закрыто без выбора» — расширение не остаётся висеть. */
export const clearNotificationsAction: CommandAction = {
    id: "notifications.clearAll",
    title: "Notifications: Clear All",
    run(accessor) {
        accessor.get(NotificationServiceDIToken).clearAll();
    },
};

/**
 * ЕДИНСТВЕННЫЙ клавиатурный путь к ответу: тост фокуса не забирает (как в
 * эталоне). Бинд назван в подсказке внутри тоста — иначе о нём никто не узнает.
 */
export const focusNotificationAction: CommandAction = {
    id: FOCUS_MESSAGE_COMMAND_ID,
    title: "Notifications: Focus Message",
    keybinding: parseKeybinding("f6"),
    run(accessor) {
        accessor.get(NotificationsComponentDIToken).focusAsk();
    },
};
