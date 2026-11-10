import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { CancellationTokenSource, NEVER_CANCELLED_TOKEN, ProgressLocation } from "./vscodeTypes.ts";
import type { WireProgressLocation } from "./wireTypes.ts";

interface ProgressStep {
    message?: string;
    increment?: number;
}

/** An unknown number is `Window`, as upstream's `ProgressService` falls back for an unknown location. */
export function toWireProgressLocation(location: unknown): WireProgressLocation {
    if (location === ProgressLocation.Notification) return "notification";
    if (location === ProgressLocation.SourceControl) return "sourceControl";
    if (typeof location === "object" && location !== null) {
        const { viewId } = location as { viewId?: unknown };
        if (typeof viewId === "string") return { viewId };
    }
    return "window";
}

/**
 * Upstream `ExtHostProgress`: `start` carries the location and `cancellable`, the host answers
 * a Cancel with `window.progress.cancel`, and `end` goes out however the task finishes —
 * resolve, reject or a synchronous throw (a spinner left behind spins forever).
 */
export function createProgressApi(rpc: SubprocessRpc): Pick<typeof vscode.window, "withProgress"> {
    let nextHandle = 1;
    /** Every running task has a source; only a cancellable one hands its token to the task. */
    const cancellations = new Map<unknown, CancellationTokenSource>();

    rpc.handleNotification("window.progress.cancel", (params) => {
        cancellations.get((params as { handle?: unknown } | null)?.handle)?.cancel();
    });

    const withProgress = <R>(
        options: vscode.ProgressOptions,
        task: (progress: vscode.Progress<ProgressStep>, token: vscode.CancellationToken) => Thenable<R>,
    ): Thenable<R> => {
        const handle = nextHandle++;
        const cancellable = options.cancellable === true;
        const source = new CancellationTokenSource();
        cancellations.set(handle, source);
        rpc.notify("window.progress.start", {
            handle,
            title: options.title ?? "",
            location: toWireProgressLocation(options.location),
            cancellable,
        });
        const progress: vscode.Progress<ProgressStep> = {
            report: (value: unknown) => {
                const v = (typeof value === "object" && value !== null ? value : {}) as {
                    message?: unknown;
                    increment?: unknown;
                };
                rpc.notify("window.progress.report", {
                    handle,
                    ...(typeof v.message === "string" ? { message: v.message } : {}),
                    ...(Number.isFinite(v.increment) ? { increment: v.increment as number } : {}),
                });
            },
        };
        const done = (): void => {
            cancellations.delete(handle);
            source.dispose();
            rpc.notify("window.progress.end", { handle });
        };
        // `new Promise` turns a synchronous throw into a rejection, so `done` still runs.
        return new Promise<R>((resolve) => {
            resolve(task(progress, cancellable ? source.token : NEVER_CANCELLED_TOKEN));
        }).finally(done);
    };
    return { withProgress };
}
