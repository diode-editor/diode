import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ScrollableElement, type ScrollViewportInfo } from "@tuidom/elements/scrollbar/scrollableElement";

// SPIKE: Settings UI look-and-feel. Small widgets the Settings editor is built from.

export interface ITextRun {
    readonly text: string;
    readonly fg?: StyleColor;
    readonly style?: number;
}

/**
 * Upstream renders setting descriptions as markdown. Here: `code` spans, `#setting.key#` references
 * and `[text](link)` links are styled; everything else is plain text.
 */
export function parseDescription(source: string, keyToLabel: (key: string) => string): ITextRun[] {
    const text = source.replace(/&nbsp;/g, "").replace(/\n{3,}/g, "\n\n");
    const runs: ITextRun[] = [];
    const re = /`([^`]+)`|#([\w.-]+)#|\[([^\]]+)\]\(([^)]+)\)/g;
    let last = 0;
    for (const match of text.matchAll(re)) {
        if (match.index > last) runs.push({ text: text.slice(last, match.index) });
        if (match[1] !== undefined) runs.push({ text: match[1], fg: "textPreformat.foreground" });
        else if (match[2] !== undefined) runs.push({ text: keyToLabel(match[2]), fg: "textLink.foreground" });
        else if (match[3] !== undefined) runs.push({ text: match[3], fg: "textLink.foreground" });
        last = match.index + match[0].length;
    }
    if (last < text.length) runs.push({ text: text.slice(last) });
    return runs;
}

interface ICharStyle {
    readonly fg?: StyleColor;
    readonly style?: number;
}

/** Word-wrapped multi-line text with per-run styles. Transparent background. */
export class WrappedTextElement extends TUIElement {
    private text = "";
    private styles: ICharStyle[] = [];
    private cachedWidth = -1;
    private cachedLines: [number, number][] = [];

    public constructor(runs: readonly ITextRun[] = [], private readonly baseFg: StyleColor = "descriptionForeground") {
        super();
        this.setRuns(runs);
    }

    public setRuns(runs: readonly ITextRun[]): void {
        this.text = runs.map((r) => r.text).join("");
        this.styles = runs.flatMap((r) => Array.from(r.text, () => ({ fg: r.fg, style: r.style })));
        this.cachedWidth = -1;
        this.markDirty();
    }

    public isEmpty(): boolean {
        return this.text.length === 0;
    }

    public override getMinIntrinsicHeight(width: number): number {
        return this.getMaxIntrinsicHeight(width);
    }

    public override getMaxIntrinsicHeight(width: number): number {
        return this.lines(width).length;
    }

    public override getMaxIntrinsicWidth(): number {
        return this.text.length;
    }

    /** Greedy word wrap by code units — good enough for (mostly ASCII) setting descriptions. */
    private lines(width: number): [number, number][] {
        if (width === this.cachedWidth) return this.cachedLines;
        const lines: [number, number][] = [];
        const w = Math.max(1, width);
        for (const paragraph of this.paragraphs()) {
            let [start] = paragraph;
            const [, end] = paragraph;
            if (start === end) lines.push([start, end]);
            while (start < end) {
                if (end - start <= w) {
                    lines.push([start, end]);
                    break;
                }
                let cut = this.text.lastIndexOf(" ", start + w);
                if (cut <= start) cut = start + w;
                lines.push([start, cut]);
                start = cut;
                while (start < end && this.text[start] === " ") start++;
            }
        }
        this.cachedWidth = width;
        this.cachedLines = this.text.length === 0 ? [] : lines;
        return this.cachedLines;
    }

    private paragraphs(): [number, number][] {
        const result: [number, number][] = [];
        let start = 0;
        for (let i = 0; i <= this.text.length; i++) {
            if (i === this.text.length || this.text[i] === "\n") {
                result.push([start, i]);
                start = i + 1;
            }
        }
        return result;
    }

    public override render(context: RenderContext): void {
        const baseFg = this.resolveColor(this.baseFg);
        this.lines(this.layoutSize.width).forEach(([start, end], y) => {
            context.drawText(
                0,
                y,
                this.text.slice(start, end),
                { fg: baseFg },
                {
                    maxWidth: this.layoutSize.width,
                    getStyle: (offset) => {
                        const s = this.styles[start + offset];
                        if (s?.fg === undefined && s?.style === undefined) return undefined;
                        return { fg: s.fg !== undefined ? this.resolveColor(s.fg) : baseFg, style: s.style };
                    },
                },
            );
        });
    }
}

/** Upstream settings checkbox: a filled square with a check mark. */
export class CheckboxElement extends TUIElement {
    public onDidChange: ((checked: boolean) => void) | null = null;
    private checked = false;

    public constructor() {
        super();
        this.focusable = true;
        this.style = {
            fg: "settings.checkboxForeground",
            bg: "settings.checkboxBackground",
            when: [{ states: ["focus"], bg: "focusBorder" }],
        };
        this.addEventListener("click", (event) => {
            event.preventDefault();
            this.toggle();
        });
    }

    public setChecked(checked: boolean): void {
        if (this.checked === checked) return;
        this.checked = checked;
        this.markDirty();
    }

    public toggle(): void {
        this.checked = !this.checked;
        this.markDirty();
        this.onDidChange?.(this.checked);
    }

    public override getMaxIntrinsicWidth(): number {
        return 3;
    }

    public override getMaxIntrinsicHeight(): number {
        return 1;
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const key = (event as TUIKeyboardEvent).key;
        if (key === " " || key === "Enter") {
            event.preventDefault();
            this.toggle();
        }
    }

    public override render(context: RenderContext): void {
        const { fg, bg } = this.resolvedStyle;
        context.drawText(0, 0, this.checked ? " ✓ " : "   ", { fg, bg, style: StyleFlags.Bold });
    }
}

/** `textLink.foreground`, underlined on hover/focus. Enter or click runs it. */
export class LinkElement extends TUIElement {
    public onActivate: (() => void) | null = null;

    public constructor(private label: string) {
        super();
        this.focusable = true;
        this.style = { fg: "textLink.foreground" };
        this.addEventListener("click", (event) => {
            event.preventDefault();
            this.onActivate?.();
        });
    }

    public setLabel(label: string): void {
        this.label = label;
        this.markDirty();
    }

    public override getMaxIntrinsicWidth(): number {
        return this.label.length;
    }

    public override getMaxIntrinsicHeight(): number {
        return 1;
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "keydown" && (event as TUIKeyboardEvent).key === "Enter") {
            event.preventDefault();
            this.onActivate?.();
        }
    }

    public override render(context: RenderContext): void {
        const underline = this.hasStyleState("hover") || this.hasStyleState("focus");
        context.drawText(0, 0, this.label, {
            fg: this.resolvedStyle.fg,
            style: underline ? StyleFlags.Underline : StyleFlags.None,
        });
    }
}

/** A row with an icon-like action on hover — the item row of the array widget (`✎ ✕` upstream). */
export class ListItemRowElement extends TUIElement {
    public onRemove: (() => void) | null = null;

    public constructor(
        private readonly text: string,
        private readonly secondary: string | null = null,
    ) {
        super();
        this.style = { when: [{ states: ["hover"], bg: "list.hoverBackground" }] };
        this.addEventListener("click", (event) => {
            const mouse = event as TUIMouseEvent;
            const x = mouse.screenX - this.globalPosition.x;
            if (this.onRemove !== null && x >= this.layoutSize.width - 3) {
                event.preventDefault();
                this.onRemove();
            }
        });
    }

    public override getMaxIntrinsicHeight(): number {
        return 1;
    }

    public override render(context: RenderContext): void {
        this.paintOwnBackground(context);
        const width = this.layoutSize.width;
        const fg = this.resolveColor("editor.foreground");
        if (this.secondary === null) {
            context.drawText(1, 0, this.text, { fg }, { maxWidth: width - 5 });
        } else {
            const keyWidth = Math.floor((width - 5) / 2);
            context.drawText(1, 0, this.text, { fg }, { maxWidth: keyWidth - 1 });
            context.drawText(
                1 + keyWidth,
                0,
                this.secondary,
                { fg: this.resolveColor("descriptionForeground") },
                { maxWidth: width - keyWidth - 5 },
            );
        }
        if (this.hasStyleState("hover") && this.onRemove !== null) {
            context.drawText(width - 3, 0, "✕", { fg });
        }
    }
}

/**
 * A vertical stack of real (focusable) elements with its own scroll. Lays out every child each
 * frame (a few hundred settings — fine for a spike); off-screen children are clipped by the
 * render context and never hit-tested, since hits outside our own rect never reach us.
 */
export class SettingsScrollElement extends ScrollableElement {
    public onDidScroll: ((scrollTop: number) => void) | null = null;
    private items: TUIElement[] = [];
    private tops: number[] = [];
    private totalHeight = 0;
    private readonly gap = 1;
    /** The focused element to scroll into view on the next layout, once its own position is known. */
    private pendingReveal: TUIElement | null = null;

    public constructor() {
        super();
        this.addEventListener("wheel", (event) => {
            const direction = (event as TUIMouseEvent).wheelDirection;
            if (direction === "up") this.scrollBy(0, -3);
            else if (direction === "down") this.scrollBy(0, 3);
        });
        // A control receiving focus (Tab, Add Item) scrolls into view — the control itself, not its whole
        // setting row: a row can be taller than the viewport. Deferred to layout: a just-added input has no
        // position yet.
        this.addEventListener(
            "focus",
            (event) => {
                this.pendingReveal = event.target;
                this.markDirty();
            },
            { capture: true },
        );
    }

    public setItems(items: readonly TUIElement[]): void {
        for (const old of this.items) {
            if (!items.includes(old)) this.removeChild(old);
        }
        for (const item of items) {
            if (item.getParent() !== this) this.appendChild(item);
        }
        this.items = [...items];
        this.scrollTop = Math.min(this.scrollTop, Math.max(0, this.measure(this.layoutSize.width) - 1));
        this.markDirty();
    }

    /** Scroll `element` (a descendant) into view on the next layout. */
    public reveal(element: TUIElement): void {
        this.pendingReveal = element;
        this.markDirty();
    }

    public getItems(): readonly TUIElement[] {
        return this.items;
    }

    public get contentHeight(): number {
        return this.totalHeight;
    }

    public get contentWidth(): number {
        return this.layoutSize.width;
    }

    public itemTop(item: TUIElement): number | undefined {
        const index = this.items.indexOf(item);
        return index >= 0 ? this.tops[index] : undefined;
    }

    public scrollToItem(item: TUIElement): void {
        const top = this.itemTop(item);
        if (top !== undefined) this.scrollTo(0, top);
    }

    /** The last item whose top is at or above the viewport top. */
    public itemAtTop(): TUIElement | undefined {
        let found: TUIElement | undefined;
        this.items.forEach((item, i) => {
            if ((this.tops[i] ?? 0) <= this.scrollTop) found = item;
        });
        return found;
    }

    public override scrollTo(left: number, top: number): void {
        const before = this.scrollTop;
        super.scrollTo(left, top);
        if (this.scrollTop !== before) this.onDidScroll?.(this.scrollTop);
    }

    /** `target`'s top relative to our viewport, from the local positions of the last layout. */
    private offsetInViewport(target: TUIElement): number | null {
        let y = 0;
        for (let current: TUIElement | null = target; current !== null; current = current.getParent()) {
            if (current === this) return y;
            y += current.localPosition.dy;
        }
        return null;
    }

    private layoutItems(size: Size): void {
        this.items.forEach((item, i) => {
            const height = item.getMaxIntrinsicHeight(size.width);
            this.layoutChild(item, 0, (this.tops[i] ?? 0) - this.scrollTop, BoxConstraints.tight(new Size(size.width, height)));
        });
    }

    private measure(width: number): number {
        this.tops = [];
        let y = 0;
        for (const item of this.items) {
            this.tops.push(y);
            y += item.getMaxIntrinsicHeight(width) + this.gap;
        }
        this.totalHeight = y;
        return y;
    }

    protected override get paintsSubtreeAtomically(): boolean {
        return true;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = constraints.constrain(new Size(constraints.maxWidth, constraints.maxHeight));
        super.performLayout(BoxConstraints.tight(size));
        this.measure(size.width);
        const maxTop = Math.max(0, this.totalHeight - size.height);
        if (this.scrollTop > maxTop) this.scrollTop = maxTop;
        this.layoutItems(size);

        // Kept until paint, not cleared here: ScrollBarDecorator lays us out more than once per frame
        // (with and without its column), and a later pass would clamp an earlier pass's scroll.
        const target = this.pendingReveal;
        const y = target !== null ? this.offsetInViewport(target) : null;
        if (target !== null && y !== null) {
            const height = target.layoutSize.height;
            let delta = 0;
            if (y < 0) delta = y;
            else if (y + height > size.height) delta = Math.min(y, y + height - size.height);
            if (delta !== 0) {
                this.scrollTop = Math.max(0, Math.min(maxTop, this.scrollTop + delta));
                this.layoutItems(size);
                this.onDidScroll?.(this.scrollTop);
            }
        }
        return size;
    }

    protected override renderViewport(context: RenderContext, _viewport: ScrollViewportInfo): void {
        this.pendingReveal = null;
        this.paintOwnBackground(context);
        this.renderChildren(context);
    }
}

export function isAncestorOf(ancestor: TUIElement, node: TUIElement | null): boolean {
    for (let current = node; current !== null; current = current.getParent()) {
        if (current === ancestor) return true;
    }
    return false;
}
