import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { KeybindingRegistry, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { KEYBINDINGS_EDITOR_SCHEME, KeybindingsEditorPane, keybindingsEditorUri } from "./keybindingsEditorPane.ts";

function makePane(): KeybindingsEditorPane {
    const keybindings = new KeybindingRegistry();
    const commands = new CommandRegistry();
    commands.register("save", () => {}, "Save File");
    commands.register("hover", () => {}, "Show Hover");
    commands.register("unbound", () => {}, "Never Bound");
    keybindings.register(parseChord("ctrl+s"), "save");
    keybindings.register(parseChord("ctrl+k ctrl+u"), "hover", "textViewFocus", "extension");
    return new KeybindingsEditorPane(keybindings, commands);
}

function typeQuery(pane: KeybindingsEditorPane, text: string): void {
    const input = pane.view.querySelectorAll("InputElement")[0] as InputElement;
    input.inputState.value = text;
    input.onChange?.(text);
}

describe("KeybindingsEditorPane — контракт вкладки", () => {
    it("read-only вкладка с фиксированной идентичностью", () => {
        const pane = makePane();

        expect(pane.uri.toString()).toBe(keybindingsEditorUri().toString());
        expect(pane.uri.scheme).toBe(KEYBINDINGS_EDITOR_SCHEME);
        expect(pane.label).toBe("Keyboard Shortcuts");
        expect(pane.readOnly).toBe(true);
        expect(pane.isModified).toBe(false);
        expect(pane.getSelectedTexts()).toEqual([]);
    });

    it("onDidChangeState отдаёт отписываемую заглушку", () => {
        const pane = makePane();

        expect(() => {
            pane.onDidChangeState().dispose();
        }).not.toThrow();
    });

    it("focusEditor ставит фокус в строку поиска", () => {
        const pane = makePane();
        const input = pane.view.querySelectorAll("InputElement")[0] as InputElement;
        const focusSpy = vi.spyOn(input, "focus").mockImplementation(() => {});

        pane.focusEditor();

        expect(focusSpy).toHaveBeenCalledOnce();
    });
});

describe("KeybindingsEditorPane — кадр", () => {
    it("первый кадр полон: шапка колонок и строки биндингов", () => {
        const pane = makePane();

        const screen = renderElement(pane.view, 80, 12, { themeVars: true }).screenToString();

        expect(screen).toContain("Command");
        expect(screen).toContain("Keybinding");
        expect(screen).toContain("Save File");
        expect(screen).toContain("Ctrl+S");
        expect(screen).toContain("Show Hover");
        expect(screen).toContain("Extension");
        // Команда без биндинга — тоже строка, с тире вместо клавиши.
        expect(screen).toContain("Never Bound");
    });

    it("набор в строку поиска фильтрует список", () => {
        const pane = makePane();
        renderElement(pane.view, 80, 12, { themeVars: true });

        typeQuery(pane, "hover");
        const screen = renderElement(pane.view, 80, 12, { themeVars: true }).screenToString();

        expect(screen).toContain("Show Hover");
        expect(screen).not.toContain("Save File");
    });

    it("набор до первой раскладки не падает: строки соберёт первый кадр", () => {
        const pane = makePane();

        typeQuery(pane, "hover");
        const screen = renderElement(pane.view, 80, 12, { themeVars: true }).screenToString();

        expect(screen).toContain("Show Hover");
        expect(screen).not.toContain("Save File");
    });

    it("пустой результат фильтра показывает заглушку", () => {
        const pane = makePane();
        renderElement(pane.view, 80, 12, { themeVars: true });

        typeQuery(pane, "zzzzzz");
        const screen = renderElement(pane.view, 80, 12, { themeVars: true }).screenToString();

        expect(screen).toContain("No keybindings found");
    });

    it("смена ширины пересобирает колонки под новую ширину", () => {
        const pane = makePane();
        const wide = renderElement(pane.view, 100, 12, { themeVars: true }).screenToString();
        const narrow = renderElement(pane.view, 60, 12, { themeVars: true }).screenToString();

        const headerLine = (screen: string): string => screen.split("\n").find((line) => line.includes("Keybinding"))!;
        const sourceColumnWide = headerLine(wide).indexOf("Source");
        const sourceColumnNarrow = headerLine(narrow).indexOf("Source");
        expect(sourceColumnWide).toBeGreaterThan(sourceColumnNarrow);
    });
});
