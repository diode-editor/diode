import type { NotificationService } from "../../services/notification/browser/notificationService.ts";
import type { INotificationRequest, INotificationSink } from "../common/iExtensionWindowSinks.ts";
import type { IWireMessageItem } from "../common/wireTypes.ts";

/** On subprocess death only our own shows may be dismissed; core messages are unrelated to the extension. */
export class NotificationExtensionAdapter implements INotificationSink {
    private readonly openMessages = new Map<number, number>();

    public constructor(private readonly notifications: NotificationService) {}

    public async showMessage(request: INotificationRequest): Promise<number | undefined> {
        const handle = this.notifications.show({
            severity: request.severity,
            message: request.message,
            detail: request.detail,
            modal: request.modal,
            items: request.items.map((item) => item.title),
            closeAffordance: findCloseAffordance(request.items),
        });
        this.openMessages.set(request.handle, handle.id);
        // No try/finally: `answered` only resolves (the service never rejects it),
        // so "forget the show" can simply happen here, after the answer.
        const answer = await handle.answered;
        // Stryker disable next-line CallExpression: map hygiene. Unobservable: show handles are monotonic, so a "dismiss" by a forgotten handle would find neither our own show nor anyone else's in the service
        this.openMessages.delete(request.handle);
        return answer;
    }

    public cancel(handle: number): void {
        const id = this.openMessages.get(handle);
        // Stryker disable next-line ConditionalExpression: without the guard `dismiss(undefined)` finds no show and does nothing either; the branches are indistinguishable, the guard is there for the type
        if (id === undefined) return;
        // Stryker disable next-line CallExpression: the same map hygiene as in showMessage
        this.openMessages.delete(handle);
        this.notifications.dismiss(id);
    }
}

/** The first one marked `isCloseAffordance`, as upstream. */
export function findCloseAffordance(items: readonly IWireMessageItem[]): number | undefined {
    const index = items.findIndex((item) => item.isCloseAffordance);
    return index < 0 ? undefined : index;
}
