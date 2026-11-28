// Upstream `IHostService` narrowed to window focus (`hasFocus`, `onDidChangeFocus`). Upstream asks the browser or
// Electron; a TUI can only ask the terminal it runs in: its focus reports (DECSET 1004, `CSI I` / `CSI O`). Inside
// tmux the window is the pane, and the reports arrive only with `set -g focus-events on`.

import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { TerminalBackendDIToken } from "../../../../platform/terminal/common/terminalBackendDIToken.ts";

export interface IHostService {
    /** `true` until the terminal reports otherwise: a terminal without mode 1004 never reports, and stays focused. */
    readonly hasFocus: boolean;
    /** Fires only on a change: a repeated report (two `CSI O` in a row) is dropped, like upstream `Event.latch`. */
    readonly onDidChangeFocus: Event<boolean>;
}

export const HostServiceDIToken = token<IHostService>("HostService");

export class HostService extends Disposable implements IHostService {
    public static dependencies = [TerminalBackendDIToken] as const;

    private readonly onDidChangeFocusEmitter = this.register(new Emitter<boolean>());
    public readonly onDidChangeFocus = this.onDidChangeFocusEmitter.event;

    private focused = true;

    public constructor(backend: ITerminalBackend) {
        super();
        backend.onFocusChange((focused) => {
            if (focused === this.focused) return;
            this.focused = focused;
            this.onDidChangeFocusEmitter.fire(focused);
        });
    }

    public get hasFocus(): boolean {
        return this.focused;
    }
}
