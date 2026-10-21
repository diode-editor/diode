import { Disposable } from "../../base/common/lifecycle.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import type { NotificationService } from "../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

export const OpenFailureNotificationContributionDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it — the string inside is only a debug label
    token<OpenFailureNotificationContribution>("OpenFailureNotificationContribution");

/**
 * Failing silently is not an option: opening misses on non-disk resources (`jdt:`,
 * `git:`) when the scheme's extension is not installed or not activated — without a
 * message, Go to Definition into a library looks like a broken key.
 */
export class OpenFailureNotificationContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [EditorServiceDIToken, NotificationServiceDIToken] as const;

    public constructor(editors: IEditorService, notifications: NotificationService) {
        super();
        this.register(
            editors.onDidFailOpen(({ uri, reason }) => {
                notifications.show({
                    severity: "error",
                    message: `Unable to open '${uri.toString()}': ${reason}`,
                    modal: false,
                    items: [],
                });
            }),
        );
    }
}
