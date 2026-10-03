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

describe("CommandsQuickAccessProvider — fuzzy-фильтр", () => {
    it("`go line` находит «Go to Line/Column...» (подстрочный поиск не находил ничего)", () => {
        const { provider, commands } = createProvider();
        commands.register("workbench.action.gotoLine", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "go line")).toEqual(["Go to Line/Column..."]);
    });

    it("`toggle panel` находит «Toggle Panel Visibility»", () => {
        const { provider, commands } = createProvider();
        commands.register(
            "workbench.action.togglePanel",
            () => undefined,
            "Toggle Panel Visibility",
            undefined,
            "View",
        );

        expect(labels(provider, "toggle panel")).toEqual(["View: Toggle Panel Visibility"]);
    });

    it("термы матчатся в любом порядке", () => {
        const { provider, commands } = createProvider();
        commands.register("workbench.action.gotoLine", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "line go")).toEqual(["Go to Line/Column..."]);
    });

    it("найтись обязаны ВСЕ термы", () => {
        const { provider, commands } = createProvider();
        commands.register("workbench.action.gotoLine", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "go zebra")).toEqual([]);
    });

    it("несколько пробелов подряд и хвостовой пробел ничего не меняют", () => {
        const { provider, commands } = createProvider();
        commands.register("workbench.action.gotoLine", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "go  line")).toEqual(["Go to Line/Column..."]);
        expect(labels(provider, "go line ")).toEqual(["Go to Line/Column..."]);
        expect(labels(provider, " go line")).toEqual(["Go to Line/Column..."]);
    });

    it("запрос из одних пробелов отдаёт весь список, а не пустой", () => {
        const { provider, commands } = createProvider();
        commands.register("a.b", () => undefined, "Save");

        expect(labels(provider, "   ")).toEqual(["Save"]);
    });

    it("fuzzy, а не подстрока: буквы могут идти с разрывами", () => {
        const { provider, commands } = createProvider();
        commands.register("a.b", () => undefined, "Toggle Word Wrap");

        expect(labels(provider, "twwrap")).toEqual(["Toggle Word Wrap"]);
    });
});

describe("CommandsQuickAccessProvider — порядок и подсветка", () => {
    it("лучшее совпадение идёт первым, а не в порядке регистрации", () => {
        const { provider, commands } = createProvider();
        // Совпадение по серёдке слов регистрируем ПЕРВЫМ, чтобы порядок реестра
        // не мог случайно совпасть с порядком по очкам.
        commands.register("a.b", () => undefined, "Toggle Goal Baseline");
        commands.register("c.d", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "go line")).toEqual(["Go to Line/Column...", "Toggle Goal Baseline"]);
    });

    it("пустой запрос сохраняет порядок реестра (сортировка стабильная)", () => {
        const { provider, commands } = createProvider();
        commands.register("a.b", () => undefined, "Zebra");
        commands.register("c.d", () => undefined, "Apple");

        expect(labels(provider, "")).toEqual(["Zebra", "Apple"]);
    });

    it("подсвечиваются совпавшие куски подписи — по куску на терм", () => {
        const { provider, commands } = createProvider();
        commands.register("c.d", () => undefined, "Go Line");

        // "Go Line": `go` → 0..1, `line` → 3..6.
        expect(provider.getItems(">go line")[0].labelMatchRanges).toEqual([
            [0, 2],
            [3, 7],
        ]);
    });

    it("у пустого запроса подсветки нет", () => {
        const { provider, commands } = createProvider();
        commands.register("c.d", () => undefined, "Go Line");

        expect(provider.getItems(">")[0].labelMatchRanges).toEqual([]);
    });
});
