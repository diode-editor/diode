import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { StyleFlags } from "../../common/styleFlags.ts";
import type { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

const CLOSE_CHAR = "×";
const MODIFIED_CHAR = "●";
// Codicon-замок — тот же глиф, которым VS Code метит read-only вкладку.
// Пишется escape'ом, а не литералом: глиф из Private Use Area не переживает
// копирование через инструменты и тихо превращается в пустую строку.
const READONLY_CHAR = "\uea75"; // nf-cod-lock

export class EditorTabItemElement extends TUIElement {
    private label: string;
    private icon: string;
    private iconColor: number;
    private modified: boolean;
    private readOnly: boolean;
    private paddingLeft: number;
    private paddingRight: number;
    private hovered = false;

    public onActivate: (() => void) | null = null;
    public onClose: (() => void) | null = null;

    public constructor(
        label: string,
        icon: string,
        iconColor: number,
        options?: { modified?: boolean; readOnly?: boolean; paddingLeft?: number; paddingRight?: number },
    ) {
        super();
        this.label = label;
        this.icon = icon;
        this.iconColor = iconColor;
        this.modified = options?.modified ?? false;
        this.readOnly = options?.readOnly ?? false;
        this.paddingLeft = options?.paddingLeft ?? 1;
        this.paddingRight = options?.paddingRight ?? 1;

        this.addEventListener("click", (event) => {
            const mouseEvent = event;
            // Middle click closes the tab regardless of where it lands (VSCode behaviour).
            if (mouseEvent.button === "middle") {
                this.onClose?.();
                return;
            }
            const closeStart = this.getCloseButtonStart();
            if (mouseEvent.localX >= closeStart && mouseEvent.localX < closeStart + CLOSE_CHAR.length) {
                this.onClose?.();
            } else {
                this.onActivate?.();
            }
        });

        this.addEventListener("mouseenter", () => {
            if (this.hovered) return;
            this.hovered = true;
            this.markDirty();
        });

        this.addEventListener("mouseleave", () => {
            if (!this.hovered) return;
            this.hovered = false;
            this.markDirty();
        });
    }

    public getLabel(): string {
        return this.label;
    }

    public setLabel(label: string): void {
        this.label = label;
        this.markDirty();
    }

    public getIcon(): string {
        return this.icon;
    }

    public setIcon(icon: string, color: number): void {
        this.icon = icon;
        this.iconColor = color;
        this.markDirty();
    }

    public getModified(): boolean {
        return this.modified;
    }

    public setModified(modified: boolean): void {
        if (this.modified === modified) return;
        this.modified = modified;
        this.markDirty();
    }

    public getReadOnly(): boolean {
        return this.readOnly;
    }

    /** Показывает/прячет метку-замок перед именем файла (VS Code read-only tab). */
    public setReadOnly(readOnly: boolean): void {
        if (this.readOnly === readOnly) return;
        this.readOnly = readOnly;
        this.markDirty();
    }

    public getPaddingLeft(): number {
        return this.paddingLeft;
    }

    public setPaddingLeft(value: number): void {
        this.paddingLeft = value;
        this.markDirty();
    }

    public getPaddingRight(): number {
        return this.paddingRight;
    }

    public setPaddingRight(value: number): void {
        this.paddingRight = value;
        this.markDirty();
    }

    // ─── Content Layout ───

    private getContentWidth(): number {
        // [paddingLeft][icon " "][lock " "][label][" ●/×"][paddingRight]
        // The trailing slot shows the modified dot OR the close cross — never both —
        // so the tab width stays stable regardless of modified/hover state. The lock
        // is the one part that does change the width: read-only is a rare, sticky
        // state, and squeezing it into an existing slot would hide the file icon.
        const iconPart = this.icon.length > 0 ? this.icon.length + 1 : 0; // icon + space
        const lockPart = this.readOnly ? READONLY_CHAR.length + 1 : 0; // lock + space
        const trailingPart = 2; // " ●" or " ×"
        return this.paddingLeft + iconPart + lockPart + this.label.length + trailingPart + this.paddingRight;
    }

    private getCloseButtonStart(): number {
        return this.getContentWidth() - this.paddingRight - CLOSE_CHAR.length;
    }

    // ─── Intrinsic Size ───

    public override getMinIntrinsicWidth(_height: number): number {
        return this.getContentWidth();
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.getContentWidth();
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

    // ─── Render ───

    public override render(context: RenderContext): void {
        const width = this.layoutSize.width;
        const resolved = this.resolvedStyle;
        let x = 0;

        // Fill background for the whole width first
        for (let i = 0; i < width; i++) {
            context.setCell(i, 0, { char: " ", fg: resolved.fg, bg: resolved.bg });
        }

        // Padding left (already filled with spaces)
        x += this.paddingLeft;

        // Icon
        if (this.icon.length > 0 && x < width) {
            context.setCell(x, 0, { char: this.icon, fg: this.iconColor, bg: resolved.bg });
            x += this.icon.length;
            if (x < width) {
                context.setCell(x, 0, { char: " ", fg: resolved.fg, bg: resolved.bg });
                x += 1;
            }
        }

        // Read-only lock, between the file icon and the label.
        if (this.readOnly && x < width) {
            context.setCell(x, 0, { char: READONLY_CHAR, fg: resolved.fg, bg: resolved.bg });
            x += READONLY_CHAR.length;
            if (x < width) {
                context.setCell(x, 0, { char: " ", fg: resolved.fg, bg: resolved.bg });
                x += 1;
            }
        }

        // Label
        for (let i = 0; i < this.label.length && x < width; i++) {
            context.setCell(x, 0, { char: this.label[i], fg: resolved.fg, bg: resolved.bg });
            x += 1;
        }

        // Trailing indicator: the modified dot until the tab is hovered, then
        // the close cross (VSCode behaviour). Clicking the slot always closes.
        const trailingChar = this.modified && !this.hovered ? MODIFIED_CHAR : CLOSE_CHAR;
        if (x + 1 < width) {
            context.setCell(x, 0, { char: " ", fg: resolved.fg, bg: resolved.bg });
            x += 1;
            context.setCell(x, 0, {
                char: trailingChar,
                fg: resolved.fg,
                bg: resolved.bg,
                style: StyleFlags.None,
            });
        }
    }
}
