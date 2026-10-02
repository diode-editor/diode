import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { CommandsQuickAccessProvider } from "./commandsQuickAccessProvider.ts";

function createProvider(): { provider: CommandsQuickAccessProvider; commands: CommandRegistry } {
    const commands = new CommandRegistry();
    const provider = new CommandsQuickAccessProvider(commands, new KeybindingRegistry(), new ContextKeyService());
    return { provider, commands };
}

function labels(provider: CommandsQuickAccessProvider, query: string): string[] {
    return provider.getItems(`>${query}`).map((item) => item.label);
}

describe("CommandsQuickAccessProvider — префикс категории", () => {
    it("команда с категорией рисуется как «Category: Title» (эталон VS Code)", () => {
        const { provider, commands } = createProvider();
        commands.register("java.server.mode.switch", () => undefined, "Switch to Standard Mode", undefined, "Java");

        expect(labels(provider, "")).toEqual(["Java: Switch to Standard Mode"]);
    });

    it("без категории подпись — сам заголовок", () => {
        const { provider, commands } = createProvider();
        commands.register("java.open.serverLog", () => undefined, "Open Java Language Server Log File");

        expect(labels(provider, "")).toEqual(["Open Java Language Server Log File"]);
    });

    it("пустая категория префикса не даёт", () => {
        const { provider, commands } = createProvider();
        commands.register("x.y", () => undefined, "Do It", undefined, "");

        expect(labels(provider, "")).toEqual(["Do It"]);
    });

    it("фильтр матчит по категории — `java` находит всю группу", () => {
        const { provider, commands } = createProvider();
        commands.register("java.clean", () => undefined, "Clean Workspace", undefined, "Java");
        commands.register("files.save", () => undefined, "Save", undefined, "File");

        expect(labels(provider, "java")).toEqual(["Java: Clean Workspace"]);
    });

    it("фильтр матчит и по заголовку, и по склейке с категорией", () => {
        const { provider, commands } = createProvider();
        commands.register("java.clean", () => undefined, "Clean Workspace", undefined, "Java");

        expect(labels(provider, "clean workspace")).toEqual(["Java: Clean Workspace"]);
        expect(labels(provider, "java: clean")).toEqual(["Java: Clean Workspace"]);
        expect(labels(provider, "python")).toEqual([]);
    });

    it("accept исполняет команду по id, а не по подписи", () => {
        const { provider, commands } = createProvider();
        let ran = 0;
        commands.register(
            "java.clean",
            () => {
                ran++;
            },
            "Clean Workspace",
            undefined,
            "Java",
        );

        const items = provider.getItems(">java");
        expect(items).toHaveLength(1);
        items[0].accept?.();

        expect(ran).toBe(1);
    });

    it("команда без заголовка в палитре не показывается даже с категорией", () => {
        const { provider, commands } = createProvider();
        commands.register("java.internal", () => undefined, undefined, undefined, "Java");

        expect(labels(provider, "")).toEqual([]);
    });
});
