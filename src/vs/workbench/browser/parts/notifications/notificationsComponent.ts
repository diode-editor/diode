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
 * Объявлена здесь, а не в файле экшена: подсказку с её биндом рисует тост, а
 * импорт parts → actions замкнул бы кольцо — экшен сам зависит от компонента.
 */
export const FOCUS_MESSAGE_COMMAND_ID = "notifications.focusMessage";

/** Рамка (2) и отступы контента (2×2). */
export const TOAST_WIDTH = TOAST_TEXT_WIDTH + 6;

const RIGHT_MARGIN = 1;

/** Слот BodyElement занимает РОВНО один ряд (контракт движка). */
const STATUS_BAR_ROWS = 1;

interface IAttachedHost {
    readonly host: BodyElement;
    readonly session: OverlaySessionHandle;
}

interface IOpenAsk {
    readonly id: number;
    readonly widget: NotificationToast | MessageDialog;
    /**
     * У тоста — обёртка фиксированной ширины: иначе он был бы уже пассивных (те
     * живут в такой же обёртке), и правые края стека разъехались бы.
     */
    readonly element: TUIElement;
    readonly session: OverlaySessionHandle;
}

/**
 * Жизнью показов управляет {@link NotificationService}, компонент только
 * отражает его состояние на overlay-слой. Сессий две — это разница в поведении:
 * пассивный стек (без кнопок) не гасит глобальные бинды — человек печатает
 * сквозь тост; вопрос (с кнопками) тоже фокус не крадёт (как в эталоне), до
 * кнопок ведёт клик или F6. Модальное сообщение держит и фокус, и экран.
 */
export class NotificationsComponent extends Component {
    public static dependencies = [
        NotificationServiceDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    public readonly view: SizedBoxElement;

    /** Хост и сессия ОДНИМ полем: появляются вместе, раздельные nullable-поля защищали бы от небывалых состояний. */
    private attached: IAttachedHost | null = null;
    private readonly stack = new VFlexElement();
    private passiveToasts: NotificationToast[] = [];

    /** Одним полем по той же причине, что {@link attached}. */
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

    /** До первого показа. */
    public attachHost(host: BodyElement): void {
        const session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            // Stryker disable next-line BooleanLiteral: сессию открывает явный `open()` следующим же проходом sync, а пустой стек она тут же и закрывает — начальная видимость ненаблюдаема
            visible: false,
            // Stryker disable next-line BooleanLiteral: стек не focusable — фокус не двигается ни при open, ни при close; флаг фиксирует намерение и наблюдаемого эффекта в тестах не имеет
            restoreFocus: false,
            // Stryker disable next-line BooleanLiteral: та же причина — focusOnOpen некому отдать фокус
            focusOnOpen: false,
            // Escape нужен тому, кто в фокусе; стек гасит таймер или «Clear All».
            // Stryker disable next-line BooleanLiteral: ветки неотличимы — фокуса в стеке нет, и до closeOnEscape слоя Escape не доходит
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: по мыши "" ведёт себя как passthrough (не modal и не close-on-outside) — наблюдаемой разницы нет, а клавиатуру гасит явный capturesKeyboard ниже
            pointerPolicy: "passthrough",
            capturesKeyboard: false,
        });
        this.attached = { host, session };
        this.sync();
    }

    /** Для команды палитры: фокус ушёл в редактор, а сообщение висит неотвеченным. */
    public focusAsk(): boolean {
        const ask = this.ask;
        if (ask === null) return false;
        ask.widget.focusDefault();
        return true;
    }

    /** Живой `ask` без открытой сессии не бывает — показ открывает её тем же проходом sync. */
    public getOpenAsk(): NotificationToast | MessageDialog | null {
        return this.ask?.widget ?? null;
    }

    private sync(): void {
        const attached = this.attached;
        if (attached === null) return;
        this.syncAsk(attached);
        this.syncPassive(attached.session);
        this.updatePositions(attached);
    }

    private syncPassive(session: OverlaySessionHandle): void {
        const all = this.notifications.passive();
        // Stryker disable next-line CallExpression: виджеты снимаются из дерева строкой ниже — их dispose ненаблюдаем
        this.disposePassive();
        // Детей снимаем ВМЕСТЕ с их dispose: освобождённые виджеты в дереве однажды отрисовались бы.
        this.stack.replaceChildren([]);
        if (all.length === 0) {
            // Stryker disable next-line ConditionalExpression,CallExpression: у пустого стека нет детей, поэтому открытая сессия и закрытая рисуют одно и то же — ничего
            if (session.isOpen()) session.close();
            return;
        }
        // Не «спрятано насовсем»: очередь доедет до экрана, когда передний тост уйдёт.
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
            // Только если фокус вообще уходил в тост (по F6 или клику).
            restoreFocus: true,
            // Тост-вопрос фокуса НЕ берёт (как в эталоне): сообщение приходит незвано.
            focusOnOpen: current.modal,
            // Escape разбирает виджет (он знает про `isCloseAffordance`): сессия
            // закрыла бы оверлей, не ответив тому, кто сообщение поднял.
            // Stryker disable next-line BooleanLiteral: ненаблюдаемо — Escape доходит до виджета раньше слоя, и показ снимается его обработчиком в обоих случаях
            closeOnEscape: false,
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
                // Фокус ставит САМА сессия (`focusOnOpen`): пересчёт позиций бывает и
                // когда погас пассивный тост, и свой `focusDefault()` сбросил бы выбор кнопки.
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

    /** Гигиена: к этому моменту виджеты уже сняты из дерева стека. */
    // Stryker disable next-line BlockStatement: см. выше — освобождение уже снятых виджетов ненаблюдаемо
    private disposePassive(): void {
        // Stryker disable next-line CallExpression: та же причина
        for (const toast of this.passiveToasts) toast.dispose();
        this.passiveToasts = [];
    }

    /** В подсказке — ДЕЙСТВУЮЩИЙ бинд «ответить»: человек вправе его переназначить. */
    private makeToast(notification: IActiveNotification): NotificationToast {
        const chord = this.keybindings.getKeybindingForCommand(FOCUS_MESSAGE_COMMAND_ID, this.contextKeys);
        const label = chord === undefined ? undefined : formatKeybinding(chord, keybindingLabelStyle(this.contextKeys));
        const toast = new NotificationToast(notification, label);
        // У пассивного тоста нет другого способа уйти раньше таймаута.
        toast.onClose = () => {
            this.notifications.dismiss(notification.id);
        };
        return toast;
    }
}

function fixedWidth(element: TUIElement): SizedBoxElement {
    const holder = new SizedBoxElement(TOAST_WIDTH);
    holder.setChild(element);
    return holder;
}

function makeQueueLabel(queued: number): TextLabelElement {
    const label = new TextLabelElement(`+${String(queued)} more`);
    label.style = { fg: "descriptionForeground" };
    return label;
}

/** Ниже строки меню (ряд 0): высокий тост на низком экране иначе уехал бы за кадр или накрыл меню. */
export function clampRow(row: number, screenH: number): number {
    return Math.min(Math.max(1, row), Math.max(1, screenH - 1));
}
