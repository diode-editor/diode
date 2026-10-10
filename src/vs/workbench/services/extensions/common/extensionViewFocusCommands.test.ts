import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import { registerExtensionViewFocusCommands } from "./extensionViewFocusCommands.ts";

// Герметичный контракт `contributes.views` → команды `<вид>.focus`: синтетические
// манифесты, настоящий реестр команд. Стоковое расширение (Supermaven, чат —
// webview-вид) закрывает ту же дверь e2e-сценарием.

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
    it("у каждого вида — `<id>.focus`; исполнение говорит человеку, почему вида нет, и не бросает", () => {
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
        // В палитру не попадают: без заголовка (см. отступление в шапке модуля).
        expect(commands.listCommands()).toEqual([]);
    });

    it("без displayName и name — id расширения и id вида; пустые строки — как отсутствие", () => {
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

    it("мусор манифеста — строка в лог и пропуск; чужая готовая команда не перебивается", () => {
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
            `acme.junk: вид без id в контейнере "explorer" — пропущен`,
            `acme.junk: вид без id в контейнере "explorer" — пропущен`,
        ]);
        expect(commands.has(".focus")).toBe(false);
    });

    it("без логгера мусорный вид пропускается молча, соседний вид получает команду", () => {
        const commands = new CommandRegistry();
        registerExtensionViewFocusCommands(
            [extension("acme.junk", { contributes: { views: { c: [{ id: "" }, { id: "ok" }] } } })],
            commands,
            () => undefined,
        );
        expect(commands.has("ok.focus")).toBe(true);
    });

    it("dispose снимает все заведённые команды", () => {
        const { commands, dispose } = setup([
            extension("acme.chat", { contributes: { views: { c: [{ id: "a" }, { id: "b" }] } } }),
        ]);
        expect([commands.has("a.focus"), commands.has("b.focus")]).toEqual([true, true]);
        dispose();
        expect([commands.has("a.focus"), commands.has("b.focus")]).toEqual([false, false]);
    });
});
