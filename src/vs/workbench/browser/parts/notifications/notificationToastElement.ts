import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { INotification } from "../../../services/notification/common/notification.ts";
import { severityColorId, severityTitle } from "../../../services/notification/common/notification.ts";

/** Отступ между рамкой и текстом — по колонке с каждой стороны. */
const CONTENT_PAD = 1;
/** Пробел между кнопками в ряду. */
const BUTTON_GAP = 1;
/** Заголовок рамки (строка со словом строгости) — без сепаратора под ним. */
const HEADER_ROWS = 1;

/**
 * Один тост сообщения: рамка с заголовком-строгостью, перенесённый по ширине
 * текст и — если сообщение задало пункты — ряд кнопок-ответов.
 *
 * Живёт в Diode, а не в `@tuidom/elements`: собран целиком из движковых
 * примитивов (`BoxContainerElement` + `VStack`/`HFlex` + кнопки), своего render'а
 * не имеет, а его API говорит понятиями редактора ({@link INotification}).
 *
 * Клавиатуру ведёт стек ({@link import("./notificationsToastsElement.ts").NotificationsToastsElement}):
 * ходить по кнопкам надо и между тостами, а фокусируемая единица здесь —
 * кнопка, не тост.
 */
export class NotificationToastElement extends TUIElement {
    /** Желаемая ширина в колонках (клампится constraints'ами). */
    public preferredWidth = 48;

    /** Нажата кнопка `index` этого тоста. */
    public onActivate?: (index: number) => void;

    private readonly box = new BoxContainerElement();
    private readonly body = new VStackElement();
    private buttonList: ButtonElement[] = [];
    private lines: readonly string[] = [];
    private hintText: string | null = null;
    private notification: INotification | null = null;

    public constructor() {
        super();
        this.style = { fg: "notifications.foreground", bg: "notifications.background" };
        this.box.setBg("notifications.background");
        this.box.setBorderFg("notifications.border");
        // Заголовок без сепаратора: у тоста дорога каждая строка экрана.
        this.box.setHasSeparator(false);
        this.box.setChild(this.body);
        this.appendChild(this.box);
    }

    /** Показываемое сообщение; `hint` — подсказка под кнопками (null — без неё). */
    public setNotification(notification: INotification, hint: string | null): void {
        this.notification = notification;
        this.hintText = hint;
        this.box.setTitle(severityTitle(notification.severity));
        this.box.setTitleFg(severityColorId(notification.severity));
        this.rebuild(notification);
    }

    /** Id показываемого сообщения; `null` — тост пуст (ещё ничего не положили). */
    public get notificationId(): number | null {
        return this.notification?.id ?? null;
    }

    /** Кнопки слева направо — для навигации и фокуса (ведёт стек). */
    public buttons(): readonly ButtonElement[] {
        return this.buttonList;
    }

    /** Наблюдаемое состояние: строки текста, подписи кнопок, подсказка. */
    public override inspectState(): Record<string, unknown> {
        return {
            severity: this.notification?.severity ?? null,
            lines: [...this.lines],
            buttons: this.buttonList.map((button) => button.getLabel()),
            hint: this.hintText,
        };
    }

    /** Полная высота тоста: рамка + заголовок + текст + кнопки + подсказка. */
    public get totalHeight(): number {
        const buttonRows = this.buttonList.length > 0 ? 2 : 0;
        const hintRows = this.hintText === null ? 0 : 1;
        return this.lines.length + buttonRows + hintRows + HEADER_ROWS + BORDER_THICKNESS * 2;
    }

    private get innerWidth(): number {
        return Math.max(0, this.preferredWidth - BORDER_THICKNESS * 2 - CONTENT_PAD * 2);
    }

    /** Сообщение передаём аргументом: единственный вызывающий его уже держит. */
    private rebuild(notification: INotification): void {
        this.lines = wrapText(notification.message, this.innerWidth);
        this.buttonList = notification.items.map((label, index) => {
            const button = new ButtonElement(label);
            button.onActivate = () => this.onActivate?.(index);
            return button;
        });

        const rows: TUIElement[] = this.lines.map((line) => this.padded(new TextLabelElement(line)));
        if (this.buttonList.length > 0) {
            rows.push(new FillerElement());
            rows.push(this.buttonRow());
        }
        if (this.hintText !== null) {
            const hint = new TextLabelElement(this.hintText);
            hint.style = { fg: "descriptionForeground" };
            rows.push(this.padded(hint));
        }
        this.body.replaceChildren(rows.map((row) => this.stretched(row)));
    }

    /** Ряд кнопок: `[ Activate ] [ Use free version ]`, прижат влево. */
    private buttonRow(): HFlexElement {
        const row = new HFlexElement();
        row.addChild(new FillerElement(), { width: hflexFixed(CONTENT_PAD), height: 1 });
        for (const [index, button] of this.buttonList.entries()) {
            if (index > 0) row.addChild(new FillerElement(), { width: hflexFixed(BUTTON_GAP), height: 1 });
            row.addChild(button, { width: hflexFit(), height: 1 });
        }
        row.addChild(new FillerElement(), { width: hflexFill(), height: 1 });
        return row;
    }

    /** Отступ слева: текстовые строки не должны липнуть к рамке. */
    private padded(content: TUIElement): HFlexElement {
        const row = new HFlexElement();
        row.addChild(new FillerElement(), { width: hflexFixed(CONTENT_PAD), height: 1 });
        row.addChild(content, { width: hflexFill(), height: 1 });
        return row;
    }

    private stretched(row: TUIElement): TUIElement {
        row.layoutStyle = { width: "stretch", height: 1 };
        return row;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = constraints.constrain(new Size(this.preferredWidth, this.totalHeight));
        super.performLayout(BoxConstraints.tight(size));
        this.layoutChild(this.box, 0, 0, BoxConstraints.tight(size));
        return size;
    }
}
