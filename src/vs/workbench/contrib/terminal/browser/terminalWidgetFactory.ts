import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";

import type { ITerminalInstance } from "./terminalService.ts";

/**
 * Builds the widget of an instance for the TERMINAL view or an editor tab. The seam lets terminal contributions
 * (file links) decorate the session the widget renders; a new widget per host, the session stays the same.
 */
export type TerminalWidgetFactory = (instance: ITerminalInstance) => TerminalViewElement;

export const TerminalWidgetFactoryDIToken = token<TerminalWidgetFactory>("TerminalWidgetFactory");

export const createPlainTerminalWidget: TerminalWidgetFactory = (instance) => new TerminalViewElement(instance.session);
