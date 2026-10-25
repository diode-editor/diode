import type { ITerminalSurface, TerminalCell, TerminalMouseEventData } from "@tuidom/core/common/iTerminalSurface";
import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { onUnexpectedError } from "../../../../../base/common/errors.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import { combinedDisposable, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";
import { isInLink, type ITerminalLink } from "../common/terminalLinkProvider.ts";

export interface ITerminalLinkSession extends ITerminalSurface {
    readonly buffer?: ITerminalBuffer | undefined;
}

export interface ITerminalLinkSource {
    provideLinks(buffer: ITerminalBuffer, row: number): Promise<ITerminalLink[]>;
}

/**
 * The session as the terminal widget sees it, plus file links (upstream `TerminalLinkManager` over xterm's link
 * provider API): with Ctrl held, the link under the pointer is underlined, and Ctrl+click opens it: on release,
 * when the press and the release are on the same link (xterm's `Linkifier._handleMouseUp`). A program that
 * turned mouse tracking on (vim `mouse=a`, htop) owns the mouse — then there are no links.
 *
 * Ctrl alone is not a mouse event: its press and release arrive as keys only under the kitty protocol, so on
 * other tiers the underline follows the Ctrl bit of the next pointer move.
 */
export class TerminalLinkSurface implements ITerminalSurface {
    private hovered: ITerminalLink | undefined;
    /** The link the quick pick points at; unlike the hover, the pointer and new output don't clear it. */
    private revealed: ITerminalLink | undefined;
    /** Viewport cell of the last pointer move; `undefined` after the pointer left the widget. */
    private pointer: { readonly col: number; readonly row: number } | undefined;
    /** Only the latest lookup applies: detection is async and the pointer keeps moving. */
    private request = 0;
    /** Viewport cell of a Ctrl+left press, kept for its release. */
    private pressed: { readonly col: number; readonly row: number } | undefined;
    private readonly onDidChangeHoverEmitter = new Emitter<void>();

    public constructor(
        private readonly session: ITerminalLinkSession,
        private readonly links: ITerminalLinkSource,
        private readonly open: (link: ITerminalLink) => Promise<void>,
    ) {}

    /** For tests and the frame: the underlined link. */
    public get hoveredLink(): ITerminalLink | undefined {
        return this.hovered;
    }

    /** For tests and the frame: the link the quick pick points at. */
    public get revealedLink(): ITerminalLink | undefined {
        return this.revealed;
    }

    public get isExited(): boolean {
        return this.session.isExited;
    }

    public get mouseEventsActive(): boolean {
        return this.session.mouseEventsActive;
    }

    public get scrollOffset(): number {
        return this.session.scrollOffset;
    }

    public readCell(x: number, y: number, out: TerminalCell): boolean {
        if (!this.session.readCell(x, y, out)) return false;
        const hovered = this.hovered;
        const revealed = this.revealed;
        if (hovered !== undefined || revealed !== undefined) {
            // Stryker disable next-line OptionalChaining: both links come from a lookup over the buffer, which stays.
            const row = (this.session.buffer?.viewportY ?? 0) + y;
            if (
                (hovered !== undefined && isInLink(hovered, x, row)) ||
                (revealed !== undefined && isInLink(revealed, x, row))
            ) {
                out.style |= StyleFlags.Underline;
            }
        }
        return true;
    }

    public getCursor(): { x: number; y: number } | null {
        return this.session.getCursor();
    }

    public write(data: string): void {
        this.session.write(data);
    }

    public sendMouse(event: TerminalMouseEventData): void {
        if (this.session.mouseEventsActive) {
            this.pressed = undefined;
            this.clearHover();
            this.session.sendMouse(event);
            return;
        }
        // Every event knows where the pointer is and whether Ctrl is held.
        this.pointer = { col: event.col, row: event.row };
        this.updateHover(event.ctrl);
        if (event.button === "left" && event.action === "down" && event.ctrl) {
            this.pressed = { col: event.col, row: event.row };
            return;
        }
        if (event.button === "left" && event.action === "up" && this.pressed !== undefined) {
            const pressed = this.pressed;
            this.pressed = undefined;
            this.activate(pressed, { col: event.col, row: event.row });
            return;
        }
        this.session.sendMouse(event);
    }

    public scrollLines(delta: number): void {
        this.session.scrollLines(delta);
    }

    public resize(cols: number, rows: number): void {
        this.session.resize(cols, rows);
    }

    /** The widget's subscription also carries hover changes; new output or scrolling re-checks the hover. */
    public onUpdate(cb: () => void): IDisposable {
        return combinedDisposable(
            this.session.onUpdate(() => {
                if (this.hovered !== undefined) this.updateHover(true);
                cb();
            }),
            this.onDidChangeHoverEmitter.event(cb),
        );
    }

    public onExit(cb: (exitCode: number) => void): IDisposable {
        return this.session.onExit(cb);
    }

    /** Ctrl pressed or released while the pointer stays put (kitty protocol only). */
    public setModifier(ctrl: boolean): void {
        if (!this.session.mouseEventsActive) this.updateHover(ctrl);
    }

    public pointerLeft(): void {
        this.pointer = undefined;
        this.clearHover();
    }

    /** Underlines the link until the next call; `undefined` removes the underline. */
    public setRevealedLink(link: ITerminalLink | undefined): void {
        if (linkKey(this.revealed) === linkKey(link)) return;
        this.revealed = link;
        this.onDidChangeHoverEmitter.fire();
    }

    public clearHover(): void {
        this.request++;
        this.setHover(undefined);
    }

    private updateHover(ctrl: boolean): void {
        const pointer = this.pointer;
        if (!ctrl || pointer === undefined) {
            this.clearHover();
            return;
        }
        // The rejection path is for a bug, not for I/O: `linkAt` reports a provider failure itself.
        void this.linkAt(pointer.col, pointer.row).then((link) => {
            if (link !== null) this.setHover(link);
        }, onUnexpectedError);
    }

    /** Not superseded by later pointer moves: a click is never dropped. */
    private activate(
        pressed: { readonly col: number; readonly row: number },
        released: { readonly col: number; readonly row: number },
    ): void {
        const buffer = this.session.buffer;
        if (buffer === undefined) return;
        const pressY = buffer.viewportY + pressed.row;
        void this.links.provideLinks(buffer, pressY).then(async (links) => {
            const link = links.find((candidate) => isInLink(candidate, pressed.col, pressY));
            if (link === undefined || !isInLink(link, released.col, buffer.viewportY + released.row)) return;
            try {
                await this.open(link);
            } catch (error) {
                onUnexpectedError(error);
            }
        }, onUnexpectedError);
    }

    /** `null` — a newer lookup superseded this one. */
    private async linkAt(col: number, row: number): Promise<ITerminalLink | undefined | null> {
        const request = ++this.request;
        const buffer = this.session.buffer;
        if (buffer === undefined) return undefined;
        const y = buffer.viewportY + row;
        let links: ITerminalLink[];
        try {
            links = await this.links.provideLinks(buffer, y);
        } catch (error) {
            onUnexpectedError(error);
            return null;
        }
        if (request !== this.request) return null;
        return links.find((link) => isInLink(link, col, y));
    }

    private setHover(link: ITerminalLink | undefined): void {
        if (linkKey(this.hovered) === linkKey(link)) return;
        this.hovered = link;
        this.onDidChangeHoverEmitter.fire();
    }
}

/** The same for the same link found again: new output re-checks the hover without a redraw. */
function linkKey(link: ITerminalLink | undefined): string | undefined {
    return (
        link &&
        `${link.text}@${String(link.start.x)},${String(link.start.y)}-${String(link.end.x)},${String(link.end.y)}`
    );
}
