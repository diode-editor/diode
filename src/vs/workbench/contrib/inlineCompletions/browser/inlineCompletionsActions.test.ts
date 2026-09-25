import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
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
        // Escape у hide: кроме показанного призрака — ещё и окно ожидания
        // ответа провайдера (там гасить нечего, но отменять есть что).
        expect(hideInlineSuggestAction.when).toBe(
            "inlineSuggestionVisible || (inlineSuggestionRequestPending && textInputFocus)",
        );
        expect(triggerInlineSuggestAction.when).toBe("textInputFocus && !editorReadonly");
    });

    it("when у hide проходит и на показанном призраке, и на запросе в полёте — но не вне редактора", () => {
        const keys = new ContextKeyService();
        const passes = (): boolean => keys.evaluate(hideInlineSuggestAction.when!);

        expect(passes()).toBe(false);

        keys.set("inlineSuggestionVisible", true);
        expect(passes()).toBe(true);

        // Запрос в полёте: призрака ещё нет, но Escape обязан доехать до отмены.
        keys.set("inlineSuggestionVisible", false);
        keys.set("inlineSuggestionRequestPending", true);
        keys.set("textInputFocus", true);
        expect(passes()).toBe(true);

        // Фокус ушёл из текста (find-виджет, квик-пик) — Escape там не наш.
        keys.set("textInputFocus", false);
        expect(passes()).toBe(false);
    });

    it("биндинги: Tab у commit, Escape у hide, Alt+\\ у trigger", () => {
        expect(keybindingOf(commitInlineSuggestAction)).toBe("Tab");
        expect(keybindingOf(hideInlineSuggestAction)).toBe("Escape");
        // Комбинация Copilot'а (в ядре vscode клавиши у команды нет). В редакторе
        // горячих клавиш она обязана показаться ровно так — колонка Keybinding.
        expect(keybindingOf(triggerInlineSuggestAction)).toBe("Alt+\\");
    });

    it("Alt+\\ разбирается в тот же keydown, что шлёт терминал (ESC + \\)", () => {
        // Терминал отдаёт Alt+пунктуация как ESC-префикс, tuidom разбирает это
        // в `{key: "\\", altKey: true}` — бинд обязан совпасть побайтно, иначе
        // команда не резолвится (грабля непереносимых комбинаций).
        expect(triggerInlineSuggestAction.keybinding).toEqual({
            key: "\\",
            ctrlKey: false,
            shiftKey: false,
            altKey: true,
            metaKey: false,
        });
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
