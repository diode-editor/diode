import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { HFlexElement, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IExtensionButton, ExtensionButtonKind } from "./extensionPageButtons.ts";
import type { IExtensionPageContent } from "./extensionPageContent.ts";
import { buildExtensionHeaderLines, TONE_COLORS } from "./extensionPageContent.ts";

/**
 * Закреплённая шапка страницы расширения: метаданные строками и ряд кнопок под
 * ними. Не прокручивается (в отличие от readme) — действие над расширением
 * должно быть видно всегда, куда бы ни уехал текст.
 *
 * Строки переносятся по ширине, поэтому высота шапки зависит от ширины:
 * {@link getMaxIntrinsicHeight} пересобирает строки под запрошенную ширину и
 * отвечает их числом — так родительская раскладка («шапка сверху, тело снизу»)
 * получает честную высоту в том же проходе.
 */

/** Отступ между кнопками в ряду. */
const BUTTON_GAP = 2;

/** Строк, которые шапка занимает сверх текста: ряд кнопок и зазор под ним. */
const CHROME_HEIGHT = 2;

export class ExtensionPageHeaderElement extends TUIElement {
    private readonly stack = new VStackElement();
    private readonly buttonRow = new HFlexElement();
    /** Пустая строка под кнопками — зазор до readme. */
    private readonly spacer = new TextLabelElement("");
    private readonly padded: TUIElement;
    private content: IExtensionPageContent;
    private buttons: readonly IExtensionButton[];
    /** Кнопки в порядке ряда — для навигации стрелками и для тестов. */
    private buttonElements: readonly ButtonElement[];
    /** Строки текста шапки — наблюдаемость (у списка построчного чтения нет). */
    private textRows: TextLabelElement[] = [];
    /** Ширина, под которую посчитан текущий перенос; `null` — строк ещё нет. */
    private wrappedWidth: number | null = null;

    public constructor(
        content: IExtensionPageContent,
        buttons: readonly IExtensionButton[],
        /** Нажатие кнопки: панель решает, что с этим делать. */
        private readonly onActivateButton: (kind: ExtensionButtonKind) => void,
    ) {
        super();
        this.content = content;
        this.buttons = buttons;
        // Отступ слева — как у тела страницы: текст не прижат к рамке вкладки.
        this.padded = new PaddingContainerElement(this.stack, { left: 1 });
        this.appendChild(this.padded);
        // Кнопки собираются сразу, не дожидаясь раскладки: страницу фокусируют
        // ещё до первого кадра (открытие вкладки), и фокусировать было бы нечего.
        this.buttonElements = this.buildButtonRow();
        this.syncStack();
    }

    /** Свежие данные и набор кнопок (сменилось состояние расширения, идёт операция). */
    public setContent(content: IExtensionPageContent, buttons: readonly IExtensionButton[]): void {
        this.content = content;
        this.buttons = buttons;
        this.buttonElements = this.buildButtonRow();
        this.rebuildTextRows();
        this.syncStack();
    }

    /** Кнопки ряда слева направо; выключенные тоже здесь — они видны. */
    public getButtons(): readonly ButtonElement[] {
        return this.buttonElements;
    }

    /** Фокус на первую доступную кнопку; `false` — доступных нет. */
    public focusFirstEnabledButton(): boolean {
        const button = this.buttonElements.find((element) => element.focusable);
        if (button === undefined) return false;
        button.focus();
        return true;
    }

    /** Строки и кнопки как они показаны — для тестов и инспектора. */
    public override inspectState(): Record<string, unknown> {
        return {
            lines: this.textRows.map((row) => row.getText()),
            buttons: this.buttons.map((button) => ({ label: button.label, enabled: button.enabled })),
        };
    }

    /**
     * Высота шапки = число строк текста под этой шириной плюс ряд кнопок с
     * зазором. Пересборка здесь не побочный эффект ради оптимизации: без неё
     * ответ был бы посчитан по прошлой ширине, и первый кадр после ресайза
     * разъехался бы.
     */
    public override getMaxIntrinsicHeight(width: number): number {
        this.ensureRows(width);
        return this.textRows.length + CHROME_HEIGHT;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.ensureRows(size.width);
        this.layoutChild(this.padded, 0, 0, BoxConstraints.tight(size));
        return size;
    }

    private ensureRows(width: number): void {
        if (width === this.wrappedWidth) return;
        this.wrappedWidth = width;
        this.rebuildTextRows();
        this.syncStack();
    }

    private rebuildTextRows(): void {
        // До первой раскладки ширины нет — и строк тоже: перенос без ширины
        // посчитать не из чего.
        if (this.wrappedWidth === null) return;
        // Ширина текста: минус колонка отступа слева и колонка справа — та же
        // мерка, что у тела, чтобы столбцы шапки и readme совпадали.
        const textWidth = this.wrappedWidth - 2;
        this.textRows = buildExtensionHeaderLines(this.content, textWidth).map((line, i) => {
            const row = new TextLabelElement(line.text);
            row.id = `extensionPageHeaderLine-${String(i)}`;
            row.setColors(TONE_COLORS[line.tone], INHERITED_BG);
            return row;
        });
    }

    /**
     * Складывает текущие строки и ряд кнопок в стек шапки. `replaceChildren`
     * сам помечает дерево грязным, поэтому отдельного `markDirty` тут нет.
     */
    private syncStack(): void {
        const rows: TUIElement[] = [...this.textRows, this.buttonRow, this.spacer];
        for (const row of rows) row.layoutStyle = { width: "fill", height: 1 };
        this.stack.replaceChildren(rows);
    }

    /** Собирает ряд кнопок из текущего описания и возвращает сами кнопки. */
    private buildButtonRow(): ButtonElement[] {
        const elements = this.buttons.map((button) => this.createButton(button));
        const children: TUIElement[] = [];
        for (const [i, element] of elements.entries()) {
            if (i > 0) children.push(gap(BUTTON_GAP));
            element.layoutStyle = { width: hflexFit(), height: 1 };
            children.push(element);
        }
        this.buttonRow.replaceChildren(children);
        return elements;
    }

    private createButton(button: IExtensionButton): ButtonElement {
        const element = new ButtonElement(button.label);
        element.id = `extensionPageButton-${button.kind}`;
        if (button.enabled) {
            element.onActivate = () => {
                this.onActivateButton(button.kind);
            };
            return element;
        }
        // Выключенная кнопка: не берёт фокус и приглушена — нажать её нельзя ни
        // мышью (нет обработчика), ни с клавиатуры (не в обходе фокуса). Форму
        // при этом сохраняем (фон кнопки на месте), гасим только текст.
        element.focusable = false;
        element.style = { ...element.style, fg: "descriptionForeground" };
        return element;
    }
}

/** Пустышка-зазор ряда кнопок. */
function gap(width: number): TUIElement {
    const element = new TextLabelElement("");
    element.layoutStyle = { width: hflexFixed(width), height: 1 };
    return element;
}
