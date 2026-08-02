import { StyleFlags } from "../../common/styleFlags.ts";
import { CompositeElement } from "../../dom/compositeElement.ts";
import { INHERITED_BG, INHERITED_FG } from "../../dom/styles/tuiStyle.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

export class MenuBarItemElement extends CompositeElement {
    public readonly label: string;
    public readonly mnemonic: string | undefined;
    public onActivate: (() => void) | null = null;
    /** Fired when the mouse moves over this item — used to switch the open menu on hover. */
    public onHover: (() => void) | null = null;

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

        // Обычное состояние наследует цвета полосы (их задаёт MenuBarElement
        // токенами menuBar.*), активный пункт — токены menubar.selection*.
        this.style = {
            when: [{ states: ["active"], fg: "menubar.selectionForeground", bg: "menubar.selectionBackground" }],
        };

        const text = new TextLabelElement(` ${this.label} `);
        const mnemonicIndex = this.getMnemonicIndex();
        if (mnemonicIndex >= 0) {
            text.setCharStyle(mnemonicIndex + 1, { style: StyleFlags.Underline });
        }
        this.setRootChild(text);
    }

    public get active(): boolean {
        return this.hasStyleState("active");
    }

    public set active(value: boolean) {
        this.setStyleState("active", value);
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
