import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { NotificationService } from "../../notification/browser/notificationService.ts";

import { runCodeLensCommand } from "./codeLensCommand.ts";

function setup() {
    const commands = new CommandRegistry();
    const show = vi.fn();
    return { commands, show, notifications: { show } as unknown as NotificationService };
}

describe("runCodeLensCommand", () => {
    it("runs the command with its arguments, and no toast", async () => {
        const { commands, notifications, show } = setup();
        const handler = vi.fn();
        commands.register("cmd", handler);
        await runCodeLensCommand(commands, notifications, { id: "cmd", title: "t", arguments: [1, "two"] });
        expect(handler).toHaveBeenCalledWith(1, "two");
        expect(show).not.toHaveBeenCalled();
    });

    it("a command with its own way to run goes there, the registry does not need to know it", async () => {
        const { commands, notifications, show } = setup();
        const handler = vi.fn();
        commands.register("cmd", handler);
        const run = vi.fn(() => Promise.resolve());
        await runCodeLensCommand(commands, notifications, { id: "cmd", title: "t", run });
        await runCodeLensCommand(commands, notifications, { id: "unknown", title: "t", run });
        expect(run).toHaveBeenCalledTimes(2);
        expect(handler).not.toHaveBeenCalled();
        expect(show).not.toHaveBeenCalled();
    });

    it("the failure of its own way to run is a toast with the message", async () => {
        const { commands, notifications, show } = setup();
        await runCodeLensCommand(commands, notifications, {
            id: "cmd",
            title: "t",
            run: () => Promise.reject(new Error("command exploded")),
        });
        expect(show).toHaveBeenCalledWith({
            severity: "error",
            message: expect.stringContaining("command exploded") as string,
            modal: false,
            items: [],
        });
    });

    it("runs a command without arguments", async () => {
        const { commands, notifications } = setup();
        const handler = vi.fn();
        commands.register("cmd", handler);
        await runCodeLensCommand(commands, notifications, { id: "cmd", title: "t" });
        expect(handler).toHaveBeenCalledWith();
    });

    it("an unknown command is an error toast", async () => {
        const { commands, notifications, show } = setup();
        await runCodeLensCommand(commands, notifications, { id: "nope", title: "t" });
        expect(show).toHaveBeenCalledWith({
            severity: "error",
            message: "command 'nope' not found",
            modal: false,
            items: [],
        });
    });

    it.each([
        [
            "throws",
            () => {
                throw new Error("boom");
            },
        ],
        ["rejects", () => Promise.reject(new Error("boom"))],
    ])("a command that %s is an error toast with its text", async (_name, handler) => {
        const { commands, notifications, show } = setup();
        commands.register("cmd", handler);
        await runCodeLensCommand(commands, notifications, { id: "cmd", title: "t" });
        const shown = show.mock.lastCall?.[0] as { severity: string; message: string };
        expect(shown.severity).toBe("error");
        expect(shown.message).toContain("boom");
    });

    it("without the services nothing throws", async () => {
        await expect(runCodeLensCommand(undefined, undefined, { id: "cmd", title: "t" })).resolves.toBeUndefined();
    });
});
