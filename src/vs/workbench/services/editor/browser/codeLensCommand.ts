import { describeRejection } from "../../../../base/common/describeRejection.ts";
import type { CodeLensCommand } from "../../../../editor/common/languages/iCodeLensSource.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { NotificationService } from "../../notification/browser/notificationService.ts";

/**
 * Upstream `commandService.executeCommand(...).catch(notificationService.error)`. Our registry answers an unknown
 * id with `undefined`, so that case is checked here, in upstream's wording.
 */
export async function runCodeLensCommand(
    commands: CommandRegistry | undefined,
    notifications: NotificationService | undefined,
    command: CodeLensCommand,
): Promise<void> {
    const fail = (message: string): void => {
        notifications?.show({ severity: "error", message, modal: false, items: [] });
    };
    const { run } = command;
    if (run === undefined && commands?.has(command.id) !== true) {
        fail(`command '${command.id}' not found`);
        return;
    }
    try {
        await (run === undefined ? commands?.execute(command.id, ...(command.arguments ?? [])) : run());
    } catch (error) {
        fail(describeRejection(error));
    }
}
