/**
 * Модель сообщений пользователю (аналог `INotification` VS Code): то, что
 * показывается тостом в углу экрана и — если у сообщения есть кнопки — ждёт
 * ответа человека.
 *
 * Здесь только данные: кто их публикует (расширения через
 * `window.show*Message`, наши сервисы вроде открывателя ссылок) и кто рисует
 * ({@link import("../../../browser/parts/notifications/notificationsToastsComponent.ts").NotificationsToastsComponent})
 * — забота сервиса и компонента.
 */

/**
 * Строгость сообщения. `warning`, а не `warn` (как на проводе расширений): имена
 * совпадают с токенами темы (`notificationsWarningIcon.foreground`) и с
 * `vscode.window.showWarningMessage`.
 */
export type NotificationSeverity = "info" | "warning" | "error";

/** Просьба показать сообщение. */
export interface INotificationRequest {
    readonly severity: NotificationSeverity;
    readonly message: string;
    /**
     * Подписи кнопок в порядке показа. Пусто — сообщение без вопроса: его
     * обещание резолвится закрытием тоста.
     */
    readonly items?: readonly string[];
}

/** Живое сообщение в стеке тостов. */
export interface INotification {
    /** Идентификатор показа; монотонный в рамках процесса. */
    readonly id: number;
    readonly severity: NotificationSeverity;
    /** Текст как прислали: перенос по ширине делает компонент, не модель. */
    readonly message: string;
    readonly items: readonly string[];
}

/**
 * Заголовок рамки тоста. Словом, а не значком codicon-шрифта: в терминале
 * подпись читается без шрифта с иконками, ложится в поиск по кадру и не зависит
 * от того, чем терминал рисует PUA-символы.
 */
export function severityTitle(severity: NotificationSeverity): string {
    if (severity === "error") return "Error";
    if (severity === "warning") return "Warning";
    return "Information";
}

/** Токен темы для заголовка рамки — акцент строгости. */
export function severityColorId(severity: NotificationSeverity): string {
    if (severity === "error") return "notificationsErrorIcon.foreground";
    if (severity === "warning") return "notificationsWarningIcon.foreground";
    return "notificationsInfoIcon.foreground";
}
