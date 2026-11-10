import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const NotificationServiceDIToken = token<NotificationService>("NotificationService");

export type NotificationSeverity = "info" | "warn" | "error";

/** Upstream `NotificationsToasts.PURGE_TIMEOUT`. */
export const NOTIFICATION_AUTO_HIDE_MS: Readonly<Record<NotificationSeverity, number>> = {
    info: 10000,
    warn: 12000,
    error: 15000,
};

/**
 * Upstream `NotificationsToasts.MAX_NOTIFICATIONS`. The rest wait in a queue: there is no
 * notification center, so hiding a message for good would lose it.
 */
export const MAX_VISIBLE_NOTIFICATIONS = 3;

/**
 * Finite, not infinite: an extension doing `await show*Message(...)` is blocked while the
 * message is shown, and an endless question hung the `vscode-languageclient` language
 * server restart (red Windows CI). Modals have no timer: closing a dialog under the user's hands is worse.
 */
export const NOTIFICATION_ASK_TIMEOUT_MS = 60000;

export interface INotificationMessage {
    readonly severity: NotificationSeverity;
    readonly message: string;
    /** Shown only for modal messages. */
    readonly detail?: string;
    readonly modal: boolean;
    readonly items: readonly string[];
    /**
     * The Escape button of a modal (`MessageItem.isCloseAffordance`); ignored for
     * non-modal messages, as upstream.
     */
    readonly closeAffordance?: number;
}

export interface IActiveNotification extends INotificationMessage {
    readonly id: number;
    /** Set on a progress notification (upstream `INotification.progress`); `percent` absent means infinite. */
    readonly progress?: { readonly percent?: number };
}

/** Upstream's progress button label (`localize('cancel', "Cancel")`). */
export const PROGRESS_CANCEL_LABEL = "Cancel";

export interface IProgressNotificationState {
    readonly message: string;
    /** 0–100; absent means infinite (a spinner). */
    readonly percent?: number;
}

export interface IProgressNotificationOptions extends IProgressNotificationState {
    readonly cancellable: boolean;
    /** The user pressed Cancel; the notification is already gone. */
    readonly onCancel: () => void;
    /**
     * The user hid it (Clear All, Escape) while the work goes on: upstream moves the progress
     * to the status bar then. Not called after {@link IProgressNotificationHandle.close} or a cancel.
     */
    readonly onHide: () => void;
}

/** Calls after the notification is gone (cancelled, hidden or closed) are no-ops. */
export interface IProgressNotificationHandle {
    readonly id: number;
    update(state: IProgressNotificationState): void;
    close(): void;
}

/** `id` is available immediately: the extension bridge dismisses messages of a dead subprocess. */
export interface INotificationHandle {
    readonly id: number;
    /** `undefined` means closed without a choice. */
    readonly answered: Promise<number | undefined>;
}

interface IPassiveEntry {
    notification: IActiveNotification;
    timer: ReturnType<typeof setTimeout> | null;
    /** A progress notification: sticky (never armed) and answered with Cancel. */
    readonly progress?: Pick<IProgressNotificationOptions, "onCancel" | "onHide">;
}

interface IAskEntry {
    readonly notification: IActiveNotification;
    readonly resolve: (index: number | undefined) => void;
    /** Modal messages have no timer. */
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Counterpart of `INotificationService`. Two kinds of messages:
 * - no buttons and not modal: a passive toast that goes away by itself, and the promise resolves
 *   `undefined` IMMEDIATELY (deviation: upstream waits for the toast to close, which would hang
 *   `await showErrorMessage(...)`);
 * - with buttons or modal: a question, one at a time, the rest queued.
 *
 * Deviation both ways: upstream, only an error with buttons is sticky, other questions
 * move to the notification center. There is no center, so a question lives longer than a toast
 * (AI completion's "Activate / Use free version" has no other door), but not forever.
 * Toast and question timers start once the message becomes visible, otherwise
 * a queued one would expire without ever being shown.
 */
export class NotificationService extends Disposable {
    public static dependencies = [] as const;

    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    private nextId = 1;
    /** Oldest → newest; the first {@link MAX_VISIBLE_NOTIFICATIONS} are visible. */
    private readonly passiveList: IPassiveEntry[] = [];
    private readonly askList: IAskEntry[] = [];

    public constructor() {
        super();
        // Pending questions settle as "closed without a choice", otherwise the asker would wait forever.
        this.register({
            dispose: () => {
                this.clearAll();
            },
        });
    }

    public readonly onDidChange = this.onDidChangeEmitter.event;

    public show(message: INotificationMessage): INotificationHandle {
        // Stryker disable next-line UpdateOperator: the counter only needs unique ids, the step direction is unobservable since `--` yields equally distinct ids
        const notification: IActiveNotification = { ...message, id: this.nextId++ };
        if (this.isPassive(message)) {
            this.removePassiveDuplicate(message);
            this.passiveList.push({ notification, timer: null });
            this.armVisibleTimers();
            this.fire();
            return { id: notification.id, answered: Promise.resolve(undefined) };
        }
        const answered = new Promise<number | undefined>((resolve) => {
            this.askList.push({ notification, resolve, timer: null });
        });
        this.armAskTimer();
        this.fire();
        return { id: notification.id, answered };
    }

    /**
     * Upstream `withNotificationProgress`: an info toast that takes one of the visible slots,
     * stays until closed (no timeout) and is updated in place on every report.
     */
    public showProgress(options: IProgressNotificationOptions): IProgressNotificationHandle {
        // Stryker disable next-line UpdateOperator: the counter only needs unique ids, see show()
        const id = this.nextId++;
        const entry: IPassiveEntry = {
            notification: progressNotification(id, options, options.cancellable),
            timer: null,
            progress: { onCancel: options.onCancel, onHide: options.onHide },
        };
        this.passiveList.push(entry);
        this.fire();
        return {
            id,
            update: (state) => {
                if (!this.passiveList.includes(entry)) return;
                entry.notification = progressNotification(id, state, entry.notification.items.length > 0);
                this.fire();
            },
            close: () => {
                this.removePassive(entry);
            },
        };
    }

    public passive(): readonly IActiveNotification[] {
        return this.passiveList.slice(0, MAX_VISIBLE_NOTIFICATIONS).map((entry) => entry.notification);
    }

    public queuedPassiveCount(): number {
        return Math.max(0, this.passiveList.length - MAX_VISIBLE_NOTIFICATIONS);
    }

    /**
     * A modal skips the queue: behind a question toast, which doesn't take focus and
     * may go unnoticed, it would never be seen.
     */
    public current(): IActiveNotification | null {
        return this.currentEntry()?.notification ?? null;
    }

    private currentEntry(): IAskEntry | null {
        const modal = this.askList.find((entry) => entry.notification.modal);
        return modal ?? this.askList.at(0) ?? null;
    }

    public queuedCount(): number {
        return Math.max(0, this.askList.length - 1);
    }

    /** An index outside the buttons means close: the answer isn't about this message. */
    public answer(id: number, index: number): void {
        const at = this.askList.findIndex((e) => e.notification.id === id);
        if (at < 0) {
            // The only button of a progress notification is Cancel.
            const progress = this.passiveList.find((e) => e.notification.id === id);
            if (progress?.progress === undefined || index !== 0 || progress.notification.items.length === 0) return;
            this.removePassive(progress);
            progress.progress.onCancel();
            return;
        }
        const { items } = this.askList[at].notification;
        this.settleAsk(at, index >= 0 && index < items.length ? index : undefined);
    }

    /** A repeated call with the same id is a no-op. */
    public dismiss(id: number): void {
        const ask = this.askList.findIndex((e) => e.notification.id === id);
        if (ask >= 0) {
            this.settleAsk(ask, undefined);
            return;
        }
        const entry = this.passiveList.find((e) => e.notification.id === id);
        if (entry === undefined) return;
        this.removePassive(entry);
        entry.progress?.onHide();
    }

    public clearAll(): void {
        if (this.passiveList.length === 0 && this.askList.length === 0) return;
        const passive = [...this.passiveList];
        for (const entry of passive) this.clearTimer(entry);
        this.passiveList.length = 0;
        const asks = [...this.askList];
        for (const entry of asks) this.clearTimer(entry);
        this.askList.length = 0;
        for (const entry of asks) entry.resolve(undefined);
        this.fire();
        // Upstream "Clear All" hides a running progress; the work goes on in the status bar.
        for (const entry of passive) entry.progress?.onHide();
    }

    public isEmpty(): boolean {
        return this.passiveList.length === 0 && this.askList.length === 0;
    }

    /** Upstream `NotificationsModel.addNotification`: a new toast replaces its identical live twin, with a fresh timer. */
    private removePassiveDuplicate(message: INotificationMessage): void {
        const index = this.passiveList.findIndex(
            ({ notification, progress }) =>
                progress === undefined &&
                notification.severity === message.severity &&
                notification.message === message.message &&
                notification.detail === message.detail,
        );
        if (index < 0) return;
        this.clearTimer(this.passiveList[index]);
        this.passiveList.splice(index, 1);
    }

    /** A repeated call is a no-op: `close` may come after a cancel or a hide. */
    private removePassive(entry: IPassiveEntry): void {
        const index = this.passiveList.indexOf(entry);
        if (index < 0) return;
        this.clearTimer(entry);
        this.passiveList.splice(index, 1);
        this.armVisibleTimers();
        this.fire();
    }

    /** A modal is never passive, even without buttons: the user must close it. */
    private isPassive(message: INotificationMessage): boolean {
        return !message.modal && message.items.length === 0;
    }

    /**
     * Takes a position, not an entry: both callers have already found it, and another lookup
     * would need a "not found" branch for a state that can't happen.
     */
    private settleAsk(at: number, index: number | undefined): void {
        const [entry] = this.askList.splice(at, 1);
        this.clearTimer(entry);
        entry.resolve(index);
        this.armAskTimer();
        this.fire();
    }

    private armVisibleTimers(): void {
        for (const entry of this.passiveList.slice(0, MAX_VISIBLE_NOTIFICATIONS)) {
            if (entry.timer !== null || entry.progress !== undefined) continue;
            const { id, severity } = entry.notification;
            entry.timer = setTimeout(() => {
                this.dismiss(id);
            }, NOTIFICATION_AUTO_HIDE_MS[severity]);
        }
    }

    private armAskTimer(): void {
        const entry = this.currentEntry();
        if (entry?.timer !== null || entry.notification.modal) return;
        const { id } = entry.notification;
        entry.timer = setTimeout(() => {
            this.dismiss(id);
        }, NOTIFICATION_ASK_TIMEOUT_MS);
    }

    private clearTimer(entry: IPassiveEntry | IAskEntry): void {
        // Stryker disable next-line ConditionalExpression: without the guard the call would be `clearTimeout(null)`, the same no-op
        if (entry.timer === null) return;
        clearTimeout(entry.timer);
        entry.timer = null;
    }

    private fire(): void {
        this.onDidChangeEmitter.fire();
    }
}

function progressNotification(
    id: number,
    state: IProgressNotificationState,
    cancellable: boolean,
): IActiveNotification {
    return {
        id,
        severity: "info",
        message: state.message,
        modal: false,
        items: cancellable ? [PROGRESS_CANCEL_LABEL] : [],
        progress: state.percent === undefined ? {} : { percent: state.percent },
    };
}
