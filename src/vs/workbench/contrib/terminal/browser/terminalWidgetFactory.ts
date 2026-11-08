import type { ITerminalSurface } from "@tuidom/core/common/iTerminalSurface";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ITerminalBuffer } from "../common/terminalBuffer.ts";

import type { ITerminalInstance } from "./terminalService.ts";

/**
 * Builds the widget of an instance for the TERMINAL view or an editor tab. The seam lets terminal contributions
 * (file links, the selection) decorate the session the widget renders; a new widget per host, the session stays
 * the same.
 */
export type TerminalWidgetFactory = (instance: ITerminalInstance) => TerminalViewElement;

export const TerminalWidgetFactoryDIToken = token<TerminalWidgetFactory>("TerminalWidgetFactory");

export const createPlainTerminalWidget: TerminalWidgetFactory = (instance) => new TerminalViewElement(instance.session);

/** What a decorator wraps and returns: the widget's surface with the emulator buffer behind it. */
export interface ITerminalDecoratedSurface extends ITerminalSurface {
    readonly buffer?: ITerminalBuffer | undefined;
}

export interface ITerminalSurfaceDecoration {
    readonly surface: ITerminalDecoratedSurface;
    /** Wires the decoration to the widget built over the outermost surface. */
    attach(widget: TerminalViewElement): void;
}

/** A terminal contribution over the widget's surface; it wraps `inner`, the session or an earlier decoration. */
export interface ITerminalSurfaceDecorator {
    decorate(instance: ITerminalInstance, inner: ITerminalDecoratedSurface): ITerminalSurfaceDecoration;
}

/** Each decorator wraps the previous one: the last one sees the widget's events first. */
export function createDecoratedTerminalWidget(
    instance: ITerminalInstance,
    decorators: readonly ITerminalSurfaceDecorator[],
): TerminalViewElement {
    let surface: ITerminalDecoratedSurface = instance.session;
    const decorations: ITerminalSurfaceDecoration[] = [];
    for (const decorator of decorators) {
        const decoration = decorator.decorate(instance, surface);
        decorations.push(decoration);
        surface = decoration.surface;
    }
    const widget = new TerminalViewElement(surface);
    for (const decoration of decorations) decoration.attach(widget);
    return widget;
}
