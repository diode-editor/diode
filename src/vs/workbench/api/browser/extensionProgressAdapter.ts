import { stripCodicons } from "../../../base/common/codicons.ts";
import type {
    IProgressNotificationHandle,
    NotificationService,
} from "../../services/notification/browser/notificationService.ts";
import type { IProgressSink, IProgressStartOptions } from "../common/iExtensionWindowSinks.ts";

import type { ExtensionViewProgressAdapter } from "./extensionViewProgressAdapter.ts";
import { accumulatePercent } from "./progressStatusBarAdapter.ts";

/** Upstream `withNotificationProgress`: a toast that flashes up and away reads as noise. */
export const PROGRESS_NOTIFICATION_MIN_VISIBLE_MS = 800;

class NotificationProgress {
    public message: string | undefined;
    /** Accumulated 0–100; undefined until the first increment (upstream: infinite until then). */
    public percent: number | undefined;
    /** null once the user cancelled or hid it. */
    public toast: IProgressNotificationHandle | null = null;
    public minVisibleElapsed = false;
    /** The task finished while the toast was younger than the minimum. */
    public ended = false;

    public constructor(public readonly title: string) {}

    /** Upstream: `"{title}: {message}"`, or whichever of the two there is. */
    public text(): string {
        const parts = [this.title, this.message].filter((p): p is string => p !== undefined && p !== "");
        return stripCodicons(parts.join(": "));
    }
}

/**
 * Routes `withProgress` by location, as upstream `ProgressService`: Notification is a progress toast,
 * Window the status bar entry, SourceControl and `{ viewId }` a view's header spinner. A toast the user
 * hid while the task runs goes on in the status bar; after Cancel the task runs on without UI.
 */
export class ExtensionProgressAdapter implements IProgressSink {
    private readonly notified = new Map<number, NotificationProgress>();
    private readonly viewed = new Set<number>();

    public constructor(
        private readonly window: IProgressSink,
        private readonly notifications: NotificationService,
        private readonly views: Pick<ExtensionViewProgressAdapter, "start" | "end">,
    ) {}

    public start(handle: number, options: IProgressStartOptions, onCancel: () => void): void {
        const { location } = options;
        if (location === "window") {
            this.window.start(handle, options, onCancel);
            return;
        }
        if (location !== "notification") {
            this.viewed.add(handle);
            this.views.start(handle, location, options.title);
            return;
        }
        const entry = new NotificationProgress(options.title);
        this.notified.set(handle, entry);
        entry.toast = this.notifications.showProgress({
            message: entry.text(),
            cancellable: options.cancellable,
            onCancel: () => {
                entry.toast = null;
                onCancel();
            },
            onHide: () => {
                entry.toast = null;
                if (entry.ended) return;
                this.window.start(handle, options, onCancel);
                this.window.report(handle, entry.message, entry.percent);
            },
        });
        setTimeout(() => {
            entry.minVisibleElapsed = true;
            if (entry.ended) entry.toast?.close();
        }, PROGRESS_NOTIFICATION_MIN_VISIBLE_MS);
    }

    public report(handle: number, message?: string, increment?: number): void {
        // A view shows only the indicator.
        if (this.viewed.has(handle)) return;
        const entry = this.notified.get(handle);
        if (entry === undefined) {
            this.window.report(handle, message, increment);
            return;
        }
        if (message !== undefined) entry.message = message;
        if (increment !== undefined) entry.percent = accumulatePercent(entry.percent, increment);
        if (entry.toast === null) {
            this.window.report(handle, message, increment);
            return;
        }
        entry.toast.update({ message: entry.text(), percent: entry.percent });
    }

    public end(handle: number): void {
        if (this.viewed.delete(handle)) {
            this.views.end(handle);
            return;
        }
        const entry = this.notified.get(handle);
        if (entry === undefined) {
            this.window.end(handle);
            return;
        }
        this.notified.delete(handle);
        entry.ended = true;
        if (entry.toast === null) this.window.end(handle);
        else if (entry.minVisibleElapsed) entry.toast.close();
    }
}
