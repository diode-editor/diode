import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIStyle } from "@tuidom/core/dom/styles/tuiStyle";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

/**
 * What a button or a link runs: a command by id (`[label](command:id)` in upstream `viewsWelcome`), or a
 * URL opened outside (`https:`).
 */
export type IViewWelcomeTarget =
    | { readonly command: string; readonly args?: readonly unknown[] }
    | { readonly url: string };

/**
 * Upstream `precondition` of a `viewsWelcome` entry: the button or command link is dimmed and does nothing
 * while the clause is false ({@link ViewWelcomeElement.updateEnablement}).
 */
interface IEnablement {
    readonly enablement?: string;
}

/** A link inside a paragraph: its label is drawn underlined in the text and runs the target. */
export type IViewWelcomeLink = { readonly label: string } & IViewWelcomeTarget & IEnablement;

/**
 * Counterpart of an upstream `viewsWelcome` line. An empty line is a text block with `text: ""`: the
 * author places gaps, not the layout, otherwise "text, button below" and "text, gap, button" would be
 * indistinguishable. A paragraph is text with links in it.
 */
export type IViewWelcomeBlock =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "paragraph"; readonly nodes: readonly (string | IViewWelcomeLink)[] }
    | ({ readonly kind: "button"; readonly label: string } & IViewWelcomeTarget & IEnablement);

/**
 * Column of the section header and tree rows. The flat hint has no indent on purpose (in the
 * panel it would get cut off), but welcome text right at the edge reads poorly.
 */
const LEFT_PADDING = 1;

/** A run of a paragraph line: plain text (`link: -1`) or a piece of one link. */
interface ISegment {
    readonly text: string;
    readonly link: number;
}

type WelcomeRow =
    | { readonly kind: "text"; readonly segments: readonly ISegment[] }
    | { readonly kind: "button"; readonly index: number };

interface IWelcomeButton {
    readonly element: ButtonElement;
    /** The button's own style (with its focus and hover variants), returned when it is enabled again. */
    readonly style: TUIStyle;
    readonly enablement?: string;
    enabled: boolean;
}

/** Upstream's disabled `Button`: dimmed, out of the Tab order. */
const DISABLED_BUTTON_STYLE: TUIStyle = { fg: "disabledForeground", bg: "button.secondaryBackground" };

/**
 * Focus and activation of one link; the parent paints the label (it may wrap over several rows), this
 * element sits on its first piece so a click there and Tab reach it.
 */
class WelcomeLinkElement extends TUIElement {
    public enabled = true;

    public constructor(
        public readonly link: IViewWelcomeLink,
        public readonly activate: () => void,
    ) {
        super();
        this.focusable = true;
        this.addEventListener("click", () => {
            this.activate();
        });
    }

    /** Enter and Space, as on a button. */
    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown" || !(event instanceof TUIKeyboardEvent)) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.activate();
    }

    /** The parent has painted the label under it. */
    public override render(): void {
        // Nothing of its own: the parent paints the label.
    }
}

/**
 * Text is painted directly, not via child labels: wrapping depends on the width from `performLayout`,
 * and changing the children or an attached label's text there is not allowed, as it freezes the frame.
 * So the only children are buttons and links, made once.
 */
export class ViewWelcomeElement extends TUIElement {
    private readonly buttons: IWelcomeButton[] = [];
    private readonly links: WelcomeLinkElement[] = [];

    public constructor(
        private readonly blocks: readonly IViewWelcomeBlock[],
        private readonly open: (target: IViewWelcomeTarget) => void,
    ) {
        super();
        this.style = { fg: "descriptionForeground" };
        for (const block of blocks) {
            if (block.kind === "paragraph") {
                for (const node of block.nodes) {
                    if (typeof node !== "string") this.addLink(node);
                }
                continue;
            }
            if (block.kind !== "button") continue;
            const element = new ButtonElement(block.label);
            const entry: IWelcomeButton = {
                element,
                style: element.style,
                enablement: block.enablement,
                enabled: true,
            };
            element.onActivate = () => {
                if (entry.enabled) open(block);
            };
            this.buttons.push(entry);
            this.appendChild(element);
        }
        this.addEventListener("click", (event) => {
            this.onClick(event);
        });
    }

    /** `false` when there are no buttons; the caller decides where focus goes. */
    public focusFirstButton(): boolean {
        const first = this.buttons.find((button) => button.element.focusable)?.element;
        if (first === undefined) return false;
        first.focus();
        return true;
    }

    /** Re-evaluates `enablement` of every button and link that has one (upstream, on each context change). */
    public updateEnablement(isEnabled: (enablement: string) => boolean): void {
        for (const button of this.buttons) {
            if (button.enablement === undefined) continue;
            const enabled = isEnabled(button.enablement);
            if (enabled === button.enabled) continue;
            button.enabled = enabled;
            button.element.focusable = enabled;
            button.element.style = enabled ? button.style : DISABLED_BUTTON_STYLE;
        }
        let changed = false;
        for (const link of this.links) {
            if (link.link.enablement === undefined) continue;
            const enabled = isEnabled(link.link.enablement);
            if (enabled === link.enabled) continue;
            link.enabled = enabled;
            link.focusable = enabled;
            changed = true;
        }
        if (changed) this.markDirty();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const width = this.textWidth(size.width);
        const placed = new Set<number>();
        for (const [y, row] of this.rowsFor(width).entries()) {
            if (row.kind === "button") {
                this.layoutChild(
                    this.buttons[row.index].element,
                    LEFT_PADDING,
                    y,
                    BoxConstraints.loose(new Size(width, 1)),
                );
                continue;
            }
            let x = LEFT_PADDING;
            for (const segment of row.segments) {
                const columns = displayWidth(segment.text);
                if (segment.link >= 0 && !placed.has(segment.link)) {
                    placed.add(segment.link);
                    this.layoutChild(this.links[segment.link], x, y, BoxConstraints.tight(new Size(columns, 1)));
                }
                x += columns;
            }
        }
        // A label of only spaces has no piece to sit on.
        for (const [index, link] of this.links.entries()) {
            if (!placed.has(index)) this.layoutChild(link, 0, 0, BoxConstraints.tight(new Size(0, 0)));
        }
        return size;
    }

    public override render(context: RenderContext): void {
        super.render(context);
        const { fg, bg } = this.resolvedStyle;
        const width = this.textWidth(this.layoutSize.width);
        for (const [y, row] of this.rowsFor(width).entries()) {
            if (row.kind !== "text") continue;
            let x = LEFT_PADDING;
            for (const segment of row.segments) {
                const style = segment.link < 0 ? { fg, bg } : this.linkStyle(this.links[segment.link], bg);
                // No `maxWidth`: lines are already wrapped to this width, the section clip cuts the rest.
                x += context.drawText(x, y, segment.text, style);
            }
        }
    }

    private addLink(link: IViewWelcomeLink): void {
        const element = new WelcomeLinkElement(link, () => {
            if (element.enabled) this.open(link);
        });
        // The label is painted here: its focus look follows the link's focus.
        const repaint = (): void => {
            this.markDirty();
        };
        element.addEventListener("focus", repaint);
        element.addEventListener("blur", repaint);
        this.links.push(element);
        this.appendChild(element);
    }

    /** A click on a wrapped link's later piece lands here, not on the link element. */
    private onClick(event: TUIMouseEvent): void {
        if (event.target !== this) return;
        const row = this.rowsFor(this.textWidth(this.layoutSize.width)).at(event.localY);
        if (row?.kind !== "text") return;
        let x = LEFT_PADDING;
        for (const segment of row.segments) {
            const end = x + displayWidth(segment.text);
            if (event.localX >= x && event.localX < end) {
                if (segment.link >= 0) this.links[segment.link].activate();
                return;
            }
            x = end;
        }
    }

    /** Upstream `.monaco-link`: link color, underlined; focused like a focused button, dimmed when disabled. */
    private linkStyle(link: WelcomeLinkElement, bg: number): { fg: number; bg: number; style: number } {
        if (!link.enabled) return { fg: this.styleVar("disabledForeground"), bg, style: StyleFlags.None };
        if (link.isFocused) {
            return {
                fg: this.styleVar("button.foreground"),
                bg: this.styleVar("button.background"),
                style: StyleFlags.Underline,
            };
        }
        return { fg: this.styleVar("textLink.foreground"), bg, style: StyleFlags.Underline };
    }

    private textWidth(available: number): number {
        return Math.max(0, available - LEFT_PADDING);
    }

    /** No cache: there are only a few blocks, and a per-width cache would add a branch observable only by cost. */
    private rowsFor(width: number): readonly WelcomeRow[] {
        const rows: WelcomeRow[] = [];
        let buttonIndex = 0;
        let linkIndex = 0;
        for (const block of this.blocks) {
            if (block.kind === "button") {
                rows.push({ kind: "button", index: buttonIndex });
                buttonIndex++;
                continue;
            }
            if (block.kind === "text") {
                // A gap (`text: ""`): wrapText returns a single empty line for it.
                for (const line of wrapText(block.text, width)) {
                    rows.push({ kind: "text", segments: [{ text: line, link: -1 }] });
                }
                continue;
            }
            let text = "";
            const owners: number[] = [];
            for (const node of block.nodes) {
                const label = typeof node === "string" ? node : node.label;
                const owner = typeof node === "string" ? -1 : linkIndex++;
                text += label;
                owners.push(...new Array<number>(label.length).fill(owner));
            }
            for (const segments of wrapLinked(text, owners, width)) rows.push({ kind: "text", segments });
        }
        return rows;
    }
}

/**
 * `wrapText` of the paragraph, cut back into runs by who owns each character. Wrapping only drops
 * whitespace (a run of it becomes one space or a line break), so the lines are walked against the
 * source to find each character's owner.
 */
function wrapLinked(text: string, owners: readonly number[], width: number): ISegment[][] {
    const result: ISegment[][] = [];
    let position = 0;
    for (const line of wrapText(text, width)) {
        while (position < text.length && isSpace(text[position])) position++;
        const segments: ISegment[] = [];
        for (const char of line) {
            const owner = owners[position];
            const last = segments.at(-1);
            if (last?.link === owner) {
                segments[segments.length - 1] = { text: last.text + char, link: owner };
            } else {
                segments.push({ text: char, link: owner });
            }
            if (char === " ") {
                while (position < text.length && isSpace(text[position])) position++;
            } else {
                position += char.length;
            }
        }
        result.push(segments);
    }
    return result;
}

function isSpace(char: string): boolean {
    return /\s/.test(char);
}

function displayWidth(text: string): number {
    return new DisplayLine(text).displayWidth;
}
