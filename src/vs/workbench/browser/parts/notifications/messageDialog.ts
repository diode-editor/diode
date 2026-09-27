import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { renderCodicons } from "../../../../base/common/codicons.ts";
import type {
    IActiveNotification,
    NotificationSeverity,
} from "../../../services/notification/browser/notificationService.ts";
import { DIALOG_STYLES, DialogComponent } from "../dialogs/dialogComponent.ts";

/** DOM-идентичность окна для `querySelector("#messageDialog")`. */
export const MESSAGE_DIALOG_ELEMENT_ID = "messageDialog";

/** Ширина текста внутри окна — окно по центру, места больше, чем у тоста. */
export const MESSAGE_DIALOG_TEXT_WIDTH = 60;

/** Кнопка модального сообщения без кнопок: закрыть его человек обязан сам. */
export const MESSAGE_DIALOG_CLOSE_LABEL = "OK";

/** Заголовок окна по строгости (иконка — та же разметка, что у тоста). */
const SEVERITY_TITLES: Readonly<Record<NotificationSeverity, string>> = {
    info: "$(info) Information",
    warn: "$(warning) Warning",
    error: "$(error) Error",
};

/**
 * Модальное сообщение расширения (`showInformationMessage(msg, { modal: true },
 * …)`) — окно по центру экрана вместо тоста в углу: пока человек не ответил,
 * экран под окном не принимает ни клик, ни клавишу.
 *
 * Ответ — индекс кнопки в `notification.items`; Escape отдаёт кнопку, помеченную
 * `isCloseAffordance` (так задокументировано в vscode.d.ts), а если такой нет —
 * закрывает без выбора. У сообщения без кнопок кнопка одна, {@link
 * MESSAGE_DIALOG_CLOSE_LABEL}, и она тоже значит «без выбора».
 */
export class MessageDialog extends DialogComponent {
    /** Человек нажал кнопку с этим индексом в `notification.items`. */
    public onSelect?: (index: number) => void;
    /** Человек закрыл окно, не выбрав. */
    public onClose?: () => void;

    public readonly notification: IActiveNotification;
    private readonly buttons: readonly ButtonElement[];

    public constructor(notification: IActiveNotification) {
        super(MESSAGE_DIALOG_ELEMENT_ID);
        this.notification = notification;

        const stack = this.buildFrame(renderCodicons(SEVERITY_TITLES[notification.severity]));
        const messageLines = wrapText(notification.message, MESSAGE_DIALOG_TEXT_WIDTH);
        const detailLines =
            notification.detail === undefined ? [] : wrapText(notification.detail, MESSAGE_DIALOG_TEXT_WIDTH);
        for (const line of messageLines) {
            stack.addChild(new TextLabelElement(line), { width: "stretch", height: 1 });
        }
        if (detailLines.length > 0) {
            stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });
            for (const line of detailLines) {
                const label = new TextLabelElement(line);
                label.style = { fg: DIALOG_STYLES.descriptionFg };
                stack.addChild(label, { width: "stretch", height: 1 });
            }
        }

        // Кнопки расширения либо единственная «OK»: окно без кнопок не закрыть,
        // а модальное окно держит весь экран.
        const buttons: ButtonElement[] =
            notification.items.length > 0
                ? notification.items.map((title, index) => {
                      const button = new ButtonElement(title);
                      button.onActivate = () => this.onSelect?.(index);
                      return button;
                  })
                : [makeCloseButton(() => this.onClose?.())];
        this.buttons = buttons;

        // Центруем по ФАКТИЧЕСКОЙ ширине окна (его задаёт самая длинная строка),
        // а не по предельной: у короткого сообщения окно узкое, и отступ, посчитанный
        // от предела, увёл бы кнопки к правому краю.
        const innerWidth = Math.max(0, ...messageLines.map((line) => line.length), ...detailLines.map((l) => l.length));
        stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });
        stack.addChild(buildCenteredRow(buttons, innerWidth), { width: "stretch", height: 1 });
    }

    /**
     * Ставит фокус на первую кнопку — она же ответ по умолчанию. Кнопка есть
     * всегда: сообщению без кнопок конструктор даёт единственную «OK».
     */
    public focusDefault(): void {
        this.buttons[0].focus();
    }

    protected override rowButtons(): readonly ButtonElement[] {
        return this.buttons;
    }

    protected override onDismiss(): void {
        const closeAffordance = this.notification.closeAffordance;
        if (closeAffordance !== undefined) {
            this.onSelect?.(closeAffordance);
            return;
        }
        this.onClose?.();
    }
}

function makeCloseButton(onActivate: () => void): ButtonElement {
    const button = new ButtonElement(MESSAGE_DIALOG_CLOSE_LABEL);
    button.onActivate = onActivate;
    return button;
}

/**
 * Ряд кнопок по центру окна. Центрируем ФИКСИРОВАННЫМ левым отступом, а тянется
 * только правый спейсер: `HFlexElement` допускает максимум один `fill`-ребёнок
 * (два спейсера по краям кидают на постройке окна — поймано живым прогоном).
 *
 * Ширины кнопок спрашиваем у самих кнопок, а не считаем по длине подписи: как
 * именно {@link ButtonElement} обрамляет текст, знает он сам.
 */
export function buildCenteredRow(buttons: readonly ButtonElement[], innerWidth: number): HFlexElement {
    const gap = 2;
    const buttonsWidth = buttons.reduce((sum, button) => sum + button.getMaxIntrinsicWidth(1), 0);
    const totalWidth = buttonsWidth + gap * Math.max(0, buttons.length - 1);
    const leftPad = Math.max(0, Math.floor((innerWidth - totalWidth) / 2));

    const row = new HFlexElement();
    row.addChild(new TextLabelElement(""), { width: hflexFixed(leftPad), height: 1 });
    for (const [index, button] of buttons.entries()) {
        if (index > 0) row.addChild(new TextLabelElement(""), { width: hflexFixed(gap), height: 1 });
        row.addChild(button, { width: hflexFit(), height: 1 });
    }
    row.addChild(new TextLabelElement(""), { width: hflexFill(), height: 1 });
    return row;
}
