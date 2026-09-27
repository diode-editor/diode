import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { VFlexElement, vflexFit } from "@tuidom/elements/layout/vFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IActiveNotification } from "../../../services/notification/browser/notificationService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import { Component } from "../../component.ts";

import { MessageDialog } from "./messageDialog.ts";
import { NotificationToast, TOAST_TEXT_WIDTH } from "./notificationToast.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const NotificationsComponentDIToken = token<NotificationsComponent>("NotificationsComponent");

/**
 * Команда «увести фокус на кнопки сообщения». Объявлена здесь, а не в файле
 * экшена: подсказку с её биндом рисует тост, а обратный импорт (parts → actions)
 * замкнул бы кольцо — экшен сам зависит от компонента.
 */
export const FOCUS_MESSAGE_COMMAND_ID = "notifications.focusMessage";

/** Полная ширина тоста: текст плюс рамка (2) и отступы контента (2×2). */
export const TOAST_WIDTH = TOAST_TEXT_WIDTH + 6;

/** Сколько пассивных тостов видно одновременно; остальные — счётчиком. */
export const MAX_VISIBLE_TOASTS = 3;

/** Отступ стека от правого края экрана. */
const RIGHT_MARGIN = 1;

/** Высота статус-бара: слот BodyElement занимает РОВНО один ряд (контракт движка). */
const STATUS_BAR_ROWS = 1;

/**
 * Поверхность сообщений: стек тостов в правом нижнем углу над статус-баром плюс
 * окно модального сообщения по центру. Компонент чисто реактивный — жизнью
 * показов управляет {@link NotificationService}, а здесь только отражается его
 * состояние на overlay-слой корневой view (хост приходит через {@link
 * attachHost}, как у QuickInput/Suggest/TabSwitcher).
 *
 * Сессий две, и это не оптимизация, а разница в поведении:
 *
 * - **пассивный стек** — сообщения без кнопок: passthrough, фокуса не забирает,
 *   глобальные бинды не гасит (человек продолжает печатать сквозь тост);
 * - **вопрос** — сообщение с кнопками: тоже passthrough и тоже без кражи фокуса
 *   (как в эталоне — сообщение приходит незвано). До кнопок ведёт клик мышью или
 *   команда `Notifications: Focus Message` (F6), и об этом прямо сказано в рамке
 *   тоста; на закрытии фокус возвращается туда, где был. Модальное сообщение —
 *   исключение: оно держит и фокус, и экран, для того и модальное.
 */
export class NotificationsComponent extends Component {
    public static dependencies = [
        NotificationServiceDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    /** Корень пассивного стека — фиксированная ширина под loose-constraints слоя. */
    public readonly view: SizedBoxElement;

    private host: BodyElement | null = null;
    private passiveSession: OverlaySessionHandle | null = null;
    private readonly stack = new VFlexElement();
    /** Пассивные тосты текущего кадра — пересобираются целиком (состояния у них нет). */
    private passiveToasts: NotificationToast[] = [];

    private askSession: OverlaySessionHandle | null = null;
    private askWidget: NotificationToast | MessageDialog | null = null;
    /**
     * Элемент, который держит сессия вопроса: у тоста это обёртка фиксированной
     * ширины (иначе он был бы уже пассивных — те живут внутри такой же обёртки, и
     * правые края стека разъехались бы), у модального окна — само окно.
     */
    private askElement: TUIElement | null = null;
    /** id показанного вопроса — по нему видно, что вопрос сменился. */
    private askId: number | null = null;

    public constructor(
        private readonly notifications: NotificationService,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        this.view = new SizedBoxElement(TOAST_WIDTH);
        this.view.id = "notificationToasts";
        this.view.setChild(this.stack);
        this.register(
            this.notifications.onDidChange(() => {
                this.sync();
            }),
        );
        this.register({
            dispose: () => {
                this.closeAsk();
                this.disposePassive();
                this.passiveSession?.dispose();
                this.passiveSession = null;
            },
        });
    }

    /** Вызывается владельцем корневой view (WorkbenchComponent) до первого показа. */
    public attachHost(host: BodyElement): void {
        this.host = host;
        this.passiveSession = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            // Пассивный индикатор: фокус остаётся там, где был, клики проходят
            // насквозь, глобальные бинды живут.
            // Stryker disable next-line BooleanLiteral: стек не focusable — фокус не двигается ни при open, ни при close; флаг фиксирует намерение и наблюдаемого эффекта в тестах не имеет
            restoreFocus: false,
            // Stryker disable next-line BooleanLiteral: та же причина — focusOnOpen некому отдать фокус
            focusOnOpen: false,
            // Escape на пассивный стек не действует: гасит его таймер или
            // команда «Clear All», а Escape нужен тому, кто в фокусе.
            // Stryker disable next-line BooleanLiteral: ветки неотличимы — фокуса в стеке нет, и до closeOnEscape слоя Escape не доходит
            closeOnEscape: false,
            pointerPolicy: "passthrough",
            capturesKeyboard: false,
        });
        this.sync();
    }

    /**
     * Возвращает фокус на кнопки живого вопроса — для команды палитры, когда
     * фокус ушёл в редактор, а сообщение так и висит неотвеченным.
     */
    public focusAsk(): boolean {
        if (this.askWidget === null) return false;
        this.askWidget.focusDefault();
        return true;
    }

    /** Открыт ли сейчас вопрос (для тестов/оркестрации). */
    public getOpenAsk(): NotificationToast | MessageDialog | null {
        return (this.askSession?.isOpen() ?? false) ? this.askWidget : null;
    }

    /** Приводит оверлеи в соответствие состоянию сервиса. */
    private sync(): void {
        if (this.host === null) return;
        this.syncAsk();
        this.syncPassive();
        this.updatePositions();
    }

    /** Пересобирает пассивный стек: видимый хвост плюс счётчик скрытых. */
    private syncPassive(): void {
        const all = this.notifications.passive();
        this.disposePassive();
        if (all.length === 0) {
            if (this.passiveSession?.isOpen() === true) this.passiveSession.close();
            return;
        }
        // Показываем НОВЫЕ: скрывать свежее сообщение ради старого бессмысленно.
        const visible = all.slice(Math.max(0, all.length - MAX_VISIBLE_TOASTS));
        const hidden = all.length - visible.length;
        const children: (NotificationToast | TextLabelElement)[] = [];
        if (hidden > 0) children.push(makeOverflowLabel(hidden));
        for (const notification of visible) children.push(this.makeToast(notification));

        this.passiveToasts = children.filter((child): child is NotificationToast => child instanceof NotificationToast);
        this.stack.replaceChildren([]);
        for (const child of children) {
            const element = child instanceof NotificationToast ? child.view : child;
            this.stack.addChild(element, { height: vflexFit(), width: "fill" });
        }
        this.passiveSession?.open();
    }

    /** Открывает/закрывает вопрос по состоянию сервиса. */
    private syncAsk(): void {
        const current = this.notifications.current();
        if (current?.id === this.askId) return;
        this.closeAsk();
        if (current === null) return;
        this.askId = current.id;
        this.askWidget = current.modal ? new MessageDialog(current) : this.makeToast(current);
        this.askElement = current.modal ? this.askWidget.view : fixedWidth(this.askWidget.view);
        this.askWidget.onSelect = (index) => {
            this.notifications.answer(current.id, index);
        };
        this.askWidget.onClose = () => {
            this.notifications.dismiss(current.id);
        };
        this.askSession = this.requireHost().overlayLayer.createSession(this.askElement, new Point(0, 0), {
            visible: false,
            // Фокус возвращаем на закрытии — но только если он вообще уходил в
            // тост (по F6 или клику); сам показ его не забирает.
            restoreFocus: true,
            // Тост-вопрос фокуса НЕ берёт (как в эталоне): сообщение приходит
            // незвано, и перехватывать набор текста ему нельзя. До кнопок ведёт
            // команда `Notifications: Focus Message` (F6) либо клик мышью.
            // Модальное сообщение — наоборот: оно для того и модальное.
            focusOnOpen: current.modal,
            // Escape разбирает сам виджет (база DialogComponent) — он знает про
            // `isCloseAffordance`. Сессии этот путь отдавать нельзя: она закрыла
            // бы оверлей, не ответив тому, кто сообщение поднял.
            closeOnEscape: false,
            // Модальное сообщение держит экран; тост-вопрос — нет: клик мимо него
            // уходит туда, куда человек ткнул.
            pointerPolicy: current.modal ? "modal" : "passthrough",
            capturesKeyboard: current.modal,
        });
    }

    /** Ставит оба оверлея на места: вопрос-тост снизу, пассивный стек над ним. */
    private updatePositions(): void {
        const host = this.requireHost();
        const screenW = host.layoutSize.width;
        const screenH = host.layoutSize.height;
        const bottom = screenH - STATUS_BAR_ROWS;
        const right = Math.max(0, screenW - RIGHT_MARGIN - TOAST_WIDTH);

        let askRows = 0;
        const widget = this.askWidget;
        if (widget !== null) {
            const wasOpen = this.askSession?.isOpen() ?? false;
            if (widget instanceof MessageDialog) {
                this.openCentered(widget);
                // Фокус ставим только при ПЕРВОМ открытии окна: пересчёт позиций
                // случается и когда погас пассивный тост, а двигать фокус по
                // такому поводу нельзя. Тост-вопрос фокус не берёт вовсе.
                if (!wasOpen) widget.focusDefault();
            } else {
                askRows = this.askElement?.getMaxIntrinsicHeight(TOAST_WIDTH) ?? 0;
                this.askSession?.setPosition(new Point(right, clampRow(bottom - askRows, screenH)));
                this.askSession?.open();
            }
        }

        if (this.passiveSession?.isOpen() === true) {
            const passiveRows = this.view.getMaxIntrinsicHeight(TOAST_WIDTH);
            this.passiveSession.setPosition(new Point(right, clampRow(bottom - askRows - passiveRows, screenH)));
        }
    }

    /** Модальное окно — по центру экрана (как у DialogService). */
    private openCentered(widget: MessageDialog): void {
        const host = this.requireHost();
        const width = widget.view.getMaxIntrinsicWidth(0);
        const height = widget.view.getMaxIntrinsicHeight(width);
        const px = Math.max(0, Math.floor((host.layoutSize.width - width) / 2));
        const py = Math.max(0, Math.floor((host.layoutSize.height - height) / 2));
        this.askSession?.setPosition(new Point(px, py));
        this.askSession?.open();
    }

    private closeAsk(): void {
        this.askSession?.close();
        this.askSession?.dispose();
        this.askSession = null;
        this.askWidget?.dispose();
        this.askWidget = null;
        this.askElement = null;
        this.askId = null;
    }

    private disposePassive(): void {
        for (const toast of this.passiveToasts) toast.dispose();
        this.passiveToasts = [];
    }

    /**
     * Тост с подписью ДЕЙСТВУЮЩЕГО бинда «ответить» в подсказке: комбинацию
     * человек вправе переназначить, а без неё до кнопок не добраться.
     */
    private makeToast(notification: IActiveNotification): NotificationToast {
        const chord = this.keybindings.getKeybindingForCommand(FOCUS_MESSAGE_COMMAND_ID, this.contextKeys);
        const label = chord === undefined ? undefined : formatKeybinding(chord, keybindingLabelStyle(this.contextKeys));
        return new NotificationToast(notification, label);
    }

    private requireHost(): BodyElement {
        if (this.host === null) {
            throw new Error("NotificationsComponent: host is not attached (attachHost must be called first)");
        }
        return this.host;
    }
}

/** Обёртка тоста в общую ширину стека — чтобы правые края не разъезжались. */
function fixedWidth(element: TUIElement): SizedBoxElement {
    const holder = new SizedBoxElement(TOAST_WIDTH);
    holder.setChild(element);
    return holder;
}

/** Строка «ещё N» над стеком, когда сообщений больше, чем мест. */
function makeOverflowLabel(hidden: number): TextLabelElement {
    const label = new TextLabelElement(`+${String(hidden)} more`);
    label.style = { fg: "descriptionForeground" };
    return label;
}

/** Ряд в пределах экрана и ниже строки меню (она занимает ряд 0). */
function clampRow(row: number, screenH: number): number {
    return Math.min(Math.max(1, row), Math.max(1, screenH - 1));
}
