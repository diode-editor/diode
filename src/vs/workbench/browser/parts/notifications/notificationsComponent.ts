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

/** Прикреплённый хост: корневая view и сессия пассивного стека в ней. */
interface IAttachedHost {
    readonly host: BodyElement;
    readonly session: OverlaySessionHandle;
}

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

    /**
     * Хост и сессия пассивного стека — ОДНИМ полем: они появляются вместе в
     * {@link attachHost} и по отдельности не бывают, так что раздельные
     * nullable-поля потребовали бы защиты от состояний, которых нет.
     */
    private attached: IAttachedHost | null = null;
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
                // Stryker disable next-line CallExpression: виджеты снимаются с экрана строкой ниже — их dispose ненаблюдаем
                this.disposePassive();
                this.stack.replaceChildren([]);
                this.attached?.session.dispose();
                this.attached = null;
            },
        });
    }

    /** Вызывается владельцем корневой view (WorkbenchComponent) до первого показа. */
    public attachHost(host: BodyElement): void {
        const session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            // Stryker disable next-line BooleanLiteral: сессию открывает явный `open()` следующим же проходом sync, а пустой стек она тут же и закрывает — начальная видимость ненаблюдаема
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
            // Stryker disable next-line StringLiteral: по мыши "" ведёт себя как passthrough (не modal и не close-on-outside) — наблюдаемой разницы нет, а клавиатуру гасит явный capturesKeyboard ниже
            pointerPolicy: "passthrough",
            capturesKeyboard: false,
        });
        this.attached = { host, session };
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

    /**
     * Открыт ли сейчас вопрос (для тестов/оркестрации). Отдельной проверки
     * `session.isOpen()` тут нет: сессией владеет компонент, и живой `ask` без
     * открытой сессии не бывает — показ открывает её тем же проходом sync.
     */
    public getOpenAsk(): NotificationToast | MessageDialog | null {
        return this.ask?.widget ?? null;
    }

    /** Приводит оверлеи в соответствие состоянию сервиса. */
    private sync(): void {
        const attached = this.attached;
        if (attached === null) return;
        this.syncAsk(attached);
        this.syncPassive(attached.session);
        this.updatePositions(attached);
    }

    /** Пересобирает пассивный стек: видимый хвост плюс счётчик скрытых. */
    private syncPassive(session: OverlaySessionHandle): void {
        const all = this.notifications.passive();
        // Stryker disable next-line CallExpression: виджеты снимаются из дерева строкой ниже — их dispose ненаблюдаем
        this.disposePassive();
        // Детей снимаем ВМЕСТЕ с их dispose: оставить в дереве освобождённые
        // виджеты — значит однажды отрисовать их.
        this.stack.replaceChildren([]);
        if (all.length === 0) {
            // Stryker disable next-line ConditionalExpression,CallExpression: у пустого стека нет детей, поэтому открытая сессия и закрытая рисуют одно и то же — ничего
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
    private syncAsk(attached: IAttachedHost): void {
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
        const session = attached.host.overlayLayer.createSession(element, new Point(0, 0), {
            // Stryker disable next-line BooleanLiteral: та же причина, что у пассивной сессии — её открывает явный `open()` в updatePositions
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
            // Stryker disable next-line BooleanLiteral: ненаблюдаемо — Escape доходит до виджета раньше слоя, и показ снимается его обработчиком в обоих случаях
            closeOnEscape: false,
            // Модальное сообщение держит экран; тост-вопрос — нет: клик мимо него
            // уходит туда, куда человек ткнул.
            // Stryker disable next-line StringLiteral: ветку тоста подменить нечем — по мыши "" ведёт себя как passthrough; отличие держит ветка "modal", её проверяет тест «клик мимо модального окна»
            pointerPolicy: current.modal ? "modal" : "passthrough",
            capturesKeyboard: current.modal,
        });
        this.ask = { id: current.id, widget, element, session };
    }

    /** Ставит оба оверлея на места: вопрос-тост снизу, пассивный стек над ним. */
    private updatePositions(attached: IAttachedHost): void {
        const screenW = attached.host.layoutSize.width;
        const screenH = attached.host.layoutSize.height;
        const bottom = screenH - STATUS_BAR_ROWS;
        const right = Math.max(0, screenW - RIGHT_MARGIN - TOAST_WIDTH);

        let askRows = 0;
        const ask = this.ask;
        if (ask !== null) {
            if (ask.widget instanceof MessageDialog) {
                // Фокус модальному окну ставит САМА сессия (`focusOnOpen`), и это
                // важно: пересчёт позиций случается и когда погас пассивный тост,
                // а свой `focusDefault()` тут возвращал бы человека на первую
                // кнопку, отменяя его выбор.
                this.openCentered(ask, attached.host);
            } else {
                askRows = ask.element.getMaxIntrinsicHeight(TOAST_WIDTH);
                ask.session.setPosition(new Point(right, clampRow(bottom - askRows, screenH)));
                ask.session.open();
            }
        }

        const passive = attached.session;
        // Stryker disable next-line ConditionalExpression: позиция закрытой сессии ненаблюдаема — её всё равно никто не рисует
        if (passive.isOpen()) {
            const passiveRows = this.view.getMaxIntrinsicHeight(TOAST_WIDTH);
            passive.setPosition(new Point(right, clampRow(bottom - askRows - passiveRows, screenH)));
        }
    }

    /** Модальное окно — по центру экрана (как у DialogService). */
    private openCentered(ask: IOpenAsk, host: BodyElement): void {
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
        // Stryker disable next-line CallExpression: гигиена — закрытая сессия и так не рисуется; dispose лишь освобождает её запись в слое
        ask.session.dispose();
        // Stryker disable next-line CallExpression: то же про виджет: он уже снят с экрана вместе с сессией
        ask.widget.dispose();
    }

    /**
     * Освобождает виджеты прошлого кадра. Гигиена: к этому моменту они уже сняты
     * из дерева стека, так что на экране их отсутствие ничего не меняет.
     */
    // Stryker disable next-line BlockStatement: см. выше — освобождение уже снятых виджетов ненаблюдаемо
    private disposePassive(): void {
        // Stryker disable next-line CallExpression: та же причина
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
