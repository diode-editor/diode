import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { NotificationServiceDIToken } from "../../services/notification/browser/notificationService.ts";
import {
    FOCUS_MESSAGE_COMMAND_ID,
    NotificationsComponentDIToken,
} from "../parts/notifications/notificationsComponent.ts";

/**
 * Убирает с экрана все сообщения. Живые вопросы при этом получают «закрыто без
 * выбора» — расширение, которое их задало, не остаётся висеть.
 */
export const clearNotificationsAction: CommandAction = {
    id: "notifications.clearAll",
    title: "Notifications: Clear All",
    run(accessor) {
        accessor.get(NotificationServiceDIToken).clearAll();
    },
};

/**
 * Ведёт фокус на кнопки сообщения. Это ЕДИНСТВЕННЫЙ клавиатурный путь к ответу:
 * тост фокуса не забирает (как в эталоне), поэтому без этой команды вопрос от
 * расширения остался бы без ответа у всех, кто работает без мыши. Бинд назван в
 * подсказке внутри самого тоста — иначе о нём никто не узнает.
 */
export const focusNotificationAction: CommandAction = {
    id: FOCUS_MESSAGE_COMMAND_ID,
    title: "Notifications: Focus Message",
    keybinding: parseKeybinding("f6"),
    run(accessor) {
        accessor.get(NotificationsComponentDIToken).focusAsk();
    },
};
