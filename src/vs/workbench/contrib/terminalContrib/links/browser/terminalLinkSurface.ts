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
 * provider API): with Ctrl held, the link under the pointer is underlined, and Ctrl+click opens it. A program that
 * turned mouse tracking on (vim `mouse=a`, htop) owns the mouse — then there are no links.
 *
 * Ctrl alone is not a mouse event: its press and release arrive as keys only under the kitty protocol, so on
 * other tiers the underline follows the Ctrl bit of the next pointer move.
 */
export class TerminalLinkSurface implements ITerminalSurface {
    private hovered: ITerminalLink | undefined;
    /** Viewport cell of the last pointer move; `undefined` after the pointer left the widget. */
    private pointer: { readonly col: number; readonly row: number } | undefined;
    /** Only the latest lookup applies: detection is async and the pointer keeps moving. */
    private request = 0;
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
        if (hovered !== undefined) {
            const viewportY = this.session.buffer?.viewportY ?? 0;
            if (isInLink(hovered, x, viewportY + y)) out.style |= StyleFlags.Underline;
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
            this.clearHover();
            this.session.sendMouse(event);
            return;
        }
        if (event.action === "move") {
            this.pointer = { col: event.col, row: event.row };
            this.updateHover(event.ctrl);
        } else if (event.action === "down" && event.button === "left" && event.ctrl) {
            this.activate(event.col, event.row);
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
        void this.linkAt(pointer.col, pointer.row).then((link) => {
            if (link !== null) this.setHover(link);
        });
    }

    private activate(col: number, row: number): void {
        void this.linkAt(col, row).then(async (link) => {
            if (link === null || link === undefined) return;
            try {
                await this.open(link);
            } catch (error) {
                onUnexpectedError(error);
            }
        });
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
        if (sameLink(this.hovered, link)) return;
        this.hovered = link;
        this.onDidChangeHoverEmitter.fire();
    }
}

function sameLink(a: ITerminalLink | undefined, b: ITerminalLink | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return (
        a.text === b.text &&
        a.start.x === b.start.x &&
        a.start.y === b.start.y &&
        a.end.x === b.end.x &&
        a.end.y === b.end.y
    );
}
