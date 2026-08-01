import { StyleFlags } from "../../common/styleFlags.ts";
import { CompositeElement } from "../../dom/compositeElement.ts";
import type { JsxNode } from "../../dom/jsx/jsx-runtime.ts";
import { INHERITED_BG, INHERITED_FG } from "../../dom/styles/tuiStyle.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import type { StyledChar } from "../text/textLabelElement.ts";
import { TextLabel } from "../text/textLabelElement.ts";

export class MenuBarItemElement extends CompositeElement {
    public readonly label: string;
    public readonly mnemonic: string | undefined;
    public onActivate: (() => void) | null = null;
    /** Fired when the mouse moves over this item — used to switch the open menu on hover. */
    public onHover: (() => void) | null = null;
    private activeValue = false;

    public constructor(label: string, mnemonic?: string) {
        super();
        this.label = label;
        this.mnemonic = mnemonic;

        this.addEventListener("click", (event) => {
            if (event.defaultPrevented) return;
            this.onActivate?.();
        });

        this.addEventListener("mousemove", (event) => {
            if (event.defaultPrevented) return;
            this.onHover?.();
        });

        this.rebuild();
    }

    public get active(): boolean {
        return this.activeValue;
    }

    public set active(value: boolean) {
        if (this.activeValue === value) return;
        this.activeValue = value;
        this.rebuild();
    }

    public describe(): JsxNode {
        // Обычное состояние наследует цвета полосы (их задаёт MenuBarElement
        // токенами menuBar.*), активный пункт — токены menubar.selection*.
        const fg = this.activeValue ? "menubar.selectionForeground" : INHERITED_FG;
        const bg = this.activeValue ? "menubar.selectionBackground" : INHERITED_BG;
        return <TextLabel text={` ${this.label} `} fg={fg} bg={bg} charStyles={this.buildCharStyles()} />;
    }

    private buildCharStyles(): Map<number, StyledChar> | undefined {
        const mnemonicIndex = this.getMnemonicIndex();
        if (mnemonicIndex < 0) return undefined;
        const styles = new Map<number, StyledChar>();
        styles.set(mnemonicIndex + 1, { style: StyleFlags.Underline });
        return styles;
    }

    private getMnemonicIndex(): number {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const mnemonic = (this.mnemonic ?? this.label[0] ?? "").toLowerCase();
        return this.label.toLowerCase().indexOf(mnemonic);
    }
}

export class MenuBarFillerElement extends TUIElement {
    public constructor() {
        super();
        // «Владею фоном, крашу унаследованным» — заливает база.
        this.style = { fg: INHERITED_FG, bg: INHERITED_BG };
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return 0;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return 0;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }
}
