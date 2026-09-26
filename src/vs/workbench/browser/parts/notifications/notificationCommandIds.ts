/**
 * Id команд тостов — отдельным модулем: их знают и действия
 * (`browser/actions/notificationActions.ts`), и компонент (он показывает аккорд
 * фокусировки в самом тосте). Импорт действий компонентом завёл бы цикл.
 *
 * Имена — как в VS Code: `notifications.focusToasts`, `notifications.clearAll`.
 */
export const FOCUS_NOTIFICATION_TOASTS_COMMAND_ID = "notifications.focusToasts";
export const CLEAR_NOTIFICATIONS_COMMAND_ID = "notifications.clearAll";
