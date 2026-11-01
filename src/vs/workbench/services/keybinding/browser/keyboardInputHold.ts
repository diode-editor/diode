import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

/**
 * Deviation from upstream, where the same version check can drop the edit: while an extension's text editor command
 * has not answered ({@link CommandRegistry.holdInputUntil}), keys wait and then run in the order they were pressed.
 * Otherwise a key typed right after Enter makes the extension's edit stale and the line break is lost (#967).
 *
 * A capture listener on the root, registered before the keybinding dispatcher: a held key reaches nothing, and a
 * replayed one goes the whole way, including the dispatcher swallowing the keypress of a consumed keydown.
 * A replayed plain Tab that nobody handles does not move focus: the engine does that only for its own input.
 */
export function attachKeyboardInputHold(view: TUIElement, commands: CommandRegistry): IDisposable {
    const held: TUIKeyboardEvent[] = [];
    let replaying = false;

    const hold = (event: TUIKeyboardEvent): void => {
        if (replaying || !commands.isInputHeld) return;
        held.push(event);
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    const replay = (): void => {
        // A replayed key can start a new hold, and the rest then wait for that one.
        while (!commands.isInputHeld) {
            const event = held.shift();
            if (event === undefined) return;
            const target = view.getRoot()?.focusManager?.activeElement ?? view;
            replaying = true;
            target.dispatchEvent(
                new TUIKeyboardEvent(event.type as "keydown" | "keypress", {
                    key: event.key,
                    code: event.code,
                    ctrlKey: event.ctrlKey,
                    shiftKey: event.shiftKey,
                    altKey: event.altKey,
                    metaKey: event.metaKey,
                    raw: event.raw,
                }),
            );
            replaying = false;
        }
    };

    view.addEventListener("keydown", hold, { capture: true });
    view.addEventListener("keypress", hold, { capture: true });
    const release = commands.onDidReleaseInput(replay);
    return {
        dispose: () => {
            release.dispose();
            view.removeEventListener("keydown", hold, { capture: true });
            view.removeEventListener("keypress", hold, { capture: true });
        },
    };
}
