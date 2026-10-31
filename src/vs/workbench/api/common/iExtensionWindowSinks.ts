import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IWireInputBoxRequest,
    IWireOpenDialogRequest,
    IWireQuickPickEvent,
    IWireQuickPickItems,
    IWireQuickPickRequest,
    IWireQuickPickUpdate,
    IWireSaveDialogRequest,
    IWireShowMessageRequest,
    IWireStatusBarItem,
    IWireTerminalClosed,
    IWireTerminalCreate,
    IWireTerminalOpened,
    IWireTerminalRef,
    IWireValidationMessage,
    WireMarker,
    WireOutputLevel,
} from "./wireTypes.ts";

/** Full set of the resource's markers: replaces, does not merge. */
export type DiagnosticsSink = (owner: string, resource: string, markers: readonly WireMarker[]) => void;

/** `handle` is unique within the subprocess. */
export interface IProgressSink {
    start(handle: number, title: string): void;
    report(handle: number, message?: string, increment?: number): void;
    end(handle: number): void;
}

export interface IOutputSink {
    append(channel: string, label: string, level: WireOutputLevel, value: string): void;
    show(channel: string, label: string): void;
}

/** `clear`: the subprocess died and its `remove` will never arrive. */
export interface IStatusBarItemSink {
    update(item: IWireStatusBarItem): void;
    remove(handle: number): void;
    clear(): void;
}

/**
 * `cancel(handle)` MUST settle the extension's promise with `undefined`: otherwise
 * the extension's command hangs forever, invisibly.
 */
export interface IQuickInputSink {
    showInputBox(request: IQuickInputBoxRequest): Promise<string | undefined>;
    /** `onDidSelectItem` gets indices into the shown items, as the reply does. */
    showQuickPick(
        request: IWireQuickPickRequest,
        onDidSelectItem: (index: number) => void,
    ): Promise<readonly number[] | undefined>;
    /** For a request sent with `itemsPending`; a late answer to a finished show is ignored. */
    setQuickPickItems(items: IWireQuickPickItems): void;
    cancel(handle: number): void;
    /** The first update of a handle creates the picker, later ones are diffs; actions go to the FIRST update's `emit`. */
    updateQuickPick(update: IWireQuickPickUpdate, emit: (event: IWireQuickPickEvent) => void): void;
    disposeQuickPick(handle: number): void;
}

export interface IFileDialogSink {
    showOpenDialog(request: IWireOpenDialogRequest): Promise<readonly string[] | undefined>;
    showSaveDialog(request: IWireSaveDialogRequest): Promise<string | undefined>;
}

/**
 * Resolves with the button's INDEX in `request.items`. Without buttons, IMMEDIATELY: otherwise
 * `await showErrorMessage(...)` would hang for the toast's lifetime, and an error toast
 * never auto-hides. `cancel(handle)`: the subprocess died, nobody is left to answer.
 */
export interface INotificationSink {
    showMessage(request: INotificationRequest): Promise<number | undefined>;
    cancel(handle: number): void;
}

/** The host mints the address: `show*Message` has no token, and the host must dismiss it when the subprocess dies. */
export interface INotificationRequest extends IWireShowMessageRequest {
    readonly handle: number;
}

/** Validation lives in the extension: the sink calls it across the process boundary; `undefined`: no `validateInput`. */
export interface IQuickInputBoxRequest extends IWireInputBoxRequest {
    readonly validate?: (value: string) => Promise<IWireValidationMessage | null>;
}

/** Upstream `$acceptTerminal*`. */
export interface IExtensionTerminalEvents {
    opened(terminal: IWireTerminalOpened): void;
    closed(terminal: IWireTerminalClosed): void;
    activeChanged(id: number | null): void;
    /** The pty terminal emulator is attached: time for the extension to call `pty.open(dims)`. */
    ptyStart(id: number, cols: number, rows: number): void;
    /** User typing and `sendText` → `pty.handleInput`. */
    ptyInput(id: number, data: string): void;
    ptyResize(id: number, cols: number, rows: number): void;
}

/**
 * Reports the lifecycle of ALL terminals, including the user's shells, like
 * `MainThreadTerminalService`. The subprocess addresses its own terminal by `extHostId`
 * until it learns the host `id`; the sink remembers both. `reset()`: the subprocess
 * died: its shells live on (as upstream), pty terminals are closed.
 */
export interface IExtensionTerminalSink {
    /** In creation order; seeds a new subprocess. */
    snapshot(): { readonly terminals: readonly IWireTerminalOpened[]; readonly activeId: number | null };
    /** Events before subscribing are in {@link snapshot}. */
    subscribe(events: IExtensionTerminalEvents): IDisposable;
    create(request: IWireTerminalCreate): void;
    show(terminal: IWireTerminalRef, preserveFocus: boolean): void;
    hide(terminal: IWireTerminalRef): void;
    sendText(terminal: IWireTerminalRef, text: string, shouldExecute: boolean): void;
    dispose(terminal: IWireTerminalRef): void;
    ptyData(terminal: IWireTerminalRef, data: string): void;
    ptyExit(terminal: IWireTerminalRef, code: number | undefined): void;
    reset(): void;
}
