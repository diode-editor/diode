import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { HFlexElement, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { ExtensionButtonKind, IExtensionButton } from "./extensionPageButtons.ts";
import type { IExtensionPageContent } from "./extensionPageContent.ts";
import { buildExtensionHeaderLines, TONE_COLORS } from "./extensionPageContent.ts";

// Header height depends on width: getMaxIntrinsicHeight rebuilds lines for the requested width,
// so the "header on top, body below" layout gets an honest height in the same pass.

const BUTTON_GAP = 2;

/** Rows the header takes beyond the text: the button row and the spacer under it. */
const CHROME_HEIGHT = 2;

export class ExtensionPageHeaderElement extends TUIElement {
    private readonly stack = new VStackElement();
    private readonly buttonRow = new HFlexElement();
    private readonly spacer = new TextLabelElement("");
    private readonly padded: TUIElement;
    private content: IExtensionPageContent;
    private buttons: readonly IExtensionButton[];
    private buttonElements: readonly ButtonElement[];
    private textRows: TextLabelElement[] = [];
    /** Width the current wrap was computed for; `null` means there are no lines yet. */
    private wrappedWidth: number | null = null;

    public constructor(
        content: IExtensionPageContent,
        buttons: readonly IExtensionButton[],
        private readonly onActivateButton: (kind: ExtensionButtonKind) => void,
    ) {
        super();
        this.content = content;
        this.buttons = buttons;
        this.padded = new PaddingContainerElement(this.stack, { left: 1 });
        this.appendChild(this.padded);
        // Buttons are built right away, without waiting for layout: the page is focused
        // before the first frame (tab open), and there would be nothing to focus.
        this.buttonElements = this.buildButtonRow();
        this.syncStack();
    }

    public setContent(content: IExtensionPageContent, buttons: readonly IExtensionButton[]): void {
        this.content = content;
        this.buttons = buttons;
        this.buttonElements = this.buildButtonRow();
        this.rebuildTextRows();
        this.syncStack();
    }

    /** Row buttons left to right; disabled ones are here too, they are visible. */
    public getButtons(): readonly ButtonElement[] {
        return this.buttonElements;
    }

    /** Focuses the first enabled button; `false` means there are none. */
    public focusFirstEnabledButton(): boolean {
        const button = this.buttonElements.find((element) => element.focusable);
        if (button === undefined) return false;
        button.focus();
        return true;
    }

    public override inspectState(): Record<string, unknown> {
        return {
            lines: this.textRows.map((row) => row.getText()),
            buttons: this.buttons.map((button) => ({ label: button.label, enabled: button.enabled })),
        };
    }

    /**
     * Rebuilding here is not an optimization: without it the height would follow the previous width, and the
     * frame after a resize would fall apart.
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
        if (this.wrappedWidth === null) return;
        // Minus the indent column on the left and on the right, same measure as the body: header and readme columns line up.
        const textWidth = this.wrappedWidth - 2;
        this.textRows = buildExtensionHeaderLines(this.content, textWidth).map((line, i) => {
            const row = new TextLabelElement(line.text);
            row.id = `extensionPageHeaderLine-${String(i)}`;
            row.setColors(TONE_COLORS[line.tone], INHERITED_BG);
            return row;
        });
    }

    /** `replaceChildren` marks the tree dirty itself. */
    private syncStack(): void {
        const rows: TUIElement[] = [...this.textRows, this.buttonRow, this.spacer];
        for (const row of rows) row.layoutStyle = { width: "fill", height: 1 };
        this.stack.replaceChildren(rows);
    }

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
        // Disabled: out of the focus order and without a handler; keep the button background, dim only the text.
        element.focusable = false;
        element.style = { ...element.style, fg: "descriptionForeground" };
        return element;
    }
}

function gap(width: number): TUIElement {
    const element = new TextLabelElement("");
    element.layoutStyle = { width: hflexFixed(width), height: 1 };
    return element;
}
