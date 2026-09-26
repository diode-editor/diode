import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { Component } from "../../component.ts";

import { FOCUS_NOTIFICATION_TOASTS_COMMAND_ID } from "./notificationCommandIds.ts";
import { NotificationsToastsElement } from "./notificationsToastsElement.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, зависимости резолвятся по ссылке — строка внутри остаётся отладочной меткой
export const NotificationsToastsComponentDIToken = token<NotificationsToastsComponent>("NotificationsToastsComponent");

/** Отступ стека от правого и нижнего края экрана (статус-бар — отдельная строка). */
const SCREEN_MARGIN = 1;
/** Границы ширины тоста: узкий терминал отдаёт всё, что есть. */
const MAX_TOAST_WIDTH = 52;
const MIN_TOAST_WIDTH = 24;

/**
 * Тосты сообщений в правом нижнем углу (VS Code показывает их там же):
 * компонент подписан на {@link NotificationService} и держит одну
 * overlay-сессию на весь стек.
 *
 * Сессия — **passthrough и без фокуса**: сообщение не должно вырывать
 * клавиатуру у редактора, даже когда у него есть кнопки. Дойти до кнопок можно
 * командой `notifications.focusToasts` (её аккорд компонент показывает в самом
 * тосте — иначе кнопки были бы недостижимы для того, кто про команду не знает)
 * или мышью. Escape по сфокусированному стеку закрывает сообщения — как
 * `notifications.hideToasts` в VS Code.
 *
 * Overlay-хост приходит через late-init шов {@link attachHost}, как у
 * QuickInput/Suggest/Hover/TabSwitcher.
 */
export class NotificationsToastsComponent extends Component {
    public static dependencies = [NotificationServiceDIToken, KeybindingRegistryDIToken] as const;

    public readonly view: NotificationsToastsElement;

    private host: BodyElement | null = null;
    private session: OverlaySessionHandle | null = null;

    public constructor(
        private readonly notificationService: NotificationService,
        private readonly keybindings: KeybindingRegistry,
    ) {
        super();
        this.view = new NotificationsToastsElement();
        this.view.id = "notificationToasts";
        this.view.onActivate = (id, index) => {
            this.notificationService.accept(id, index);
        };
        this.view.onHideAll = () => {
            this.notificationService.clearAll();
        };
        this.register(
            this.notificationService.onDidChangeNotifications(() => {
                this.sync();
            }),
        );
        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    /** Вызывается владельцем корневой view (WorkbenchComponent) до первого показа. */
    public attachHost(host: BodyElement): void {
        this.host = host;
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            // Фокус не забираем и не возвращаем: сообщение появляется, пока
            // человек печатает, и увести у него каретку недопустимо.
            restoreFocus: true,
            focusOnOpen: false,
            // Escape ведёт сам стек (он же и решает, что закрывать): дай его
            // слою — и сессия закрылась бы, не дорешав обещания сообщений.
            // Stryker disable next-line BooleanLiteral: оба значения дают один наблюдаемый результат — стек гасит Escape своим stopPropagation, и до слоя клавиша не доходит
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: клавиатуру гасит явный capturesKeyboard ниже, а по мыши "" ведёт себя как passthrough (не modal и не close-on-outside) — наблюдаемой разницы нет
            pointerPolicy: "passthrough",
            capturesKeyboard: false,
        });
        // Сообщения могли появиться до постройки view (расширение активировалось
        // раньше первого кадра) — показываем то, что уже накопилось.
        this.sync();
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    /** Приводит оверлей к текущему состоянию сервиса: набор, размер, позиция. */
    private sync(): void {
        const notifications = this.notificationService.notifications();
        if (notifications.length === 0) {
            // Stryker disable next-line ConditionalExpression,OptionalChaining: закрыть уже закрытую (или ещё не созданную) сессию — no-op слоя, так что проверка наблюдаемого следа не оставляет; она здесь ради ясности намерения
            if (this.session?.isOpen() === true) this.session.close();
            return;
        }
        if (this.host === null) return;
        const screenW = this.host.layoutSize.width;
        const screenH = this.host.layoutSize.height;
        this.view.preferredWidth = Math.min(MAX_TOAST_WIDTH, Math.max(MIN_TOAST_WIDTH, screenW - SCREEN_MARGIN * 2));
        this.view.setNotifications(notifications, this.focusHint());
        const width = this.view.preferredWidth;
        const height = this.view.totalHeight;
        const px = Math.max(0, screenW - width - SCREEN_MARGIN);
        const py = Math.max(0, screenH - height - SCREEN_MARGIN);
        // Stryker disable next-line OptionalChaining: session и host ставятся вместе в attachHost, а сюда путь идёт только через гард `host === null` выше — ветка undefined недостижима
        this.session?.setPosition(new Point(px, py));
        // Stryker disable next-line OptionalChaining: та же причина
        this.session?.open();
    }

    /**
     * Подсказка «чем добраться до кнопок». `null`, когда у команды нет аккорда
     * (пользователь снял бинд): выдумывать текст без клавиши нельзя — он бы врал.
     */
    private focusHint(): string | null {
        const chord = this.keybindings.getKeybindingForCommand(FOCUS_NOTIFICATION_TOASTS_COMMAND_ID);
        if (chord === undefined) return null;
        return `${formatKeybinding(chord)} to answer`;
    }

    /** Уводит фокус в стек — команда `notifications.focusToasts`. */
    public focusToasts(): void {
        if (!this.isOpen()) return;
        this.view.focusToasts();
    }
}
