import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type {
    IFileDialogSink,
    INotificationSink,
    IOutputSink,
    IProgressSink,
    IQuickInputSink,
    IStatusBarItemSink,
} from "../../../../api/common/iExtensionWindowSinks.ts";
import type {
    IWireInputBoxResult,
    IWireOpenDialogResult,
    IWireQuickPickEvent,
    IWireQuickPickResult,
    IWireSaveDialogResult,
    IWireShowMessageResult,
    IWireValidationMessage,
    WireMessageSeverity,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireInputBoxRequest,
    parseWireOpenDialogRequest,
    parseWireOutputAppend,
    parseWireOutputShow,
    parseWireProgressEnd,
    parseWireProgressReport,
    parseWireProgressStart,
    parseWireQuickInputCancel,
    parseWireQuickPickDispose,
    parseWireQuickPickRequest,
    parseWireQuickPickUpdate,
    parseWireSaveDialogRequest,
    parseWireShowMessageRequest,
    parseWireStatusBarItem,
    parseWireStatusBarItemDispose,
    parseWireValidationMessage,
} from "../hostWireParsers.ts";

/** Window surface sinks; without a sink the surface silently drops its output. */
export interface IWindowSinks {
    readonly progressSink: IProgressSink | undefined;
    readonly outputSink: IOutputSink | undefined;
    readonly statusBarItemSink: IStatusBarItemSink | undefined;
    readonly quickInputSink: IQuickInputSink | undefined;
    readonly notificationSink: INotificationSink | undefined;
    readonly fileDialogSink?: IFileDialogSink;
}

/**
 * Everything the subprocess showed belongs to it: on its death spinners stop,
 * status bar items are removed, input overlays and messages are closed.
 */
export class WindowCustomer implements IExtensionHostCustomer {
    /** Monotonic for the whole host lifetime, not per spawn. */
    private nextMessageHandle = 1;

    public constructor(private readonly sinks: IWindowSinks) {}

    public attach({ rpc, logger }: IExtensionHostContext): IDisposable {
        const { progressSink, outputSink, statusBarItemSink, quickInputSink, notificationSink, fileDialogSink } =
            this.sinks;
        const store = new DisposableStore();
        const progressHandles = new Set<number>();
        const quickInputHandles = new Set<number>();
        const messageHandles = new Set<number>();
        const quickPickHandles = new Set<number>();
        /**
         * A picker removed on subprocess death reports hiding — there is no one to send that to over the closed
         * channel.
         */
        let attached = true;
        const emitQuickPickEvent = (event: IWireQuickPickEvent): void => {
            if (attached) rpc.notify("window.quickPick.event", event);
        };

        store.add(
            rpc.handleNotification("window.progress.start", (params) => {
                const start = parseWireProgressStart(params);
                if (start === null) return;
                progressHandles.add(start.handle);
                progressSink?.start(start.handle, start.title);
            }),
        );
        store.add(
            rpc.handleNotification("window.progress.report", (params) => {
                const report = parseWireProgressReport(params);
                if (report === null) return;
                progressSink?.report(report.handle, report.message, report.increment);
            }),
        );
        store.add(
            rpc.handleNotification("window.progress.end", (params) => {
                const end = parseWireProgressEnd(params);
                if (end === null) return;
                progressHandles.delete(end.handle);
                progressSink?.end(end.handle);
            }),
        );
        // `update` is the full state, not a delta: the host keeps no copy of the item.
        store.add(
            rpc.handleNotification("window.statusBarItem.update", (params) => {
                const item = parseWireStatusBarItem(params);
                if (item === null) return;
                statusBarItemSink?.update(item);
            }),
        );
        store.add(
            rpc.handleNotification("window.statusBarItem.dispose", (params) => {
                const removed = parseWireStatusBarItemDispose(params);
                if (removed === null) return;
                statusBarItemSink?.remove(removed.handle);
            }),
        );
        store.add(
            rpc.handleNotification("output.append", (params) => {
                const append = parseWireOutputAppend(params);
                if (append === null) return;
                outputSink?.append(append.channel, append.label, append.level, append.value);
            }),
        );
        store.add(
            rpc.handleNotification("output.show", (params) => {
                const show = parseWireOutputShow(params);
                if (show === null) return;
                outputSink?.show(show.channel, show.label);
            }),
        );
        // The host asks for validation with a reverse request to the same subprocess — it lives in the extension.
        store.add(
            rpc.handleRequest("window.showInputBox", async (params): Promise<IWireInputBoxResult> => {
                const request = parseWireInputBoxRequest(params);
                // “The user cancelled” right away, instead of the extension waiting forever.
                if (request === null || quickInputSink === undefined) return { value: null };
                // A named constant rather than an arrow inside the spread: Stryker
                // parses the source with its own babel and fails on a typed arrow in
                // a spread ternary (`Did not expect a type annotation here`).
                const askExtension = async (text: string): Promise<IWireValidationMessage | null> => {
                    try {
                        const answer = await rpc.request("window.inputBox.validate", {
                            handle: request.handle,
                            value: text,
                        });
                        return parseWireValidationMessage(answer);
                    } catch {
                        // A failed validation means the value is valid, not a field stuck forever.
                        return null;
                    }
                };
                quickInputHandles.add(request.handle);
                try {
                    const value = await quickInputSink.showInputBox({
                        ...request,
                        ...(request.validates ? { validate: askExtension } : {}),
                    });
                    return { value: value ?? null };
                } finally {
                    quickInputHandles.delete(request.handle);
                }
            }),
        );
        store.add(
            rpc.handleRequest("window.showQuickPick", async (params): Promise<IWireQuickPickResult> => {
                const request = parseWireQuickPickRequest(params);
                if (request === null || quickInputSink === undefined) return { indices: null };
                quickInputHandles.add(request.handle);
                try {
                    const indices = await quickInputSink.showQuickPick(request);
                    return { indices: indices ?? null };
                } finally {
                    quickInputHandles.delete(request.handle);
                }
            }),
        );
        store.add(
            rpc.handleNotification("window.quickInput.cancel", (params) => {
                const handle = parseWireQuickInputCancel(params);
                if (handle === null) return;
                // Stryker disable next-line OptionalChaining: the “no sink” branch further down is unreachable from tests except via this same path, and without a sink the access would throw
                quickInputSink?.cancel(handle);
            }),
        );
        store.add(
            rpc.handleNotification("window.quickPick.update", (params) => {
                const update = parseWireQuickPickUpdate(params);
                if (update === null || quickInputSink === undefined) return;
                quickPickHandles.add(update.handle);
                quickInputSink.updateQuickPick(update, emitQuickPickEvent);
            }),
        );
        store.add(
            rpc.handleNotification("window.quickPick.dispose", (params) => {
                const handle = parseWireQuickPickDispose(params);
                // Stryker disable next-line ConditionalExpression: the null check is for the types; `Set.delete(null)` is false anyway, and the second half filters out garbage
                if (handle === null || !quickPickHandles.delete(handle)) return;
                // Stryker disable next-line OptionalChaining: a handle gets into the set only after the sink check (see update) — “set non-empty but no sink” never happens
                quickInputSink?.disposeQuickPick(handle);
            }),
        );
        // File dialogs: without a sink, “the user cancelled” right away instead of waiting forever.
        store.add(
            rpc.handleRequest("window.showOpenDialog", async (params): Promise<IWireOpenDialogResult> => {
                const uris = await fileDialogSink?.showOpenDialog(parseWireOpenDialogRequest(params));
                return { uris: uris ?? null };
            }),
        );
        store.add(
            rpc.handleRequest("window.showSaveDialog", async (params): Promise<IWireSaveDialogResult> => {
                const uri = await fileDialogSink?.showSaveDialog(parseWireSaveDialogRequest(params));
                return { uri: uri ?? null };
            }),
        );
        store.add(
            rpc.handleRequest("window.showMessage", async (params): Promise<IWireShowMessageResult> => {
                const request = parseWireShowMessageRequest(params);
                if (request === null) return { index: null };
                logExtensionMessage(logger, request.severity, request.message);
                if (notificationSink === undefined) return { index: null };
                // Stryker disable next-line UpdateOperator: the counter only needs to make handles unique, the step direction is unobservable
                const handle = this.nextMessageHandle++;
                messageHandles.add(handle);
                // A show failure is our bug: rejecting the request would reject the extension's `await show*Message`,
                // and an unhandled reject kills the whole subprocess (caught by a live run).
                const index = await notificationSink
                    .showMessage({ ...request, handle })
                    .catch((error: unknown): undefined => {
                        logger?.error(`[extension] showMessage failed: ${String(error)}`);
                        return undefined;
                    });
                messageHandles.delete(handle);
                return { index: index ?? null };
            }),
        );

        store.add({
            dispose: () => {
                attached = false;
                for (const handle of progressHandles) progressSink?.end(handle);
                statusBarItemSink?.clear();
                // Stryker disable next-line OptionalChaining: a handle gets into the set only after the sink check, so “set non-empty but no sink” never happens; `?.` is a safeguard
                for (const handle of quickInputHandles) quickInputSink?.cancel(handle);
                // Stryker disable next-line OptionalChaining: see above
                for (const handle of messageHandles) notificationSink?.cancel(handle);
                // Stryker disable next-line OptionalChaining: see above
                for (const handle of quickPickHandles) quickInputSink?.disposeQuickPick(handle);
            },
        });
        return store;
    }
}

/** The toast fades, but what the extension said must still be readable later. */
function logExtensionMessage(logger: ILogger | undefined, severity: WireMessageSeverity, text: string): void {
    if (severity === "error") logger?.error(`[extension] ${text}`);
    else if (severity === "warn") logger?.warn(`[extension] ${text}`);
    else logger?.info(`[extension] ${text}`);
}
