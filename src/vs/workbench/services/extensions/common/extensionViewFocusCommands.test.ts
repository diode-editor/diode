import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import { registerExtensionViewFocusCommands } from "./extensionViewFocusCommands.ts";

function extension(id: string, manifest: Partial<IExtensionManifest>): IExtension {
    return { id, manifest: { name: id, publisher: "test", version: "0.0.1", ...manifest } } as unknown as IExtension;
}

function setup(extensions: readonly IExtension[]): {
    commands: CommandRegistry;
    messages: string[];
    log: string[];
    dispose: () => void;
} {
    const commands = new CommandRegistry();
    const messages: string[] = [];
    const log: string[] = [];
    const logger = { info: (line: string) => log.push(line) } as unknown as ILogger;
    const disposable = registerExtensionViewFocusCommands(
        extensions,
        commands,
        (message) => messages.push(message),
        logger,
    );
    return {
        commands,
        messages,
        log,
        dispose: () => {
            disposable.dispose();
        },
    };
}

describe("registerExtensionViewFocusCommands", () => {
    it("every view gets `<id>.focus`; running it tells the user why the view is missing and does not throw", () => {
        const { commands, messages } = setup([
            extension("acme.chat", {
                displayName: "Acme Chat",
                contributes: {
                    views: {
                        "acme-chat": [{ id: "acme.chatView", name: "chat", type: "webview" }],
                        explorer: [{ id: "acme.outline", name: "Outline" }],
                    },
                },
            }),
        ]);

        expect(commands.execute("acme.chatView.focus")).toBeUndefined();
        commands.execute("acme.outline.focus");
        expect(messages).toEqual([
            `Acme Chat: view "chat" is a webview — webviews can't be shown in the terminal`,
            `Acme Chat: view "Outline" can't be shown — extension views aren't supported yet`,
        ]);
        expect(commands.listCommands()).toEqual([]);
    });

    it("without displayName and name — extension id and view id; empty strings count as missing", () => {
        const { commands, messages } = setup([
            extension("acme.tree", {
                displayName: "",
                contributes: { views: { explorer: [{ id: "acme.tree.view", name: "" }] } },
            }),
            extension("acme.bare", { contributes: { views: { explorer: [{ id: "acme.bare.view" }] } } }),
        ]);

        commands.execute("acme.tree.view.focus");
        commands.execute("acme.bare.view.focus");
        expect(messages).toEqual([
            `acme.tree: view "acme.tree.view" can't be shown — extension views aren't supported yet`,
            `acme.bare: view "acme.bare.view" can't be shown — extension views aren't supported yet`,
        ]);
    });

    it("manifest junk — a log line and skip; someone else's existing command is not overridden", () => {
        const commands = new CommandRegistry();
        const builtin: string[] = [];
        commands.register("taken.focus", () => builtin.push("builtin"));
        const messages: string[] = [];
        const log: string[] = [];
        registerExtensionViewFocusCommands(
            [
                extension("acme.junk", {
                    contributes: {
                        views: {
                            broken: "not-a-list" as never,
                            explorer: [{ name: "no id" } as never, { id: "" }, { id: "taken" }],
                        },
                    },
                }),
                extension("acme.none", {}),
            ],
            commands,
            (message) => messages.push(message),
            { info: (line: string) => log.push(line) } as unknown as ILogger,
        );

        commands.execute("taken.focus");
        expect(builtin).toEqual(["builtin"]);
        expect(messages).toEqual([]);
        expect(log).toEqual([
            `acme.junk: view without id in container "explorer", skipped`,
            `acme.junk: view without id in container "explorer", skipped`,
        ]);
        expect(commands.has(".focus")).toBe(false);
    });

    it("without a logger a junk view is skipped silently, the neighbouring view gets a command", () => {
        const commands = new CommandRegistry();
        registerExtensionViewFocusCommands(
            [extension("acme.junk", { contributes: { views: { c: [{ id: "" }, { id: "ok" }] } } })],
            commands,
            () => undefined,
        );
        expect(commands.has("ok.focus")).toBe(true);
    });

    it("dispose removes all created commands", () => {
        const { commands, dispose } = setup([
            extension("acme.chat", { contributes: { views: { c: [{ id: "a" }, { id: "b" }] } } }),
        ]);
        expect([commands.has("a.focus"), commands.has("b.focus")]).toEqual([true, true]);
        dispose();
        expect([commands.has("a.focus"), commands.has("b.focus")]).toEqual([false, false]);
    });
});
