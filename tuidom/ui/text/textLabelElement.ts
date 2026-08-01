import { DEFAULT_COLOR } from "../../common/colorUtils.ts";
import { DisplayLine } from "../../common/displayLine.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { StyleFlags } from "../../common/styleFlags.ts";
import type { StyleColor } from "../../dom/styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

/** Посимвольный стиль; цвета — StyleColor: числа ИЛИ имена токенов темы. */
export interface StyledChar {
    fg?: StyleColor;
    bg?: StyleColor;
    style?: StyleFlags;
}

export class TextLabelElement extends TUIElement {
    private text: string;
    private charStyles = new Map<number, StyledChar>();

    public constructor(text: string) {
        super();
        this.text = text;
    }

    public getText(): string {
        return this.text;
    }

    public setText(text: string): void {
        this.text = text;
        this.markDirty();
    }

    public setColors(fg: StyleColor, bg: StyleColor): void {
        this.style = { ...this.style, fg, bg };
    }

    public setCharStyle(index: number, charStyle: StyledChar): void {
        this.charStyles.set(index, charStyle);
        this.markDirty();
    }

    public clearCharStyles(): void {
        this.charStyles.clear();
        this.markDirty();
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return new DisplayLine(this.text).displayWidth;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return new DisplayLine(this.text).displayWidth;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const natural = new Size(this.getMaxIntrinsicWidth(1), this.getMaxIntrinsicHeight(0));
        return super.performLayout(BoxConstraints.tight(constraints.constrain(natural)));
    }

    public override render(context: RenderContext): void {
        const width = this.layoutSize.width;
        const resolved = this.resolvedStyle;
        context.drawText(
            0,
            0,
            this.text,
            { fg: resolved.fg, bg: resolved.bg, style: StyleFlags.None },
            {
                maxWidth: width,
                getStyle: (offset) => {
                    const charStyle = this.charStyles.get(offset);
                    if (charStyle === undefined) return undefined;
                    // Ключи — только для заданных полей: drawText мёржит
                    // спредом, и ключ с undefined затёр бы базовый цвет.
                    const override: { fg?: number; bg?: number; style?: StyleFlags } = {};
                    if (charStyle.fg !== undefined) override.fg = this.resolveColor(charStyle.fg);
                    if (charStyle.bg !== undefined) override.bg = this.resolveColor(charStyle.bg);
                    if (charStyle.style !== undefined) override.style = charStyle.style;
                    return override;
                },
            },
        );
    }
}

// ─── TextLabel JSX Adapter ───

export interface TextLabelProps {
    text: string;
    fg?: StyleColor;
    bg?: StyleColor;
    charStyles?: Map<number, StyledChar>;
}

function applyTextLabelProps(el: TextLabelElement, props: TextLabelProps): void {
    el.setText(props.text);
    el.setColors(props.fg ?? DEFAULT_COLOR, props.bg ?? DEFAULT_COLOR);
    el.clearCharStyles();
    if (props.charStyles) {
        for (const [index, style] of props.charStyles) {
            el.setCharStyle(index, style);
        }
    }
}

export function TextLabel(props: TextLabelProps): TextLabelElement {
    const el = new TextLabelElement(props.text);
    applyTextLabelProps(el, props);
    return el;
}

TextLabel.update = (el: TUIElement, props: TextLabelProps): void => {
    applyTextLabelProps(el as TextLabelElement, props);
};
