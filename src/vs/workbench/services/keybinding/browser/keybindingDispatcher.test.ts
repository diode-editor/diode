import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { currentCursorChangeSource } from "../../../../editor/common/core/cursorChangeSource.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import {
    KeybindingRegistry,
    parseChord,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ModifierReleaseArmory } from "../../../../platform/keybinding/common/modifierReleaseArmory.ts";
import type { ILogService, LogEntry } from "../../../../platform/log/common/iLogService.ts";
import { LogLevel } from "../../../../platform/log/common/logLevel.ts";
import { LogService } from "../../../../platform/log/common/logService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../statusbar/common/statusBarService.ts";

import type { IExtendedKeysObserver } from "./keybindingDispatcher.ts";
import { KeybindingDispatcher } from "./keybindingDispatcher.ts";

function keyDown(init: ConstructorParameters<typeof TUIKeyboardEvent>[1]): TUIKeyboardEvent {
    return new TUIKeyboardEvent("keydown", init);
}

function createHarness(logService: ILogService = NULL_LOG_SERVICE) {
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const commands = new CommandRegistry();
    const statusBar = new StatusBarService(NULL_STATE_SERVICE);
    const armory = new ModifierReleaseArmory();
    const extendedKeysCalls: string[] = [];
    let extendedKeys = false;
    let superKey = false;
    const terminalEnv: IExtendedKeysObserver = {
        // Strict: a typo in a capability name in the dispatcher fails the test instead of a silent false.
        hasCapability: (cap: string) => {
            if (cap === "super") return superKey;
            if (cap === "extended-keys") return extendedKeys;
            throw new Error(`unknown capability ${cap}`);
        },
        noteExtendedKeysObserved: () => {
            extendedKeysCalls.push("observed");
            extendedKeys = true;
        },
        noteSuperObserved: () => {
            extendedKeysCalls.push("super");
            superKey = true;
            extendedKeys = true;
        },
    };
    const dispatcher = new KeybindingDispatcher(
        keybindings,
        contextKeys,
        commands,
        statusBar,
        armory,
        terminalEnv,
        logService,
    );
    const executed: string[] = [];
    const bind = (spec: string, commandId: string, when?: string): void => {
        keybindings.register(parseChord(spec), commandId, when);
        if (!commands.has(commandId)) {
            commands.register(commandId, () => {
                executed.push(commandId);
            });
        }
    };
    const statusTexts = (): string[] => statusBar.entries().map((e) => e.text);
    return {
        keybindings,
        contextKeys,
        commands,
        statusBar,
        armory,
        dispatcher,
        executed,
        extendedKeysCalls,
        bind,
        statusTexts,
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("KeybindingDispatcher — single bindings", () => {
    it("resolves and runs the command, the event counts as consumed", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");

        const consumed = h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true }));

        expect(consumed).toBe(true);
        expect(h.executed).toEqual(["test.save"]);
    });

    it("an unknown key is not consumed (default no-op hooks run)", () => {
        const h = createHarness();

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "x" }))).toBe(false);
    });

    it("the bubble handler stops (preventDefault + stopImmediatePropagation) only a consumed event", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");

        const matched = keyDown({ key: "s", ctrlKey: true });
        h.dispatcher.handleKeyDown(matched);
        expect(matched.defaultPrevented).toBe(true);
        expect(matched.immediatePropagationStopped).toBe(true);

        const unmatched = keyDown({ key: "x" });
        h.dispatcher.handleKeyDown(unmatched);
        expect(unmatched.defaultPrevented).toBe(false);
        expect(unmatched.immediatePropagationStopped).toBe(false);
    });

    it("calls the updateContextKeys hook before resolving the when clause", () => {
        const h = createHarness();
        h.bind("ctrl+c", "test.copy", "textInputFocus");
        h.dispatcher.updateContextKeys = () => {
            h.contextKeys.set("textInputFocus", true);
        };

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "c", ctrlKey: true }))).toBe(true);
        expect(h.executed).toEqual(["test.copy"]);
    });
});

describe("KeybindingDispatcher — chords", () => {
    it("a prefix shows the pending hint, the continuation runs the command and removes the hint", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }))).toBe(true);
        expect(h.executed).toEqual([]);
        expect(h.statusTexts().some((t) => t.includes("(Ctrl+K) was pressed. Waiting for next key…"))).toBe(true);

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "s" }))).toBe(true);
        expect(h.executed).toEqual(["test.chordSave"]);
        expect(h.statusTexts()).toEqual([]);
    });

    it("keypress after the prefix and after the continuation is swallowed", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        const press = new TUIKeyboardEvent("keypress", { key: "s" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(true);
        expect(press.immediatePropagationStopped).toBe(true);

        const plain = new TUIKeyboardEvent("keypress", { key: "a" });
        h.dispatcher.handleKeyPressCapture(plain);
        expect(plain.defaultPrevented).toBe(false);
    });

    it("the capture handler intercepts the chord continuation and leaves keys outside a chord alone", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        const before = keyDown({ key: "s" });
        h.dispatcher.handleKeyDownCapture(before);
        expect(before.defaultPrevented).toBe(false);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));

        // A lone modifier (Kitty) neither breaks nor advances the chord — in both phases, as the root runs them.
        const modifier = keyDown({ key: "Control", ctrlKey: true });
        h.dispatcher.handleKeyDownCapture(modifier);
        h.dispatcher.handleKeyDown(modifier);
        expect(modifier.defaultPrevented).toBe(false);
        expect(h.keybindings.pendingLength).toBe(1);
        expect(h.statusTexts()).toEqual(["(Ctrl+K) was pressed. Waiting for next key…"]);

        const continuation = keyDown({ key: "s" });
        h.dispatcher.handleKeyDownCapture(continuation);
        expect(continuation.defaultPrevented).toBe(true);
        expect(continuation.immediatePropagationStopped).toBe(true);
        expect(h.executed).toEqual(["test.chordSave"]);
    });

    it("the keydown log writes the chord prefix in pc form, on mac too (developer log)", () => {
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Trace);
        const entries: LogEntry[] = [];
        logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
        const h = createHarness(logService);
        h.contextKeys.set("isMac", true);
        h.bind("meta+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", metaKey: true }));
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s" }));

        const keydowns = entries.filter((entry) => entry.message === "keydown").map((entry) => entry.args[0]);
        expect(keydowns).toMatchObject([
            { result: "chord", chord: "Meta+K", commandId: undefined },
            { result: "command", chord: undefined, commandId: "test.chordSave" },
        ]);
    });

    it("on mac (isMac) chord hints are labelled with glyphs", () => {
        const h = createHarness();
        h.contextKeys.set("isMac", true);
        h.bind("meta+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", metaKey: true }));
        expect(h.statusTexts().some((t) => t.includes("(⌘K) was pressed. Waiting for next key…"))).toBe(true);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "x" }));
        expect(h.statusTexts().some((t) => t.includes("(⌘K X) is not a command"))).toBe(true);
    });

    it("a broken chord shows 'is not a command' and hides itself on a timer", () => {
        vi.useFakeTimers();
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "x" }))).toBe(true); // consumed, no leak
        expect(h.statusTexts().some((t) => t.includes("(Ctrl+K X) is not a command"))).toBe(true);

        vi.advanceTimersByTime(4000);
        expect(h.statusTexts()).toEqual([]);
    });

    it("the next keydown clears the 'is not a command' timer early", () => {
        vi.useFakeTimers();
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        h.dispatcher.dispatchKeyDown(keyDown({ key: "x" }));
        expect(h.statusTexts().some((t) => t.includes("is not a command"))).toBe(true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "a" }));
        expect(h.statusTexts()).toEqual([]);
        vi.advanceTimersByTime(4000);
        expect(h.statusTexts()).toEqual([]);
    });

    it("the 'is not a command' hint reuses the live pending entry (update, not a new one)", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));

        expect(h.statusTexts()).toEqual(["(Ctrl+K Ctrl+K) is not a command"]);
    });

    it("cancels an unfinished chord on timeout", () => {
        vi.useFakeTimers();
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        vi.advanceTimersByTime(5000);

        expect(h.statusTexts()).toEqual([]);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s" }));
        expect(h.executed).toEqual([]);
    });

    it("cancelPendingChord resets the pending state and the hint (focus change)", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        h.dispatcher.cancelPendingChord();

        expect(h.statusTexts()).toEqual([]);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s" }));
        expect(h.executed).toEqual([]);

        // A repeated call without a pending chord is a safe no-op.
        h.dispatcher.cancelPendingChord();
    });

    it("dispose clears the timers and the hint entry", () => {
        vi.useFakeTimers();
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        expect(h.statusTexts()).toHaveLength(1);

        h.dispatcher.dispose();

        expect(h.statusTexts()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("KeybindingDispatcher — modal overlays", () => {
    it("does not start a chord while an overlay owns the keyboard", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");
        h.dispatcher.hasKeyboardCapturingOverlay = () => true;

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }))).toBe(false);
        expect(h.statusTexts()).toEqual([]);
        expect(h.keybindings.pendingLength).toBe(0);
    });

    it("swallows a workbench command without a focus-scoped when behind an overlay", () => {
        const h = createHarness();
        h.bind("ctrl+b", "test.toggleSidebar");
        h.dispatcher.hasKeyboardCapturingOverlay = () => true;

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "b", ctrlKey: true }))).toBe(false);
        expect(h.executed).toEqual([]);
    });

    it("lets a focus-scoped command (when with inputWidgetFocus) through with an overlay open", () => {
        const h = createHarness();
        h.bind("ctrl+c", "test.inputCopy", "inputWidgetFocus");
        h.contextKeys.set("inputWidgetFocus", true);
        h.dispatcher.hasKeyboardCapturingOverlay = () => true;

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "c", ctrlKey: true }))).toBe(true);
        expect(h.executed).toEqual(["test.inputCopy"]);
    });

    it("a negated focus key does not make a command focus-scoped, so it is swallowed behind an overlay", () => {
        const h = createHarness();
        // Regression: the focus key was matched as a substring, so `!listFocus` got past the overlay.
        h.bind("ctrl+b", "test.notInList", "!listFocus");
        h.bind("ctrl+e", "test.broken", "listFocus &&");
        h.dispatcher.hasKeyboardCapturingOverlay = () => true;

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "b", ctrlKey: true }))).toBe(false);
        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "e", ctrlKey: true }))).toBe(false);
        expect(h.executed).toEqual([]);
    });
});

describe("KeybindingDispatcher — printable key swallow and armory", () => {
    it("Enter that runs a command over a text input swallows the paired keypress", () => {
        const h = createHarness();
        h.bind("enter", "test.acceptSuggestion", "textInputFocus");
        h.contextKeys.set("textInputFocus", true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "Enter" }));

        const press = new TUIKeyboardEvent("keypress", { key: "Enter" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(true);
    });

    it("any command that runs swallows the paired keypress (Ctrl combination)", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");
        h.contextKeys.set("textInputFocus", true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true }));

        const press = new TUIKeyboardEvent("keypress", { key: "s" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(true);
    });

    it("a PageDown command swallows the paired keypress, so the widget default does not run second", () => {
        const h = createHarness();
        h.bind("pagedown", "list.focusPageDown", "listFocus");
        h.contextKeys.set("listFocus", true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "PageDown" }));

        const press = new TUIKeyboardEvent("keypress", { key: "PageDown" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(true);
    });

    it("a key without a binding does not arm swallow", () => {
        const h = createHarness();
        h.contextKeys.set("listFocus", true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "PageDown" }));

        const press = new TUIKeyboardEvent("keypress", { key: "PageDown" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(false);
    });

    it("keyup of the held modifier commits the command hold session via armory", () => {
        const h = createHarness();
        let committed = 0;
        h.keybindings.register(parseKeybinding("ctrl+tab"), "test.mruNext");
        h.commands.register("test.mruNext", () => {
            h.armory.armOnHoldRelease(() => {
                committed += 1;
            });
        });

        h.dispatcher.dispatchKeyDown(keyDown({ key: "Tab", ctrlKey: true }));
        expect(committed).toBe(0);

        h.dispatcher.handleKeyUp(new TUIKeyboardEvent("keyup", { key: "Control" }));
        expect(committed).toBe(1);
    });

    it("a lone modifier keydown does not end the hold session", () => {
        const h = createHarness();
        let committed = 0;
        h.keybindings.register(parseKeybinding("ctrl+tab"), "test.mruNext");
        h.commands.register("test.mruNext", () => {
            h.armory.armOnHoldRelease(() => {
                committed += 1;
            });
        });
        h.dispatcher.dispatchKeyDown(keyDown({ key: "Tab", ctrlKey: true }));

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "Shift", ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(committed).toBe(0);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "x" }));
        expect(committed).toBe(1);
    });
});

describe("KeybindingDispatcher — binding args", () => {
    it("rule args go to the command as the only argument (VS Code semantics)", () => {
        const h = createHarness();
        const received: unknown[][] = [];
        h.commands.register("test.withArgs", (...args: unknown[]) => {
            received.push(args);
        });
        h.keybindings.register(parseKeybinding("f6"), "test.withArgs", undefined, "user", { text: "src/" });

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "F6" }))).toBe(true);
        expect(received).toEqual([[{ text: "src/" }]]);
    });

    it("a binding without args calls the command with no arguments at all (not with undefined)", () => {
        const h = createHarness();
        const received: unknown[][] = [];
        h.commands.register("test.noArgs", (...args: unknown[]) => {
            received.push(args);
        });
        h.keybindings.register(parseKeybinding("f6"), "test.noArgs");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "F6" }));
        expect(received).toEqual([[]]);
    });
});

describe("KeybindingDispatcher — runtime extended-keys detection", () => {
    it("a CSI-u raw key promotes the tier (noteExtendedKeysObserved), then no-op", () => {
        const h = createHarness();

        h.dispatcher.handleKeyDownCapture(keyDown({ key: "Tab", ctrlKey: true, raw: "\x1b[9;5u" }));
        expect(h.extendedKeysCalls).toEqual(["observed"]);

        // The capability is already confirmed — a repeated CSI-u reports nothing.
        h.dispatcher.handleKeyDownCapture(keyDown({ key: "Tab", ctrlKey: true, raw: "\x1b[9;5u" }));
        expect(h.extendedKeysCalls).toEqual(["observed"]);
    });

    it("a regular (non CSI-u) key reports nothing", () => {
        const h = createHarness();

        h.dispatcher.handleKeyDownCapture(keyDown({ key: "a", raw: "a" }));

        expect(h.extendedKeysCalls).toEqual([]);
    });

    it("the super bit (Cmd) is reported once and BEFORE resolving, so the very first Cmd+S finds the Cmd binding", () => {
        const h = createHarness();
        let superAtResolve: boolean | undefined;
        h.dispatcher.updateContextKeys = () => {
            superAtResolve = h.extendedKeysCalls.includes("super");
        };

        h.dispatcher.handleKeyDownCapture(keyDown({ key: "s", metaKey: true, raw: "\x1b[115;9u" }));
        h.dispatcher.handleKeyDown(keyDown({ key: "s", metaKey: true, raw: "\x1b[115;9u" }));
        h.dispatcher.handleKeyDownCapture(keyDown({ key: "p", metaKey: true, raw: "\x1b[112;9u" }));

        expect(h.extendedKeysCalls).toEqual(["super"]);
        expect(superAtResolve).toBe(true);
    });
});

// Without the dispatcher's tagging, extensions would see arrow commands as "unknown source".
describe("KeybindingDispatcher — cursor change source", () => {
    it("a command from a keybinding runs inside the keyboard scope", () => {
        const h = createHarness();
        const seen: (string | undefined)[] = [];
        h.commands.register("test.cursorDown", () => {
            seen.push(currentCursorChangeSource());
        });
        h.bind("ctrl+alt+d", "test.cursorDown");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "d", ctrlKey: true, altKey: true }));

        expect(seen).toEqual(["keyboard"]);
    });

    it("after dispatch the scope is closed, the source does not leak out", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true }));
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("a command not run from a key gets no scope", () => {
        const h = createHarness();
        const seen: (string | undefined)[] = [];
        h.commands.register("test.fromPalette", () => {
            seen.push(currentCursorChangeSource());
        });
        h.commands.execute("test.fromPalette");
        expect(seen).toEqual([undefined]);
    });
});
