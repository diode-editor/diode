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

/** Отступ стека от правого края экрана. */
const RIGHT_MARGIN = 1;

/** Высота статус-бара: слот BodyElement занимает РОВНО один ряд (контракт движка). */
const STATUS_BAR_ROWS = 1;

/** Открытый вопрос: его виджет, элемент сессии и сама сессия. */
interface IOpenAsk {
    /** id показа в сервисе — по нему видно, что вопрос сменился. */
    readonly id: number;
    readonly widget: NotificationToast | MessageDialog;
    /**
     * Элемент, который держит сессия: у тоста это обёртка фиксированной ширины
     * (иначе он был бы уже пассивных — те живут внутри такой же обёртки, и правые
     * края стека разъехались бы), у модального окна — само окно.
     */
    readonly element: TUIElement;
    readonly session: OverlaySessionHandle;
}

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

    /**
     * Живой показ вопроса ЦЕЛИКОМ, одним полем: виджет, элемент сессии и её
     * ручка появляются и исчезают вместе, и хранить их отдельными nullable-полями
     * значило бы защищаться `?.` от состояний, которых не бывает.
     */
    private ask: IOpenAsk | null = null;

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
                this.stack.replaceChildren([]);
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
        const ask = this.ask;
        if (ask === null) return false;
        ask.widget.focusDefault();
        return true;
    }

    /** Открыт ли сейчас вопрос (для тестов/оркестрации). */
    public getOpenAsk(): NotificationToast | MessageDialog | null {
        const ask = this.ask;
        if (ask === null) return null;
        return ask.session.isOpen() ? ask.widget : null;
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
        const session = this.requirePassiveSession();
        const all = this.notifications.passive();
        this.disposePassive();
        // Детей снимаем ВМЕСТЕ с их dispose: оставить в дереве освобождённые
        // виджеты — значит однажды отрисовать их.
        this.stack.replaceChildren([]);
        if (all.length === 0) {
            if (session.isOpen()) session.close();
            return;
        }
        // Сколько ждёт места — счётчиком над стеком. Это не «спрятано насовсем»:
        // очередь сама доедет до экрана, когда впереди стоящий тост уйдёт.
        const queued = this.notifications.queuedPassiveCount();
        if (queued > 0) {
            this.stack.addChild(makeQueueLabel(queued), { height: vflexFit(), width: "fill" });
        }
        this.passiveToasts = all.map((notification) => this.makeToast(notification));
        for (const toast of this.passiveToasts) {
            this.stack.addChild(toast.view, { height: vflexFit(), width: "fill" });
        }
        session.open();
    }

    /** Открывает/закрывает вопрос по состоянию сервиса. */
    private syncAsk(): void {
        const current = this.notifications.current();
        if (current !== null && current.id === this.ask?.id) return;
        this.closeAsk();
        if (current === null) return;
        const widget = current.modal ? new MessageDialog(current) : this.makeToast(current);
        const element = current.modal ? widget.view : fixedWidth(widget.view);
        widget.onSelect = (index) => {
            this.notifications.answer(current.id, index);
        };
        widget.onClose = () => {
            this.notifications.dismiss(current.id);
        };
        const session = this.requireHost().overlayLayer.createSession(element, new Point(0, 0), {
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
        this.ask = { id: current.id, widget, element, session };
    }

    /** Ставит оба оверлея на места: вопрос-тост снизу, пассивный стек над ним. */
    private updatePositions(): void {
        const host = this.requireHost();
        const screenW = host.layoutSize.width;
        const screenH = host.layoutSize.height;
        const bottom = screenH - STATUS_BAR_ROWS;
        const right = Math.max(0, screenW - RIGHT_MARGIN - TOAST_WIDTH);

        let askRows = 0;
        const ask = this.ask;
        if (ask !== null) {
            const wasOpen = ask.session.isOpen();
            if (ask.widget instanceof MessageDialog) {
                this.openCentered(ask);
                // Фокус ставим только при ПЕРВОМ открытии окна: пересчёт позиций
                // случается и когда погас пассивный тост, а двигать фокус по
                // такому поводу нельзя. Тост-вопрос фокус не берёт вовсе.
                if (!wasOpen) ask.widget.focusDefault();
            } else {
                askRows = ask.element.getMaxIntrinsicHeight(TOAST_WIDTH);
                ask.session.setPosition(new Point(right, clampRow(bottom - askRows, screenH)));
                ask.session.open();
            }
        }

        const passive = this.requirePassiveSession();
        if (passive.isOpen()) {
            const passiveRows = this.view.getMaxIntrinsicHeight(TOAST_WIDTH);
            passive.setPosition(new Point(right, clampRow(bottom - askRows - passiveRows, screenH)));
        }
    }

    /** Модальное окно — по центру экрана (как у DialogService). */
    private openCentered(ask: IOpenAsk): void {
        const host = this.requireHost();
        const width = ask.element.getMaxIntrinsicWidth(0);
        const height = ask.element.getMaxIntrinsicHeight(width);
        const px = Math.max(0, Math.floor((host.layoutSize.width - width) / 2));
        const py = Math.max(0, Math.floor((host.layoutSize.height - height) / 2));
        ask.session.setPosition(new Point(px, py));
        ask.session.open();
    }

    private closeAsk(): void {
        const ask = this.ask;
        if (ask === null) return;
        this.ask = null;
        ask.session.close();
        ask.session.dispose();
        ask.widget.dispose();
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
        const toast = new NotificationToast(notification, label);
        // Кнопка закрытия работает у любого тоста, включая пассивный: у него нет
        // другого способа уйти с экрана раньше таймаута.
        toast.onClose = () => {
            this.notifications.dismiss(notification.id);
        };
        return toast;
    }

    /**
     * Сессия пассивного стека. Она создаётся вместе с хостом, а до `attachHost`
     * сюда не приходят вовсе: единственный вход — {@link sync}, а он первым делом
     * проверяет хост.
     */
    private requirePassiveSession(): OverlaySessionHandle {
        if (this.passiveSession === null) {
            throw new Error("NotificationsComponent: passive session is missing (attachHost must be called first)");
        }
        return this.passiveSession;
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

/** Строка «ещё N ждут места» над стеком. */
function makeQueueLabel(queued: number): TextLabelElement {
    const label = new TextLabelElement(`+${String(queued)} more`);
    label.style = { fg: "descriptionForeground" };
    return label;
}

/**
 * Ряд в пределах экрана и ниже строки меню (она занимает ряд 0): на низком
 * экране высокий тост иначе уехал бы за кадр или накрыл меню.
 */
export function clampRow(row: number, screenH: number): number {
    return Math.min(Math.max(1, row), Math.max(1, screenH - 1));
}
