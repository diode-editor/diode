import { Disposable } from "@tuidom/core/common/disposable";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { Keybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    KeybindingRegistryDIToken,
    parseChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type {
    CommandTrigger,
    ModifierReleaseArmory,
} from "../../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { ModifierReleaseArmoryDIToken } from "../../../../platform/keybinding/common/modifierReleaseArmory.ts";
import type { IUserKeybindingRule } from "../../../../platform/keybinding/node/keybindingsService.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../statusbar/common/statusBarService.ts";
import { TerminalEnvironmentServiceDIToken } from "../../terminalEnvironment/node/terminalEnvironmentService.ts";

export const KeybindingDispatcherDIToken = token<KeybindingDispatcher>("KeybindingDispatcher");

/**
 * Минимальный срез TerminalEnvironmentService, нужный диспатчеру: runtime-детект
 * extended-keys по фактически пришедшему CSI-u ключу (см. observeExtendedKeys).
 */
export interface IExtendedKeysObserver {
    hasCapability(cap: "extended-keys"): boolean;
    noteExtendedKeysObserved(): void;
}

// How long to wait for the next chord part before cancelling (matches VS Code).
const CHORD_TIMEOUT_MS = 5000;

// How long the "… is not a command" status message lingers after a broken chord.
const CHORD_NOT_FOUND_MS = 4000;

// Context keys that reflect WHAT IS FOCUSED (set from `activeElement` in the host's
// updateContextKeys). A keybinding whose `when` names one of these is scoped to the focused
// input/list/editor — e.g. clipboard / undo / cursor commands that edit the focused widget.
// While a capturing overlay (quickpick, dialog, menu) owns the keyboard, only such
// focus-scoped commands may run; everything else (workbench/navigation commands, which carry
// no focus-scoped `when`) is suppressed so a shortcut can't act on a panel behind the
// still-visible overlay. See dispatchKeyDown.
const FOCUS_SCOPED_CONTEXT_KEYS = ["inputWidgetFocus", "textInputFocus", "textViewFocus", "listFocus"] as const;

function isFocusScopedWhen(when: string | undefined): boolean {
    return when !== undefined && FOCUS_SCOPED_CONTEXT_KEYS.some((key) => when.includes(key));
}

// Modifier keys that arrive as standalone keydowns (Kitty protocol). They must
// not break or advance an in-progress chord.
const modifierKeyNames = new Set(["Control", "Shift", "Alt", "Meta", "Hyper", "Super", "AltGraph", "CapsLock"]);

function isModifierKey(key: string): boolean {
    return modifierKeyNames.has(key);
}

/**
 * A CSI-u encoded key (`ESC [ <code>[;<mods>] u`). A key only arrives in this form when the
 * Kitty keyboard protocol / xterm modifyOtherKeys is actually engaged — so receiving one is
 * proof of `extended-keys` support, even behind tmux where the capability probe can't confirm.
 */
// eslint-disable-next-line no-control-regex
const CSI_U_KEY_RAW = /^\x1b\[[0-9;:]*u$/;

function eventToKeybinding(event: TUIKeyboardEvent): Keybinding {
    return {
        key: event.key,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    };
}

/**
 * Клавиатурный диспатчер Workbench: резолвит key-события против KeybindingRegistry
 * и применяет результат — запуск команды (через ModifierReleaseArmory для hold-сессий),
 * ведение chord-режима (таймауты, «swallow» продолжения, хинт в статус-баре через
 * StatusBarService) и применение пользовательских keybindings.json-правил.
 *
 * Сервис не владеет view: владелец корневого дерева (WorkbenchComponent) вешает
 * capture/bubble-листенеры на BodyElement и подключает два хука —
 * {@link updateContextKeys} и {@link hasKeyboardCapturingOverlay}.
 */
export class KeybindingDispatcher extends Disposable {
    public static dependencies = [
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
        CommandRegistryDIToken,
        StatusBarServiceDIToken,
        ModifierReleaseArmoryDIToken,
        TerminalEnvironmentServiceDIToken,
        ILogServiceDIToken,
    ] as const;

    /**
     * Хук владельца view: обновить контекстные ключи (фокус/панели/окружение) перед
     * резолвом биндинга. WorkbenchComponent подставляет свой updateContextKeys().
     */
    public updateContextKeys: () => void = () => {
        /* по умолчанию no-op; владелец view подставляет свою реализацию */
    };

    /**
     * Хук владельца view: владеет ли клавиатурой модальный оверлей (quickpick / диалог /
     * меню). WorkbenchComponent подставляет view.overlayLayer.hasKeyboardCapturingOverlay().
     */
    public hasKeyboardCapturingOverlay: () => boolean = () => false;

    private keybindings: KeybindingRegistry;
    private contextKeys: ContextKeyService;
    private commands: CommandRegistry;
    private statusBarService: StatusBarService;
    private armory: ModifierReleaseArmory;
    private terminalEnv: IExtendedKeysObserver;
    private logger: ILogger;

    /** Запись chord-хинта в статус-баре; null, когда хинт скрыт. */
    private chordHintEntry: IStatusBarEntryHandle | null = null;
    private chordTimer: ReturnType<typeof setTimeout> | null = null;
    private notFoundTimer: ReturnType<typeof setTimeout> | null = null;
    private swallowNextKeyPress = false;

    public constructor(
        keybindings: KeybindingRegistry,
        contextKeys: ContextKeyService,
        commands: CommandRegistry,
        statusBarService: StatusBarService,
        armory: ModifierReleaseArmory,
        terminalEnv: IExtendedKeysObserver,
        logService: ILogService,
    ) {
        super();
        this.keybindings = keybindings;
        this.contextKeys = contextKeys;
        this.commands = commands;
        this.statusBarService = statusBarService;
        this.armory = armory;
        this.terminalEnv = terminalEnv;
        this.logger = logService.createLogger("input.keybindings");
        this.register({
            dispose: () => {
                this.clearChordTimeout();
                this.clearNotFoundTimer();
                this.chordHintEntry?.dispose();
            },
        });
    }

    // Capture phase: while a chord is in progress, intercept the next key
    // before it reaches the focused widget and swallow it entirely — so the
    // continuation key never leaks into the editor, matched or not.
    public readonly handleKeyDownCapture = (event: TUIKeyboardEvent): void => {
        this.observeExtendedKeys(event);
        if (this.keybindings.pendingLength === 0) return; // not in a chord — let the bubble handler run
        if (isModifierKey(event.key)) return; // holding a modifier must not break the chord
        event.preventDefault();
        event.stopImmediatePropagation();
        this.dispatchKeyDown(event);
    };

    public readonly handleKeyPressCapture = (event: TUIKeyboardEvent): void => {
        if (!this.swallowNextKeyPress) return;
        this.swallowNextKeyPress = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    // Bubble phase: only reached when no chord is pending (otherwise the capture
    // handler stops propagation). Handles ordinary bindings and chord starts.
    public readonly handleKeyDown = (event: TUIKeyboardEvent): void => {
        if (this.dispatchKeyDown(event)) {
            event.preventDefault();
        }
    };

    // Отпускание модификатора завершает «hold-сессии» команд (MRU-переключение
    // вкладок и т.п.) через ModifierReleaseArmory. Какой именно модификатор ждать,
    // решает сама команда по своему аккорду — здесь только маршрутизация keyup.
    // Требует Kitty keyboard protocol с event types: только он присылает keyup для
    // одиночного модификатора.
    public readonly handleKeyUp = (event: TUIKeyboardEvent): void => {
        this.armory.fireRelease(event.key);
    };

    /**
     * Promote the terminal tier off `legacy` the moment a CSI-u key actually arrives — the only
     * reliable extended-keys signal behind tmux, which drops the startup capability probe.
     */
    private observeExtendedKeys(event: TUIKeyboardEvent): void {
        if (this.terminalEnv.hasCapability("extended-keys")) return;
        if (CSI_U_KEY_RAW.test(event.raw)) this.terminalEnv.noteExtendedKeysObserved();
    }

    /**
     * Resolves a key against the keybinding registry and applies the outcome
     * (run command, enter/cancel chord mode, update the status-bar hint).
     * Returns true if the key was consumed (caller should preventDefault).
     */
    public dispatchKeyDown(event: TUIKeyboardEvent): boolean {
        this.updateContextKeys();
        this.clearChordTimeout();
        this.clearNotFoundTimer();
        this.swallowNextKeyPress = false;
        const pendingBefore = this.keybindings.pendingLength;
        // Capture the chord prefix BEFORE resolving (resolveKey clears it on a break).
        const prefix = pendingBefore > 0 ? this.keybindings.getPendingChord(this.contextKeys) : [];
        const res = this.keybindings.resolveKey(event, this.contextKeys);

        this.logger.debug("keydown", {
            key: event.key,
            code: event.code,
            ctrl: event.ctrlKey,
            shift: event.shiftKey,
            alt: event.altKey,
            meta: event.metaKey,
            pendingBefore,
            result: res.kind,
            commandId: res.kind === "command" ? res.commandId : undefined,
            chord: res.kind === "chord" ? formatKeybinding(res.chord) : undefined,
        });

        // Keyboard modality, symmetric to the pointer path (OverlayLayer.elementFromPoint stops a
        // click landing behind a modal). While a quickpick / dialog / menu owns the keyboard, only
        // commands scoped to the focused input/list/editor (their `when` names a focus context key
        // — e.g. clipboard / undo inside the quickpick query) may run. Workbench/navigation commands
        // are suppressed so a shortcut can't act on a panel behind the still-visible overlay.
        const overlayCaptures = this.hasKeyboardCapturingOverlay();

        if (res.kind === "chord") {
            if (overlayCaptures) {
                // No new chord may start while an overlay owns the keyboard.
                this.keybindings.resetPending();
                this.setChordHint(null);
                return false;
            }
            // Prefix key of a chord — swallow its keypress and wait for the next.
            this.swallowNextKeyPress = true;
            this.setChordHint(`(${formatKeybinding(res.chord)}) was pressed. Waiting for next key…`);
            this.startChordTimeout();
            return true;
        }

        // A continuation key (command or none) ends chord mode; its keypress
        // must be swallowed too so a broken chord does not leak into the editor.
        const wasInChord = pendingBefore > 0;
        if (wasInChord) this.swallowNextKeyPress = true;

        if (res.kind === "command" && this.commands.has(res.commandId)) {
            if (overlayCaptures && !isFocusScopedWhen(res.when)) {
                // A workbench/navigation shortcut fired while an overlay owns the keyboard:
                // swallow it (no preventDefault) instead of acting behind the overlay.
                this.setChordHint(null);
                return false;
            }
            this.setChordHint(null);
            // Даём команде контекст модификаторов аккорда: команды с «hold-сессией»
            // (MRU-вкладки) взводят коммит на отпускание удерживающего модификатора
            // именно по ним. Через контекст, а не позиционный аргумент — чтобы не
            // конфликтовать с командами, у которых есть свои аргументы.
            const trigger: CommandTrigger = {
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
            };
            this.armory.withTrigger(trigger, () => this.commands.execute(res.commandId));
            // Every keydown emits a paired keypress (preventDefault on keydown does not
            // suppress it — only swallowNextKeyPress does). Once a command consumed the
            // keydown, that keypress must not ALSO trigger the focused widget's default
            // action: Enter would insert a newline behind acceptSelectedSuggestion,
            // PageDown would move a list cursor a second page after list.focusPageDown.
            // Consuming the command consumes the whole key.
            this.swallowNextKeyPress = true;
            return true;
        }

        if (wasInChord) {
            // Broken chord: report the unmatched combination, like VS Code.
            const combo = formatKeybinding([...prefix, eventToKeybinding(event)]);
            this.showChordNotFound(combo);
            return true; // consumed (no command, no leak)
        }

        this.setChordHint(null);
        return false;
    }

    /**
     * Показывает (или скрывает, при null) транзиентный хинт аккорда в статус-баре,
     * например "(Ctrl+K) was pressed. Waiting for next key…". Живёт как обычная
     * запись StatusBarService левее прочих левых сегментов (priority ниже
     * терминального индикатора).
     */
    private setChordHint(text: string | null): void {
        if (text === null) {
            this.chordHintEntry?.dispose();
            this.chordHintEntry = null;
            return;
        }
        if (this.chordHintEntry !== null) {
            this.chordHintEntry.update({ text });
            return;
        }
        this.chordHintEntry = this.statusBarService.addEntry({
            id: "status.chordHint",
            text,
            alignment: "left",
            priority: 50,
        });
    }

    private showChordNotFound(combo: string): void {
        this.setChordHint(`(${combo}) is not a command`);
        this.notFoundTimer = setTimeout(() => {
            this.notFoundTimer = null;
            this.setChordHint(null);
        }, CHORD_NOT_FOUND_MS);
    }

    private clearNotFoundTimer(): void {
        if (this.notFoundTimer !== null) {
            clearTimeout(this.notFoundTimer);
            this.notFoundTimer = null;
        }
    }

    private startChordTimeout(): void {
        this.chordTimer = setTimeout(() => {
            this.chordTimer = null;
            this.keybindings.resetPending();
            this.swallowNextKeyPress = false;
            this.setChordHint(null);
        }, CHORD_TIMEOUT_MS);
    }

    private clearChordTimeout(): void {
        if (this.chordTimer !== null) {
            clearTimeout(this.chordTimer);
            this.chordTimer = null;
        }
    }

    /** Сбрасывает in-progress chord и swallow-состояние (смена фокуса, teardown). */
    public cancelPendingChord(): void {
        if (this.keybindings.pendingLength > 0) {
            this.logger.debug("chord cancelled (focus change / timeout)");
        }
        this.clearChordTimeout();
        this.clearNotFoundTimer();
        this.keybindings.resetPending();
        this.swallowNextKeyPress = false;
        this.setChordHint(null);
    }

    /**
     * Applies user `keybindings.json` rules. A `-command` rule unbinds (the exact key, or all
     * bindings for the command if no key); other rules add a binding that wins over defaults.
     * `when` may reference tier / cap_* / mode_* / os.
     */
    public applyUserKeybindings(rules: readonly IUserKeybindingRule[]): void {
        for (const rule of rules) {
            if (rule.command.startsWith("-")) {
                const commandId = rule.command.slice(1);
                this.keybindings.removeBindings(commandId, rule.key ? parseChord(rule.key) : undefined);
            } else {
                this.register(this.keybindings.register(parseChord(rule.key), rule.command, rule.when));
            }
        }
    }
}
