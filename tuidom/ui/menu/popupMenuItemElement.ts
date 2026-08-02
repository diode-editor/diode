import { CompositeElement } from "../../dom/compositeElement.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../layout/hFlexElement.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

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

    public constructor(label: string, config: PopupMenuItemConfig, shortcut?: string, icon?: string) {
        super();
        this.label = label;
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

        // Обычное состояние НАСЛЕДУЕТ цвета — так селектбокс может переопределить
        // фон раскрытого списка (dropdown.listBackground) одним style на корне
        // попапа; выделение — when-вариант с токенами menu.selection*.
        this.style = {
            when: [{ states: ["selected"], fg: "menu.selectionForeground", bg: "menu.selectionBackground" }],
        };

        const row = new HFlexElement();
        if (config.hasIconColumn) {
            row.addChild(new TextLabelElement(this.icon ? this.icon + " " : "  "), {
                width: hflexFixed(2),
                height: "fill",
            });
        } else {
            row.addChild(new TextLabelElement(" "), { width: hflexFixed(1), height: "fill" });
        }
        row.addChild(new TextLabelElement(config.hasShortcuts ? this.label + " " : this.label), {
            width: hflexFill(),
            height: "fill",
        });
        if (config.hasShortcuts && this.shortcut) {
            const shortcutLabel = new TextLabelElement("  " + this.shortcut);
            shortcutLabel.style = {
                fg: "menu.shortcutForeground",
                when: [{ states: ["in:selected"], fg: "menu.selectionForeground" }],
            };
            row.addChild(shortcutLabel, { width: hflexFit(), height: "fill" });
        }
        row.addChild(new TextLabelElement(" "), { width: hflexFixed(1), height: "fill" });
        this.setRootChild(row);
    }

    public get selected(): boolean {
        return this.hasStyleState("selected");
    }

    public set selected(value: boolean) {
        this.setStyleState("selected", value);
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
