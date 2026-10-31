import { describe, expect, it } from "vitest";

import { contextFor, ENVIRONMENTS, registerBuiltins } from "../../../../../TestUtils/builtinKeybindings.ts";
import type { KeyboardEventLike } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

function key(spec: { key: string; ctrl?: boolean; shift?: boolean; meta?: boolean }): KeyboardEventLike {
    return {
        key: spec.key,
        ctrlKey: spec.ctrl === true,
        shiftKey: spec.shift === true,
        altKey: false,
        metaKey: spec.meta === true,
    };
}

const CTRL_P = key({ key: "p", ctrl: true });
const CTRL_E = key({ key: "e", ctrl: true });
const CTRL_SHIFT_P = key({ key: "P", ctrl: true, shift: true });
const CTRL_SHIFT_E = key({ key: "E", ctrl: true, shift: true });

const PC_LEGACY = ENVIRONMENTS[0];
const PC_KITTY = ENVIRONMENTS[2];
const MAC_LEGACY = ENVIRONMENTS[3];
const MAC_CMD = ENVIRONMENTS[6];

function commandFor(event: KeyboardEventLike, ...args: Parameters<typeof contextFor>): string | null {
    const resolution = registerBuiltins().resolveKey(event, contextFor(...args));
    return resolution.kind === "command" ? resolution.commandId : null;
}

describe("quick open keybindings", () => {
    it("Ctrl+P and Ctrl+E open Quick Open on Linux/Windows, from the editor and from the terminal", () => {
        const focuses: Readonly<Record<string, boolean>>[] = [
            { textInputFocus: true, editorAreaFocus: true },
            { terminalFocus: true },
        ];
        for (const focus of focuses) {
            expect(commandFor(CTRL_P, PC_KITTY, focus)).toBe("workbench.action.quickOpen");
            expect(commandFor(CTRL_E, PC_KITTY, focus)).toBe("workbench.action.quickOpen");
            expect(commandFor(CTRL_E, PC_LEGACY, focus)).toBe("workbench.action.quickOpen");
        }
    });

    it("on the Mac Ctrl+E stays End of Line, Quick Open has no second binding", () => {
        const editor = { textInputFocus: true, textViewFocus: true, editorAreaFocus: true };
        expect(commandFor(CTRL_E, MAC_LEGACY, editor)).toBe("cursorLineEnd");
        expect(commandFor(CTRL_E, MAC_CMD, {})).not.toBe("workbench.action.quickOpen");
        expect(commandFor(key({ key: "p", meta: true }), MAC_CMD, {})).toBe("workbench.action.quickOpen");
    });

    it("inside the files picker Ctrl+P / Ctrl+E step down, with Shift up", () => {
        const picker = { inQuickOpen: true, inFilesPicker: true, inputWidgetFocus: true };
        expect(commandFor(CTRL_P, PC_KITTY, picker)).toBe("workbench.action.quickOpenNavigateNextInFilePicker");
        expect(commandFor(CTRL_E, PC_KITTY, picker)).toBe("workbench.action.quickOpenNavigateNextInFilePicker");
        expect(commandFor(CTRL_SHIFT_P, PC_KITTY, picker)).toBe(
            "workbench.action.quickOpenNavigatePreviousInFilePicker",
        );
        expect(commandFor(CTRL_SHIFT_E, PC_KITTY, picker)).toBe(
            "workbench.action.quickOpenNavigatePreviousInFilePicker",
        );
        // A legacy terminal sends Ctrl+Shift+P as Ctrl+P: only the forward step is bound there.
        expect(commandFor(CTRL_E, PC_LEGACY, picker)).toBe("workbench.action.quickOpenNavigateNextInFilePicker");
        expect(commandFor(CTRL_SHIFT_E, PC_LEGACY, picker)).not.toBe(
            "workbench.action.quickOpenNavigatePreviousInFilePicker",
        );
    });

    it("Escape and Shift+Escape in a quick input are closeQuickOpen, a dialog over it keeps its own", () => {
        const input = { inQuickOpen: true, inputWidgetFocus: true };
        const close = "workbench.action.closeQuickOpen";
        expect(commandFor(key({ key: "Escape" }), PC_KITTY, input)).toBe(close);
        expect(commandFor(key({ key: "Escape", shift: true }), PC_KITTY, input)).toBe(close);
        expect(commandFor(key({ key: "Escape" }), PC_KITTY, { inQuickOpen: true })).not.toBe(close);
        expect(commandFor(key({ key: "Escape" }), PC_KITTY, { inputWidgetFocus: true })).not.toBe(close);
    });

    it("in the command palette mode Ctrl+Shift+P is the palette again, not navigation", () => {
        const palette = { inQuickOpen: true, inFilesPicker: false, inputWidgetFocus: true };
        expect(commandFor(CTRL_SHIFT_P, PC_KITTY, palette)).toBe("workbench.action.showCommands");
        expect(commandFor(CTRL_P, PC_KITTY, palette)).toBe("workbench.action.quickOpen");
    });
});
