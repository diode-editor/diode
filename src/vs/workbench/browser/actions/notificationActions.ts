import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { NotificationServiceDIToken } from "../../services/notification/browser/notificationService.ts";
import {
    FOCUS_MESSAGE_COMMAND_ID,
    NotificationsComponentDIToken,
} from "../parts/notifications/notificationsComponent.ts";

/** Live questions get "closed without a choice", so the extension is not left hanging. */
export const clearNotificationsAction: CommandAction = {
    id: "notifications.clearAll",
    title: "Notifications: Clear All",
    run(accessor) {
        accessor.get(NotificationServiceDIToken).clearAll();
    },
};

/**
 * The ONLY keyboard path to an answer: a toast does not take focus (as
 * upstream). The binding is named in a hint inside the toast — otherwise nobody would know about it.
 */
export const focusNotificationAction: CommandAction = {
    id: FOCUS_MESSAGE_COMMAND_ID,
    title: "Notifications: Focus Message",
    keybinding: parseKeybinding("f6"),
    run(accessor) {
        accessor.get(NotificationsComponentDIToken).focusAsk();
    },
};
