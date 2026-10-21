import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import {
    closeParameterHintsAction,
    showNextParameterHintAction,
    showPrevParameterHintAction,
    triggerParameterHintsAction,
} from "./parameterHintsActions.ts";
import type { ParameterHintsService } from "./parameterHintsService.ts";
import { ParameterHintsServiceDIToken } from "./parameterHintsService.ts";

function makeAccessor(): { accessor: Container; calls: string[] } {
    const calls: string[] = [];
    const accessor = new Container();
    accessor.bind(
        ParameterHintsServiceDIToken,
        () =>
            ({
                trigger: () => {
                    calls.push("trigger");
                    return Promise.resolve();
                },
                nextSignature: () => calls.push("next"),
                previousSignature: () => calls.push("prev"),
                close: () => calls.push("close"),
            }) as unknown as ParameterHintsService,
    );
    return { accessor, calls };
}

function keybindingOf(action: CommandAction): string | undefined {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    registerAction(commands, keybindings, new Container(), action);
    const bound = keybindings.getKeybindingForCommand(action.id);
    return bound == null ? undefined : formatKeybinding(bound);
}

describe("parameterHintsActions — declarations", () => {
    it("command ids match VS Code", () => {
        expect(triggerParameterHintsAction.id).toBe("editor.action.triggerParameterHints");
        expect(showNextParameterHintAction.id).toBe("showNextParameterHint");
        expect(showPrevParameterHintAction.id).toBe("showPrevParameterHint");
        expect(closeParameterHintsAction.id).toBe("closeParameterHints");
    });

    it("manual trigger: the chord is primary, Ctrl+Shift+Space is the secondary keybinding", () => {
        expect(keybindingOf(triggerParameterHintsAction)).toBe("Ctrl+K Ctrl+Space");
        expect(triggerParameterHintsAction.keybindings).toHaveLength(1);
        expect(triggerParameterHintsAction.when).toBe("textInputFocus");
    });

    it("arrows are captured only while the popup is shown with several signatures", () => {
        expect(keybindingOf(showNextParameterHintAction)).toBe("Down");
        expect(keybindingOf(showPrevParameterHintAction)).toBe("Up");
        expect(showNextParameterHintAction.keybindings).toHaveLength(1);
        expect(showPrevParameterHintAction.keybindings).toHaveLength(1);
        for (const action of [showNextParameterHintAction, showPrevParameterHintAction]) {
            expect(action.when).toBe(
                "parameterHintsVisible && parameterHintsMultipleSignatures && !suggestWidgetVisible",
            );
        }
    });

    it("Escape closes the popup and leaves the editor alone while there is no popup", () => {
        expect(keybindingOf(closeParameterHintsAction)).toBe("Escape");
        expect(closeParameterHintsAction.when).toBe("parameterHintsVisible && !suggestWidgetVisible");
    });
});

describe("parameterHintsActions — delegation", () => {
    it("each action calls its own service method", () => {
        const h = makeAccessor();

        triggerParameterHintsAction.run(h.accessor);
        showNextParameterHintAction.run(h.accessor);
        showPrevParameterHintAction.run(h.accessor);
        closeParameterHintsAction.run(h.accessor);

        expect(h.calls).toEqual(["trigger", "next", "prev", "close"]);
    });
});
