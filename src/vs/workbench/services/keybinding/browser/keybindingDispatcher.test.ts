import { afterEach, describe, expect, it, vi } from "vitest";

import { TUIKeyboardEvent } from "@tuidom/all/dom/events/tuiKeyboardEvent";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import {
    KeybindingRegistry,
    parseChord,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ModifierReleaseArmory } from "../../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../statusbar/common/statusBarService.ts";

import type { IExtendedKeysObserver } from "./keybindingDispatcher.ts";
import { KeybindingDispatcher } from "./keybindingDispatcher.ts";

function keyDown(init: ConstructorParameters<typeof TUIKeyboardEvent>[1]): TUIKeyboardEvent {
    return new TUIKeyboardEvent("keydown", init);
}

function createHarness() {
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const commands = new CommandRegistry();
    const statusBar = new StatusBarService(NULL_STATE_SERVICE);
    const armory = new ModifierReleaseArmory();
    const extendedKeysCalls: string[] = [];
    let extendedKeys = false;
    const terminalEnv: IExtendedKeysObserver = {
        hasCapability: () => extendedKeys,
        noteExtendedKeysObserved: () => {
            extendedKeysCalls.push("observed");
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
        NULL_LOG_SERVICE,
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

describe("KeybindingDispatcher — одиночные биндинги", () => {
    it("резолвит и выполняет команду, событие считается consumed", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");

        const consumed = h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true }));

        expect(consumed).toBe(true);
        expect(h.executed).toEqual(["test.save"]);
    });

    it("незнакомая клавиша не consumed (дефолтные хуки no-op отрабатывают)", () => {
        const h = createHarness();

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "x" }))).toBe(false);
    });

    it("bubble-обработчик вызывает preventDefault только для consumed-события", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");

        const matched = keyDown({ key: "s", ctrlKey: true });
        h.dispatcher.handleKeyDown(matched);
        expect(matched.defaultPrevented).toBe(true);

        const unmatched = keyDown({ key: "x" });
        h.dispatcher.handleKeyDown(unmatched);
        expect(unmatched.defaultPrevented).toBe(false);
    });

    it("зовёт хук updateContextKeys перед резолвом when-клаузы", () => {
        const h = createHarness();
        h.bind("ctrl+c", "test.copy", "textInputFocus");
        h.dispatcher.updateContextKeys = () => {
            h.contextKeys.set("textInputFocus", true);
        };

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "c", ctrlKey: true }))).toBe(true);
        expect(h.executed).toEqual(["test.copy"]);
    });
});

describe("KeybindingDispatcher — чорды", () => {
    it("префикс показывает хинт ожидания, продолжение выполняет команду и убирает хинт", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }))).toBe(true);
        expect(h.executed).toEqual([]);
        expect(h.statusTexts().some((t) => t.includes("(Ctrl+K) was pressed. Waiting for next key…"))).toBe(true);

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "s" }))).toBe(true);
        expect(h.executed).toEqual(["test.chordSave"]);
        expect(h.statusTexts()).toEqual([]);
    });

    it("keypress после префикса и после продолжения проглатывается", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        const press = new TUIKeyboardEvent("keypress", { key: "s" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(true);
        expect(press.immediatePropagationStopped).toBe(true);

        // Без взведённого swallow keypress проходит нетронутым.
        const plain = new TUIKeyboardEvent("keypress", { key: "a" });
        h.dispatcher.handleKeyPressCapture(plain);
        expect(plain.defaultPrevented).toBe(false);
    });

    it("capture-обработчик перехватывает продолжение чорда и не трогает клавиши вне чорда", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        // Вне чорда capture ничего не делает — событие идёт дальше (bubble).
        const before = keyDown({ key: "s" });
        h.dispatcher.handleKeyDownCapture(before);
        expect(before.defaultPrevented).toBe(false);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));

        // Одиночный модификатор (Kitty) не ломает и не продвигает чорд.
        const modifier = keyDown({ key: "Control", ctrlKey: true });
        h.dispatcher.handleKeyDownCapture(modifier);
        expect(modifier.defaultPrevented).toBe(false);

        // Продолжение перехватывается целиком и завершает чорд.
        const continuation = keyDown({ key: "s" });
        h.dispatcher.handleKeyDownCapture(continuation);
        expect(continuation.defaultPrevented).toBe(true);
        expect(continuation.immediatePropagationStopped).toBe(true);
        expect(h.executed).toEqual(["test.chordSave"]);
    });

    it("сломанный чорд показывает «is not a command» и сам гаснет по таймеру", () => {
        vi.useFakeTimers();
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "x" }))).toBe(true); // consumed, no leak
        expect(h.statusTexts().some((t) => t.includes("(Ctrl+K X) is not a command"))).toBe(true);

        vi.advanceTimersByTime(4000);
        expect(h.statusTexts()).toEqual([]);
    });

    it("следующий keydown снимает таймер «is not a command» досрочно", () => {
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

    it("хинт «is not a command» переиспользует живую запись ожидания (update, не новая)", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        // Второй Ctrl+K ломает чорд: живая запись ожидания обновляется на not-found.
        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));

        expect(h.statusTexts()).toEqual(["(Ctrl+K Ctrl+K) is not a command"]);
    });

    it("отменяет незавершённый чорд по таймауту", () => {
        vi.useFakeTimers();
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        vi.advanceTimersByTime(5000);

        expect(h.statusTexts()).toEqual([]);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s" }));
        expect(h.executed).toEqual([]);
    });

    it("cancelPendingChord сбрасывает pending-состояние и хинт (смена фокуса)", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");

        h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }));
        h.dispatcher.cancelPendingChord();

        expect(h.statusTexts()).toEqual([]);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s" }));
        expect(h.executed).toEqual([]);

        // Повторный вызов без pending-чорда — безопасный no-op.
        h.dispatcher.cancelPendingChord();
    });

    it("dispose гасит таймеры и запись хинта", () => {
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

describe("KeybindingDispatcher — модальные оверлеи", () => {
    it("не даёт стартовать чорд, пока оверлей владеет клавиатурой", () => {
        const h = createHarness();
        h.bind("ctrl+k s", "test.chordSave");
        h.dispatcher.hasKeyboardCapturingOverlay = () => true;

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "k", ctrlKey: true }))).toBe(false);
        expect(h.statusTexts()).toEqual([]);
        expect(h.keybindings.pendingLength).toBe(0);
    });

    it("глотает workbench-команду без focus-scoped when за оверлеем", () => {
        const h = createHarness();
        h.bind("ctrl+b", "test.toggleSidebar");
        h.dispatcher.hasKeyboardCapturingOverlay = () => true;

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "b", ctrlKey: true }))).toBe(false);
        expect(h.executed).toEqual([]);
    });

    it("пропускает focus-scoped команду (when с inputWidgetFocus) при открытом оверлее", () => {
        const h = createHarness();
        h.bind("ctrl+c", "test.inputCopy", "inputWidgetFocus");
        h.contextKeys.set("inputWidgetFocus", true);
        h.dispatcher.hasKeyboardCapturingOverlay = () => true;

        expect(h.dispatcher.dispatchKeyDown(keyDown({ key: "c", ctrlKey: true }))).toBe(true);
        expect(h.executed).toEqual(["test.inputCopy"]);
    });
});

describe("KeybindingDispatcher — swallow печатающих клавиш и armory", () => {
    it("Enter, запустивший команду над текстовым инпутом, глотает парный keypress", () => {
        const h = createHarness();
        h.bind("enter", "test.acceptSuggestion", "textInputFocus");
        h.contextKeys.set("textInputFocus", true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "Enter" }));

        const press = new TUIKeyboardEvent("keypress", { key: "Enter" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(true);
    });

    it("любая сработавшая команда глотает парный keypress (Ctrl+комбинация)", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");
        h.contextKeys.set("textInputFocus", true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true }));

        const press = new TUIKeyboardEvent("keypress", { key: "s" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(true);
    });

    it("PageDown-команда глотает парный keypress — дефолт виджета не сработает вторым", () => {
        const h = createHarness();
        h.bind("pagedown", "list.focusPageDown", "listFocus");
        h.contextKeys.set("listFocus", true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "PageDown" }));

        const press = new TUIKeyboardEvent("keypress", { key: "PageDown" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(true);
    });

    it("клавиша без биндинга не взводит swallow", () => {
        const h = createHarness();
        h.contextKeys.set("listFocus", true);

        h.dispatcher.dispatchKeyDown(keyDown({ key: "PageDown" }));

        const press = new TUIKeyboardEvent("keypress", { key: "PageDown" });
        h.dispatcher.handleKeyPressCapture(press);
        expect(press.defaultPrevented).toBe(false);
    });

    it("keyup удерживающего модификатора коммитит hold-сессию команды через armory", () => {
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
});

describe("KeybindingDispatcher — runtime-детект extended-keys", () => {
    it("CSI-u raw-ключ промоутит tier (noteExtendedKeysObserved), дальше — no-op", () => {
        const h = createHarness();

        h.dispatcher.handleKeyDownCapture(keyDown({ key: "Tab", ctrlKey: true, raw: "\x1b[9;5u" }));
        expect(h.extendedKeysCalls).toEqual(["observed"]);

        // Возможность уже подтверждена — повторный CSI-u ничего не сообщает.
        h.dispatcher.handleKeyDownCapture(keyDown({ key: "Tab", ctrlKey: true, raw: "\x1b[9;5u" }));
        expect(h.extendedKeysCalls).toEqual(["observed"]);
    });

    it("обычный (не CSI-u) ключ ничего не сообщает", () => {
        const h = createHarness();

        h.dispatcher.handleKeyDownCapture(keyDown({ key: "a", raw: "a" }));

        expect(h.extendedKeysCalls).toEqual([]);
    });
});

describe("KeybindingDispatcher — пользовательские keybindings", () => {
    it("правило добавляет биндинг, который перебивает дефолтный", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");
        h.commands.register("user.custom", () => {
            h.executed.push("user.custom");
        });

        h.dispatcher.applyUserKeybindings([{ key: "ctrl+s", command: "user.custom" }]);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true }));

        expect(h.executed).toEqual(["user.custom"]);
    });

    it("«-command» с ключом снимает конкретный биндинг, без ключа — все", () => {
        const h = createHarness();
        h.bind("ctrl+s", "test.save");
        h.bind("ctrl+shift+s", "test.save");

        h.dispatcher.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true }));
        expect(h.executed).toEqual([]);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true, shiftKey: true }));
        expect(h.executed).toEqual(["test.save"]);

        h.dispatcher.applyUserKeybindings([{ key: "", command: "-test.save" }]);
        h.dispatcher.dispatchKeyDown(keyDown({ key: "s", ctrlKey: true, shiftKey: true }));
        expect(h.executed).toEqual(["test.save"]);
    });
});
