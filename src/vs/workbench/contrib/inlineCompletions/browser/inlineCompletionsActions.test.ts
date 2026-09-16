import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import {
    commitInlineSuggestAction,
    hideInlineSuggestAction,
    triggerInlineSuggestAction,
} from "./inlineCompletionsActions.ts";
import type { InlineCompletionsService } from "./inlineCompletionsService.ts";
import { InlineCompletionsServiceDIToken } from "./inlineCompletionsService.ts";

/** Контейнер с фейком ровно того сервиса, который дёргают эти экшены. */
function makeAccessor(): { accessor: Container; calls: string[] } {
    const calls: string[] = [];
    const accessor = new Container();
    accessor.bind(
        InlineCompletionsServiceDIToken,
        () =>
            ({
                trigger: (kind: number) => {
                    calls.push(`trigger:${String(kind)}`);
                    return Promise.resolve();
                },
                acceptCurrent: () => calls.push("accept"),
                hide: () => calls.push("hide"),
            }) as unknown as InlineCompletionsService,
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

describe("inlineCompletionsActions — объявления", () => {
    it("id команд и ключи when — дословно VS Code", () => {
        expect(triggerInlineSuggestAction.id).toBe("editor.action.inlineSuggest.trigger");
        expect(commitInlineSuggestAction.id).toBe("editor.action.inlineSuggest.commit");
        expect(hideInlineSuggestAction.id).toBe("editor.action.inlineSuggest.hide");

        // Tab у commit: гейты — попап побеждает, подсказка «с отступа» при
        // каретке в отступе Tab не крадёт.
        expect(commitInlineSuggestAction.when).toBe(
            "inlineSuggestionVisible && !suggestWidgetVisible && inlineSuggestionHasIndentationLessThanTabSize",
        );
        expect(hideInlineSuggestAction.when).toBe("inlineSuggestionVisible");
        expect(triggerInlineSuggestAction.when).toBe("textInputFocus && !editorReadonly");
    });

    it("биндинги: Tab у commit, Escape у hide, trigger без бинда", () => {
        expect(keybindingOf(commitInlineSuggestAction)).toBe("Tab");
        expect(keybindingOf(hideInlineSuggestAction)).toBe("Escape");
        expect(keybindingOf(triggerInlineSuggestAction)).toBeUndefined();
    });
});

describe("inlineCompletionsActions — run-обработчики", () => {
    it("делегируют в InlineCompletionsService", () => {
        const { accessor, calls } = makeAccessor();
        triggerInlineSuggestAction.run(accessor);
        commitInlineSuggestAction.run(accessor);
        hideInlineSuggestAction.run(accessor);
        // trigger шлёт явный Invoke (0).
        expect(calls).toEqual(["trigger:0", "accept", "hide"]);
    });
});
