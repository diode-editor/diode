import { describe, expect, it } from "vitest";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

import { CommandsQuickAccessProvider } from "./commandsQuickAccessProvider.ts";

function createProvider() {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const menus = new MenuRegistry(commands, keybindings, contextKeys, []);
    const active: { languageId: string | undefined } = { languageId: undefined };
    const editors = {
        getActiveEditor: () =>
            active.languageId === undefined ? null : ({ languageId: active.languageId } as TextEditorPane),
    };
    const provider = new CommandsQuickAccessProvider(commands, keybindings, contextKeys, menus, editors);
    return { provider, commands, menus, contextKeys, active };
}

function labels(provider: CommandsQuickAccessProvider, query: string): string[] {
    return provider.getItems(`>${query}`).map((item) => item.label);
}

describe("CommandsQuickAccessProvider — category prefix", () => {
    it("a command with a category renders as `Category: Title` (upstream VS Code)", () => {
        const { provider, commands } = createProvider();
        commands.register("java.server.mode.switch", () => undefined, "Switch to Standard Mode", undefined, "Java");

        expect(labels(provider, "")).toEqual(["Java: Switch to Standard Mode"]);
    });

    it("without a category the label is the title itself", () => {
        const { provider, commands } = createProvider();
        commands.register("java.open.serverLog", () => undefined, "Open Java Language Server Log File");

        expect(labels(provider, "")).toEqual(["Open Java Language Server Log File"]);
    });

    it("an empty category yields no prefix", () => {
        const { provider, commands } = createProvider();
        commands.register("x.y", () => undefined, "Do It", undefined, "");

        expect(labels(provider, "")).toEqual(["Do It"]);
    });

    it("the filter matches on the category — `java` finds the whole group", () => {
        const { provider, commands } = createProvider();
        commands.register("java.clean", () => undefined, "Clean Workspace", undefined, "Java");
        commands.register("files.save", () => undefined, "Save", undefined, "File");

        expect(labels(provider, "java")).toEqual(["Java: Clean Workspace"]);
    });

    it("the filter matches both on the title and on the category-joined label", () => {
        const { provider, commands } = createProvider();
        commands.register("java.clean", () => undefined, "Clean Workspace", undefined, "Java");

        expect(labels(provider, "clean workspace")).toEqual(["Java: Clean Workspace"]);
        expect(labels(provider, "java: clean")).toEqual(["Java: Clean Workspace"]);
        expect(labels(provider, "python")).toEqual([]);
    });

    it("accept runs the command by id, not by label", () => {
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

    it("a command without a title is not shown in the palette even with a category", () => {
        const { provider, commands } = createProvider();
        commands.register("java.internal", () => undefined, undefined, undefined, "Java");

        expect(labels(provider, "")).toEqual([]);
    });
});

describe("CommandsQuickAccessProvider — fuzzy filter", () => {
    it("`go line` finds `Go to Line/Column...` (substring search found nothing)", () => {
        const { provider, commands } = createProvider();
        commands.register("workbench.action.gotoLine", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "go line")).toEqual(["Go to Line/Column..."]);
    });

    it("`toggle panel` finds `Toggle Panel Visibility`", () => {
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

    it("terms match in any order", () => {
        const { provider, commands } = createProvider();
        commands.register("workbench.action.gotoLine", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "line go")).toEqual(["Go to Line/Column..."]);
    });

    it("ALL terms must be found", () => {
        const { provider, commands } = createProvider();
        commands.register("workbench.action.gotoLine", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "go zebra")).toEqual([]);
    });

    it("repeated spaces and a trailing space change nothing", () => {
        const { provider, commands } = createProvider();
        commands.register("workbench.action.gotoLine", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "go  line")).toEqual(["Go to Line/Column..."]);
        expect(labels(provider, "go line ")).toEqual(["Go to Line/Column..."]);
        expect(labels(provider, " go line")).toEqual(["Go to Line/Column..."]);
    });

    it("a whitespace-only query returns the whole list, not an empty one", () => {
        const { provider, commands } = createProvider();
        commands.register("a.b", () => undefined, "Save");

        expect(labels(provider, "   ")).toEqual(["Save"]);
    });

    it("fuzzy, not substring: letters may have gaps", () => {
        const { provider, commands } = createProvider();
        commands.register("a.b", () => undefined, "Toggle Word Wrap");

        expect(labels(provider, "twwrap")).toEqual(["Toggle Word Wrap"]);
    });
});

describe("CommandsQuickAccessProvider — order and highlights", () => {
    it("the best match comes first, not in registration order", () => {
        const { provider, commands } = createProvider();
        // Register the mid-word match FIRST so registry order can't
        // coincide with score order by accident.
        commands.register("a.b", () => undefined, "Toggle Goal Baseline");
        commands.register("c.d", () => undefined, "Go to Line/Column...");

        expect(labels(provider, "go line")).toEqual(["Go to Line/Column...", "Toggle Goal Baseline"]);
    });

    it("an empty query keeps the registry order (stable sort)", () => {
        const { provider, commands } = createProvider();
        commands.register("a.b", () => undefined, "Zebra");
        commands.register("c.d", () => undefined, "Apple");

        expect(labels(provider, "")).toEqual(["Zebra", "Apple"]);
    });

    it("the matched parts of the label are highlighted — one part per term", () => {
        const { provider, commands } = createProvider();
        commands.register("c.d", () => undefined, "Go Line");

        expect(provider.getItems(">go line")[0].labelMatchRanges).toEqual([
            [0, 2],
            [3, 7],
        ]);
    });

    it("an empty query has no highlights", () => {
        const { provider, commands } = createProvider();
        commands.register("c.d", () => undefined, "Go Line");

        expect(provider.getItems(">")[0].labelMatchRanges).toEqual([]);
    });
});

describe("CommandsQuickAccessProvider — commandPalette items", () => {
    it("a command with palette items is listed only while one of their when holds", () => {
        const { provider, commands, menus, contextKeys, active } = createProvider();
        commands.register("javascript.goToProjectConfig", () => undefined, "Go to Project", undefined, "JavaScript");
        commands.register("files.save", () => undefined, "Save", undefined, "File");
        for (const when of ["editorLangId == javascript", "editorLangId == javascriptreact"]) {
            menus.appendMenuItem({ menuId: MenuId.CommandPalette, command: "javascript.goToProjectConfig", when });
        }
        contextKeys.set("gitHasRepo", true);
        menus.appendMenuItem({ menuId: MenuId.CommandPalette, command: "files.save", when: "gitHasRepo" });

        expect(labels(provider, "")).toEqual(["File: Save"]);
        active.languageId = "json";
        expect(labels(provider, "")).toEqual(["File: Save"]);
        active.languageId = "javascriptreact";
        expect(labels(provider, "")).toEqual(["JavaScript: Go to Project", "File: Save"]);
    });

    it("editorLangId is the active editor's language, not the focused element's (the palette has the focus)", () => {
        const { provider, commands, menus, contextKeys, active } = createProvider();
        commands.register("javascript.goToProjectConfig", () => undefined, "Go to Project", undefined, "JavaScript");
        menus.appendMenuItem({
            menuId: MenuId.CommandPalette,
            command: "javascript.goToProjectConfig",
            when: "editorLangId == javascript",
        });

        contextKeys.set("editorLangId", "");
        active.languageId = "javascript";
        expect(labels(provider, "")).toEqual(["JavaScript: Go to Project"]);
        contextKeys.set("editorLangId", "javascript");
        active.languageId = "json";
        expect(labels(provider, "")).toEqual([]);
    });

    it("without an active editor editorLangId is empty", () => {
        const { provider, commands, menus } = createProvider();
        commands.register("a.noEditor", () => undefined, "No Editor");
        menus.appendMenuItem({ menuId: MenuId.CommandPalette, command: "a.noEditor", when: "!editorLangId" });

        expect(labels(provider, "")).toEqual(["No Editor"]);
    });

    it("a palette item without when lists the command, `false` hides it", () => {
        const { provider, commands, menus } = createProvider();
        commands.register("a.shown", () => undefined, "Shown");
        commands.register("a.hidden", () => undefined, "Hidden");
        menus.appendMenuItem({ menuId: MenuId.CommandPalette, command: "a.shown" });
        menus.appendMenuItem({ menuId: MenuId.CommandPalette, command: "a.hidden", when: "false" });

        expect(labels(provider, "")).toEqual(["Shown"]);
    });

    it("items of other menus do not narrow the palette", () => {
        const { provider, commands, menus } = createProvider();
        commands.register("a.b", () => undefined, "Do It");
        menus.appendMenuItem({ menuId: MenuId.EditorContext, command: "a.b", when: "false" });
        menus.appendMenuItem({
            menuId: MenuId.CommandPalette,
            submenu: MenuId.EditorTitle,
            title: "Sub",
            when: "false",
        });

        expect(labels(provider, "")).toEqual(["Do It"]);
    });
});
