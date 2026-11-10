import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIFocusEvent } from "@tuidom/core/dom/events/tuiFocusEvent";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";

import type { ISettingDescriptor } from "./settingsEditorModel.ts";
import {
    CheckboxElement,
    isAncestorOf,
    LinkElement,
    ListItemRowElement,
    parseDescription,
    WrappedTextElement,
} from "./settingsWidgets.ts";

// SPIKE: Settings UI look-and-feel. One setting row: indicator bar, title, description, control.

export interface ISettingItemState {
    readonly value: unknown;
    /** Set at the current target (user/workspace) — draws the blue bar. */
    readonly modified: boolean;
    /** `Also modified in: Workspace` — set in another scope that shadows or is shadowed. */
    readonly alsoModifiedIn: string | null;
}

export interface ISettingItemHost {
    write(key: string, value: unknown): void;
    openJson(key: string): void;
    showGearMenu(item: SettingItemElement, screenX: number, screenY: number): void;
    keyToLabel(key: string): string;
    reveal(element: TUIElement): void;
    query(): readonly string[];
}

const INDICATOR_X = 0;
const CONTENT_X = 2;
const RIGHT_PAD = 2;
const STRING_INPUT_WIDTH = 50;
const NUMBER_INPUT_WIDTH = 16;
const ARRAY_WIDGET_WIDTH = 60;

function formatScalar(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
}

export class SettingItemElement extends TUIElement {
    private readonly description: WrappedTextElement;
    private readonly controls: TUIElement[] = [];
    private checkbox: CheckboxElement | null = null;
    private select: SelectBoxElement | null = null;
    private input: InputElement | null = null;
    private validation: WrappedTextElement | null = null;
    private arrayRows: TUIElement[] = [];
    private addButton: ButtonElement | null = null;
    private addInput: InputElement | null = null;
    private state: ISettingItemState = { value: undefined, modified: false, alsoModifiedIn: null };

    public constructor(
        public readonly setting: ISettingDescriptor,
        private readonly host: ISettingItemHost,
    ) {
        super();
        this.id = `setting:${setting.key}`;
        this.style = {
            when: [
                { states: ["hover"], bg: "settings.rowHoverBackground" },
                { states: ["focusWithin"], bg: "settings.focusedRowBackground" },
            ],
        };
        this.description = new WrappedTextElement(parseDescription(setting.description, host.keyToLabel));
        this.appendChild(this.description);
        this.buildControl();

        this.addEventListener(
            "focus",
            () => {
                this.setStyleState("focusWithin", true);
            },
            { capture: true },
        );
        this.addEventListener(
            "blur",
            (event) => {
                const next = (event as TUIFocusEvent).relatedTarget;
                if (!isAncestorOf(this, next)) this.setStyleState("focusWithin", false);
            },
            { capture: true },
        );
        this.addEventListener("click", (event) => {
            const mouse = event as TUIMouseEvent;
            const x = mouse.screenX - this.globalPosition.x;
            const y = mouse.screenY - this.globalPosition.y;
            if (y === 0 && x >= this.layoutSize.width - RIGHT_PAD - 1) {
                event.preventDefault();
                this.host.showGearMenu(this, mouse.screenX, mouse.screenY);
                return;
            }
            // Upstream: clicking a boolean's description toggles it.
            if (this.checkbox !== null && y >= 1 && isAncestorOf(this.description, mouse.target)) {
                this.checkbox.toggle();
            }
        });
    }

    private buildControl(): void {
        const { setting } = this;
        switch (setting.kind) {
            case "boolean": {
                const checkbox = new CheckboxElement();
                checkbox.onDidChange = (checked) => {
                    this.host.write(setting.key, checked);
                };
                this.checkbox = checkbox;
                this.addControl(checkbox);
                break;
            }
            case "enum": {
                const select = new SelectBoxElement();
                const values = setting.schema.enum ?? [];
                select.setOptions(values.map((v) => ({ text: formatScalar(v) })));
                select.onDidSelect = ({ index }) => {
                    this.host.write(setting.key, values[index]);
                };
                this.select = select;
                this.addControl(select);
                break;
            }
            case "string":
            case "number": {
                const input = new InputElement();
                input.style = {
                    fg: "input.foreground",
                    bg: "input.background",
                    when: [{ states: ["focus"], bg: "input.background" }],
                };
                const commit = (): void => {
                    this.commitInput();
                };
                input.onChange = () => {
                    this.updateValidation();
                };
                input.addEventListener("keydown", (event) => {
                    if ((event as TUIKeyboardEvent).key === "Enter") commit();
                });
                input.addEventListener("blur", commit);
                this.input = input;
                this.addControl(input);
                this.validation = new WrappedTextElement([], "editorError.foreground");
                this.appendChild(this.validation);
                break;
            }
            case "stringArray":
            case "object": {
                if (setting.kind === "stringArray") {
                    const button = new ButtonElement("Add Item");
                    button.onActivate = () => {
                        this.startAddItem();
                    };
                    this.addButton = button;
                    this.addControl(button);
                }
                const link = new LinkElement("Edit in settings.json");
                link.onActivate = () => {
                    this.host.openJson(setting.key);
                };
                this.addControl(link);
                break;
            }
            case "complex": {
                const link = new LinkElement("Edit in settings.json");
                link.onActivate = () => {
                    this.host.openJson(setting.key);
                };
                this.addControl(link);
                break;
            }
        }
    }

    private addControl(control: TUIElement): void {
        this.controls.push(control);
        this.appendChild(control);
    }

    public setState(state: ISettingItemState): void {
        this.state = state;
        const { value } = state;
        if (this.checkbox !== null) this.checkbox.setChecked(value === true);
        if (this.select !== null) {
            const index = (this.setting.schema.enum ?? []).findIndex((v) => v === value);
            this.select.select(Math.max(0, index));
        }
        if (this.input !== null && !this.input.hasStyleState("focus")) {
            this.input.inputState.value = formatScalar(value);
            this.updateValidation();
        }
        if (this.setting.kind === "stringArray" || this.setting.kind === "object") {
            this.rebuildArrayRows();
            // The rows grew under a focused Add Item (the write lands asynchronously) — keep it on screen.
            if (this.addButton?.hasStyleState("focus") === true) this.host.reveal(this.addButton);
        }
        this.markDirty();
    }

    private rebuildArrayRows(): void {
        for (const row of this.arrayRows) this.removeChild(row);
        const { value } = this.state;
        if (this.setting.kind === "stringArray") {
            const items = Array.isArray(value) ? value.map(formatScalar) : [];
            this.arrayRows = items.map((text, index) => {
                const row = new ListItemRowElement(text);
                row.onRemove = () => {
                    this.host.write(
                        this.setting.key,
                        items.filter((_, i) => i !== index),
                    );
                };
                return row;
            });
        } else {
            const entries =
                typeof value === "object" && value !== null && !Array.isArray(value)
                    ? Object.entries(value as Record<string, unknown>)
                    : [];
            this.arrayRows = entries.map(([key, v]) => new ListItemRowElement(key, formatScalar(v)));
        }
        for (const row of this.arrayRows) this.appendChild(row);
    }

    private startAddItem(): void {
        if (this.addInput !== null) return;
        const input = new InputElement();
        input.placeholder = "Item";
        input.addEventListener("keydown", (event) => {
            const key = (event as TUIKeyboardEvent).key;
            if (key === "Enter") {
                const text = input.inputState.value.trim();
                const items = Array.isArray(this.state.value) ? (this.state.value as unknown[]) : [];
                // Write first: the new row lands before focus returns to the button, so the reveal sees it.
                if (text.length > 0) this.host.write(this.setting.key, [...items, text]);
                this.finishAddItem();
            } else if (key === "Escape") {
                this.finishAddItem();
            }
        });
        this.addInput = input;
        this.appendChild(input);
        this.markDirty();
        input.focus();
    }

    private finishAddItem(): void {
        if (this.addInput === null) return;
        this.removeChild(this.addInput);
        this.addInput = null;
        this.addButton?.focus();
        this.markDirty();
    }

    private validationMessage(): string | null {
        if (this.input === null || this.setting.kind !== "number") return null;
        const text = this.input.inputState.value.trim();
        const n = Number(text);
        if (text === "" || Number.isNaN(n)) return "Value must be a number.";
        if (this.setting.schema.type === "integer" && !Number.isInteger(n)) return "Value must be an integer.";
        const { minimum, maximum } = this.setting.schema;
        if (minimum !== undefined && n < minimum) return `Value must be greater than or equal to ${String(minimum)}.`;
        if (maximum !== undefined && n > maximum) return `Value must be less than or equal to ${String(maximum)}.`;
        return null;
    }

    private updateValidation(): void {
        const message = this.validationMessage();
        this.validation?.setRuns(message === null ? [] : [{ text: message }]);
        this.markDirty();
    }

    private commitInput(): void {
        if (this.input === null) return;
        const text = this.input.inputState.value;
        if (this.setting.kind === "number") {
            if (this.validationMessage() !== null) return;
            const n = Number(text);
            if (n !== this.state.value) this.host.write(this.setting.key, n);
        } else if (text !== this.state.value) {
            this.host.write(this.setting.key, text);
        }
    }

    public focusControl(): void {
        this.controls[0]?.focus();
    }

    // ---- layout ----

    private contentWidth(width: number): number {
        return Math.max(10, width - CONTENT_X - RIGHT_PAD);
    }

    private controlWidth(control: TUIElement, contentWidth: number): number {
        if (control === this.input) {
            return Math.min(contentWidth, this.setting.kind === "number" ? NUMBER_INPUT_WIDTH : STRING_INPUT_WIDTH);
        }
        if (control === this.select) {
            const longest = Math.max(8, ...(this.setting.schema.enum ?? []).map((v) => formatScalar(v).length));
            return Math.min(contentWidth, longest + 4);
        }
        return Math.min(contentWidth, control.getMaxIntrinsicWidth(1));
    }

    /** Rows: title, then (boolean) checkbox+description or description, list rows, controls, validation. */
    private place(width: number, apply: boolean): number {
        const content = this.contentWidth(width);
        let y = 1;
        const put = (el: TUIElement, x: number, w: number, h: number): void => {
            if (apply) this.layoutChild(el, x, y, BoxConstraints.tight(new Size(Math.max(0, w), h)));
        };

        if (this.checkbox !== null) {
            const descWidth = Math.max(1, content - 4);
            const h = Math.max(1, this.description.getMaxIntrinsicHeight(descWidth));
            put(this.checkbox, CONTENT_X, 3, 1);
            put(this.description, CONTENT_X + 4, descWidth, h);
            return y + h;
        }

        const descHeight = this.description.getMaxIntrinsicHeight(content);
        put(this.description, CONTENT_X, content, descHeight);
        y += descHeight;

        const listWidth = Math.min(content, ARRAY_WIDGET_WIDTH);
        for (const row of this.arrayRows) {
            put(row, CONTENT_X, listWidth, 1);
            y += 1;
        }
        if (this.addInput !== null) {
            put(this.addInput, CONTENT_X, listWidth, 1);
            y += 1;
        }

        // Controls share one line (`[ Add Item ]  Edit in settings.json`).
        let x = CONTENT_X;
        for (const control of this.controls) {
            const w = this.controlWidth(control, content);
            if (apply) this.layoutChild(control, x, y, BoxConstraints.tight(new Size(w, 1)));
            x += w + 2;
        }
        if (this.controls.length > 0) y += 1;

        if (this.validation !== null) {
            const h = this.validation.getMaxIntrinsicHeight(content);
            put(this.validation, CONTENT_X, content, h);
            y += h;
        }
        return y;
    }

    public override getMinIntrinsicHeight(width: number): number {
        return this.place(width, false);
    }

    public override getMaxIntrinsicHeight(width: number): number {
        return this.place(width, false);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.place(size.width, true);
        return size;
    }

    // ---- render ----

    public override render(context: RenderContext): void {
        this.paintOwnBackground(context);
        const { width, height } = this.layoutSize;
        const active = this.hasStyleState("hover") || this.hasStyleState("focusWithin");

        if (this.state.modified) {
            const bar = this.resolveColor("settings.modifiedItemIndicator");
            for (let y = 0; y < height; y++) context.drawText(INDICATOR_X, y, "▎", { fg: bar });
        }

        const headerFg = this.resolveColor("settings.headerForeground");
        const dimFg = this.resolveColor("descriptionForeground");
        const highlightFg = this.resolveColor("list.highlightForeground");
        const category = this.setting.category.length > 0 ? `${this.setting.category}: ` : "";
        const title = `${category}${this.setting.title}`;
        const words = this.host.query();
        const lower = title.toLowerCase();
        const highlighted = new Set<number>();
        for (const word of words) {
            for (let i = lower.indexOf(word); i >= 0; i = lower.indexOf(word, i + 1)) {
                for (let j = i; j < i + word.length; j++) highlighted.add(j);
            }
        }
        const titleMax = width - CONTENT_X - RIGHT_PAD - 2;
        const x = CONTENT_X + Math.min(titleMax, measureTextWidth(title));
        context.drawText(
            CONTENT_X,
            0,
            title,
            { fg: headerFg },
            {
                maxWidth: titleMax,
                getStyle: (offset) => ({
                    fg: highlighted.has(offset) ? highlightFg : headerFg,
                    style: offset >= category.length ? StyleFlags.Bold : StyleFlags.None,
                }),
            },
        );
        if (this.state.alsoModifiedIn !== null) {
            context.drawText(
                x,
                0,
                `  (Also modified in: ${this.state.alsoModifiedIn})`,
                { fg: dimFg, style: StyleFlags.Italic },
                { maxWidth: Math.max(0, width - x - RIGHT_PAD - 2) },
            );
        }
        if (active) context.drawText(width - RIGHT_PAD - 1, 0, "⚙", { fg: dimFg });
        this.renderChildren(context);
    }
}

export class SettingsGroupHeaderElement extends TUIElement {
    public constructor(
        public readonly groupId: string,
        private label: string,
        private readonly depth: number,
    ) {
        super();
        this.id = `settingsGroup:${groupId}`;
    }

    public setLabel(label: string): void {
        this.label = label;
        this.markDirty();
    }

    public override getMinIntrinsicHeight(): number {
        return this.depth === 0 ? 2 : 1;
    }

    public override getMaxIntrinsicHeight(): number {
        return this.getMinIntrinsicHeight();
    }

    public override render(context: RenderContext): void {
        const fg = this.resolveColor("settings.headerForeground");
        if (this.depth === 0) {
            context.drawText(CONTENT_X, 0, this.label, { fg, style: StyleFlags.Bold });
            const border = this.resolveColor("settings.headerBorder");
            context.drawText(CONTENT_X, 1, "─".repeat(Math.max(0, this.layoutSize.width - CONTENT_X - RIGHT_PAD)), {
                fg: border,
            });
        } else {
            context.drawText(CONTENT_X, 0, this.label, { fg, style: StyleFlags.Bold });
        }
    }
}
