import { CompositeElement } from "../../dom/compositeElement.ts";
import type { JsxNode } from "../../dom/jsx/jsx-runtime.ts";
import { INHERITED_BG, INHERITED_FG } from "../../dom/styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { HFlex, hflexFill, hflexFit, hflexFixed } from "../layout/hFlexElement.ts";
import { TextLabel } from "../text/textLabelElement.ts";

export interface PopupMenuItemConfig {
    hasIconColumn: boolean;
    hasShortcuts: boolean;
}

export class PopupMenuItemElement extends CompositeElement {
    public readonly label: string;
    public readonly shortcut: string | undefined;
    public readonly icon: string | undefined;
    public onSelect?: () => void;
    /** Fired when the mouse moves over this item — used to follow the cursor with the selection. */
    public onHover?: () => void;
    private readonly config: PopupMenuItemConfig;
    private selectedValue = false;

    public constructor(label: string, config: PopupMenuItemConfig, shortcut?: string, icon?: string) {
        super();
        this.label = label;
        this.config = config;
        this.shortcut = shortcut;
        this.icon = icon;

        this.addEventListener("click", (event) => {
            if (event.defaultPrevented) return;
            this.onSelect?.();
        });

        // Follow the mouse: hovering an item moves the menu selection onto it (VS Code behavior).
        this.addEventListener("mousemove", (event) => {
            if (event.defaultPrevented) return;
            this.onHover?.();
        });

        this.rebuild();
    }

    public get selected(): boolean {
        return this.selectedValue;
    }

    public set selected(value: boolean) {
        if (this.selectedValue === value) return;
        this.selectedValue = value;
        this.rebuild();
    }

    public describe(): JsxNode {
        // Обычное состояние НАСЛЕДУЕТ цвета (сентинелы) — так селектбокс может
        // переопределить фон раскрытого списка (dropdown.listBackground) одним
        // style на корне попапа; выделение — токены menu.selection*.
        const fg = this.selectedValue ? "menu.selectionForeground" : INHERITED_FG;
        const bg = this.selectedValue ? "menu.selectionBackground" : INHERITED_BG;

        const labelText = this.config.hasShortcuts ? this.label + " " : this.label;

        return (
            <HFlex>
                {this.config.hasIconColumn ? (
                    <TextLabel
                        text={this.icon ? this.icon + " " : "  "}
                        fg={fg}
                        bg={bg}
                        layout={{ width: hflexFixed(2), height: "fill" }}
                    />
                ) : (
                    <TextLabel text=" " fg={fg} bg={bg} layout={{ width: hflexFixed(1), height: "fill" }} />
                )}
                <TextLabel text={labelText} fg={fg} bg={bg} layout={{ width: hflexFill(), height: "fill" }} />
                {this.config.hasShortcuts && this.shortcut ? (
                    <TextLabel
                        text={"  " + this.shortcut}
                        fg={this.selectedValue ? "menu.selectionForeground" : "menu.shortcutForeground"}
                        bg={bg}
                        layout={{ width: hflexFit(), height: "fill" }}
                    />
                ) : null}
                <TextLabel text=" " fg={fg} bg={bg} layout={{ width: hflexFixed(1), height: "fill" }} />
            </HFlex>
        );
    }
}

export class PopupMenuSeparatorElement extends TUIElement {
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

    public override render(context: RenderContext): void {
        const width = this.layoutSize.width;
        for (let x = 0; x < width; x++) {
            context.setCell(x, 0, {
                char: "─",
                fg: this.styleVar("menu.separatorBackground"),
                bg: this.resolvedStyle.bg,
            });
        }
    }
}
