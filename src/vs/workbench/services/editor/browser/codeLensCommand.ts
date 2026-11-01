import { describeRejection } from "../../../../base/common/describeRejection.ts";
import type { CodeLensCommand } from "../../../../editor/common/languages/iCodeLensSource.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { NotificationService } from "../../notification/browser/notificationService.ts";

/**
 * What a person reads, as upstream's `notificationService.error`: the message, not the stack. Nothing thrown is no toast.
 * An error from the subprocess has an empty `stack` when a non-`Error` was thrown, its text is in `message`.
 */
function failureMessage(error: unknown): string | null {
    if (error === undefined || error === null) return null;
    if (error instanceof Error) return error.message === "" ? error.name : error.message;
    return describeRejection(error);
}

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
    const known = commands?.has(command.id) === true ? commands : null;
    if (command.run === undefined && known === null) {
        fail(`command '${command.id}' not found`);
        return;
    }
    try {
        // Stryker disable next-line OptionalChaining: without `run` the check above has left `known` set; the type cannot see it
        await (command.run?.() ?? known?.execute(command.id, ...(command.arguments ?? [])));
    } catch (error) {
        const message = failureMessage(error);
        if (message !== null) fail(message);
    }
}
