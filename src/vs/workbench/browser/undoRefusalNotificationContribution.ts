import { Disposable } from "../../base/common/lifecycle.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { UndoRedoService } from "../../platform/undoRedo/common/undoRedoService.ts";
import { UndoRedoServiceDIToken } from "../../platform/undoRedo/common/undoRedoService.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";
import type { NotificationService } from "../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

export const UndoRefusalNotificationContributionDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
    token<UndoRefusalNotificationContribution>("UndoRefusalNotificationContribution");

/**
 * Upstream sends this warning from the undo service itself; ours is a platform
 * service and knows nothing about messages. Staying silent is not an option: a
 * refusal would look like a broken key.
 */
export class UndoRefusalNotificationContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [UndoRedoServiceDIToken, NotificationServiceDIToken] as const;

    public constructor(undoRedo: UndoRedoService, notifications: NotificationService) {
        super();
        this.register(
            undoRedo.onDidRefuse(({ message }) => {
                notifications.show({ severity: "warn", message, modal: false, items: [] });
            }),
        );
    }
}
