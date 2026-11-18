// Upstream `terminal.developer.contribution.ts`: see what bytes go through a terminal. Of its commands only Write
// Data and Record Session; the texture atlas, pty host restart and dev mode have nothing to act on here.

import { RunOnceScheduler } from "../../../../../base/common/async.ts";
import { DisposableStore } from "../../../../../base/common/lifecycle.ts";
import type { CommandAction } from "../../../../../platform/actions/common/commandAction.ts";
import { ClipboardDIToken } from "../../../../../platform/clipboard/common/iClipboard.ts";
import {
    type CommandRegistry,
    CommandRegistryDIToken,
} from "../../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../../platform/instantiation/common/diContainer.ts";
import { ProductIconServiceDIToken } from "../../../../../platform/theme/common/productIconService.ts";
import { QuickInputServiceDIToken } from "../../../../browser/parts/quickinput/quickInputService.ts";
import { StatusBarServiceDIToken } from "../../../../services/statusbar/common/statusBarService.ts";
import { createTerminal, showTerminalView } from "../../../terminal/browser/terminalActions.ts";
import { TerminalEditorServiceDIToken } from "../../../terminal/browser/terminalEditorService.ts";
import { type ITerminalInstance, TerminalServiceDIToken } from "../../../terminal/browser/terminalService.ts";

/** Upstream `Delayer(5000)`: the recording ends after this long without events. */
export const RECORD_SESSION_IDLE_MS = 5000;

export const RECORDING_SESSION_TEXT = "Recording terminal session...";

/** Upstream's events without `promptInputChange`: there is no prompt input model here. */
export type TerminalRecordingEvent =
    | { readonly type: "resize"; readonly cols: number; readonly rows: number }
    | { readonly type: "command"; readonly id: string }
    | { readonly type: "output" | "sendText" | "input"; readonly data: string };

/** `\n`, `\r` and `\xHH` (two hex digits, any case); everything else is literal. */
export function unescapeTerminalData(data: string): string {
    return data
        .replace(/\\n/gu, "\n")
        .replace(/\\r/gu, "\r")
        .replace(/\\x([0-9a-f]{2})/giu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/**
 * Events in the order they arrive; every one restarts the {@link RECORD_SESSION_IDLE_MS} timer, and when it runs out
 * `done` gets them all. A closed terminal sends nothing more: the timer ends the recording with what it has.
 */
export function recordTerminalSession(
    session: ITerminalInstance["session"],
    commands: Pick<CommandRegistry, "onWillExecuteCommand">,
    done: (events: TerminalRecordingEvent[]) => void,
): void {
    const events: TerminalRecordingEvent[] = [];
    const store = new DisposableStore();
    const timer = store.add(
        new RunOnceScheduler(() => {
            store.dispose();
            done(events);
        }, RECORD_SESSION_IDLE_MS),
    );
    const record = (event: TerminalRecordingEvent): void => {
        events.push(event);
        timer.schedule();
    };
    const recordResize = (): void => {
        record({ type: "resize", ...session.dimensions });
    };
    recordResize();
    store.add(session.onDidChangeDimensions(recordResize));
    store.add(
        commands.onWillExecuteCommand((event) => {
            record({ type: "command", id: event.commandId });
        }),
    );
    store.add(
        session.onWillData((data) => {
            record({ type: "output", data });
        }),
    );
    store.add(
        session.onDidSendText((data) => {
            record({ type: "sendText", data });
        }),
    );
    store.add(
        session.onDidWriteData((data) => {
            record({ type: "input", data });
        }),
    );
}

/** Upstream `getActiveOrCreateInstance` + `revealActiveTerminal`. */
function revealActiveOrCreate(accessor: ServiceAccessor): ITerminalInstance {
    const active = accessor.get(TerminalServiceDIToken).getActiveInstanceAcrossHosts();
    if (active === null) return createTerminal(accessor);
    if (active.target === "editor") accessor.get(TerminalEditorServiceDIToken).reveal(active.id, false);
    else showTerminalView(accessor);
    return active;
}

export const writeDataToTerminalAction: CommandAction = {
    id: "workbench.action.terminal.writeDataToTerminal",
    title: "Developer: Write Data to Terminal",
    shortTitle: "Write Data to Terminal",
    async run(accessor) {
        const instance = revealActiveOrCreate(accessor);
        const data = await accessor.get(QuickInputServiceDIToken).input({
            value: "",
            placeholder: "Enter data (supports \\n, \\r, \\xAB)",
            prompt: "Enter data to write directly to the terminal, bypassing the pty",
        });
        if (data === undefined || data === "") return;
        // Into the emulator as if the process had printed it; the process never sees it.
        instance.session.printMessage(unescapeTerminalData(data));
    },
};

/** Resolves when the recording is on the clipboard; a second run while one records is an independent recording. */
export const recordSessionAction: CommandAction = {
    id: "workbench.action.terminal.recordSession",
    title: "Developer: Record Terminal Session",
    shortTitle: "Record Terminal Session",
    run(accessor) {
        const clipboard = accessor.get(ClipboardDIToken);
        const commands = accessor.get(CommandRegistryDIToken);
        const entry = accessor.get(StatusBarServiceDIToken).addEntry({
            id: "recordSession",
            // Upstream `showProgress`; no animation here (`~spin` is ignored).
            text: accessor.get(ProductIconServiceDIToken).renderCodicons(`$(loading~spin) ${RECORDING_SESSION_TEXT}`),
            name: RECORDING_SESSION_TEXT,
            alignment: "left",
            priority: 0,
        });
        const instance = createTerminal(accessor);
        return new Promise<void>((resolve) => {
            recordTerminalSession(instance.session, commands, (events) => {
                entry.dispose();
                void clipboard.writeText(JSON.stringify(events, null, 2)).then(resolve);
            });
        });
    },
};

export const TERMINAL_DEVELOPER_ACTIONS: readonly CommandAction[] = [writeDataToTerminalAction, recordSessionAction];
