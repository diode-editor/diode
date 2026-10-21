import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { withCursorChangeSource } from "../../../../editor/common/core/cursorChangeSource.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { deserializeWhen, whenPositiveKeys } from "../../../../platform/contextkey/common/contextKeyExpr.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { Keybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type {
    CommandTrigger,
    ModifierReleaseArmory,
} from "../../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { ModifierReleaseArmoryDIToken } from "../../../../platform/keybinding/common/modifierReleaseArmory.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../statusbar/common/statusBarService.ts";
import { TerminalEnvironmentServiceDIToken } from "../../terminalEnvironment/node/terminalEnvironmentService.ts";

export const KeybindingDispatcherDIToken = token<KeybindingDispatcher>("KeybindingDispatcher");

export interface IExtendedKeysObserver {
    hasCapability(cap: "extended-keys" | "super"): boolean;
    noteExtendedKeysObserved(): void;
    noteSuperObserved(): void;
}

// Как в VS Code.
const CHORD_TIMEOUT_MS = 5000;

const CHORD_NOT_FOUND_MS = 4000;

// Focus-scoped context keys (set from `activeElement`). While a capturing overlay owns the
// keyboard, only bindings whose `when` names one of these may run — otherwise a shortcut
// would act on a panel behind the still-visible overlay. See dispatchKeyDown.
const FOCUS_SCOPED_CONTEXT_KEYS = ["inputWidgetFocus", "textInputFocus", "textViewFocus", "listFocus"] as const;

/** Бинд требует фокус-ключ истинным (в позиции не под отрицанием: `!listFocus` — не фокус-скоупный). */
function isFocusScopedWhen(when: string | undefined): boolean {
    // Stryker disable next-line ConditionalExpression: эквивалентный — разбор undefined тоже даёт undefined (парсер ловит своё исключение), ветка — для типов
    const expr = when === undefined ? undefined : deserializeWhen(when);
    if (expr === undefined) return false;
    const positive = whenPositiveKeys(expr);
    return FOCUS_SCOPED_CONTEXT_KEYS.some((key) => positive.includes(key));
}

// Standalone modifier keydowns (Kitty protocol) must not break or advance a chord.
const modifierKeyNames = new Set(["Control", "Shift", "Alt", "Meta", "Hyper", "Super", "AltGraph", "CapsLock"]);

function isModifierKey(key: string): boolean {
    return modifierKeyNames.has(key);
}

/**
 * A key arrives CSI-u encoded only when Kitty protocol / modifyOtherKeys is engaged — proof of
 * `extended-keys` support even behind tmux, where the capability probe can't confirm.
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
 * Не владеет view: WorkbenchComponent вешает capture/bubble-листенеры на BodyElement и
 * подставляет хуки {@link updateContextKeys} и {@link hasKeyboardCapturingOverlay}.
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

    public updateContextKeys: () => void = () => {
        /* по умолчанию no-op; владелец view подставляет свою реализацию */
    };

    public hasKeyboardCapturingOverlay: () => boolean = () => false;

    private keybindings: KeybindingRegistry;
    private contextKeys: ContextKeyService;
    private commands: CommandRegistry;
    private statusBarService: StatusBarService;
    private armory: ModifierReleaseArmory;
    private terminalEnv: IExtendedKeysObserver;
    private logger: ILogger;

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
        // Stryker disable next-line StringLiteral,ObjectLiteral: имя канала и его метка — подпись в селекторе Output, поведения логирования не задают
        this.logger = logService.createLogger("input.keybindings", { label: "Keybindings" });
        this.register({
            dispose: () => {
                this.clearChordTimeout();
                this.clearNotFoundTimer();
                this.chordHintEntry?.dispose();
            },
        });
    }

    // Capture phase: while a chord is pending, swallow the next key before it reaches the
    // focused widget, matched or not.
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

    // Bubble phase: reached only when no chord is pending (capture stops propagation otherwise).
    public readonly handleKeyDown = (event: TUIKeyboardEvent): void => {
        if (this.dispatchKeyDown(event)) {
            event.preventDefault();
            // Съеденная клавиша не доходит до прочих слушателей корня — мнемоник меню.
            event.stopImmediatePropagation();
        }
    };

    // Отпускание модификатора завершает «hold-сессии» команд (MRU-вкладки) через
    // ModifierReleaseArmory. keyup одиночного модификатора шлёт только Kitty с event types.
    public readonly handleKeyUp = (event: TUIKeyboardEvent): void => {
        this.armory.fireRelease(event.key);
    };

    private observeExtendedKeys(event: TUIKeyboardEvent): void {
        // Super-бит кодирует только Kitty, так что увиденный meta доказывает и его, и extended-keys.
        // ДО резолва: контекст-ключи перечитываются на этом же нажатии, и первый Cmd+S уже найдёт Cmd-бинд.
        if (event.metaKey && !this.terminalEnv.hasCapability("super")) this.terminalEnv.noteSuperObserved();
        if (this.terminalEnv.hasCapability("extended-keys")) return;
        if (CSI_U_KEY_RAW.test(event.raw)) this.terminalEnv.noteExtendedKeysObserved();
    }

    /** `true` — клавиша съедена (вызывающий делает preventDefault). */
    public dispatchKeyDown(event: TUIKeyboardEvent): boolean {
        // Нажатие, не продлившее hold-сессию, её завершает: на legacy-терминале keyup модификатора
        // не приходит, и серия Ctrl+Tab жила бы до следующего переключения.
        const armedBefore = isModifierKey(event.key) ? null : this.armory.pendingGeneration;
        try {
            return this.dispatchResolvedKeyDown(event);
        } finally {
            this.armory.commitStaleAfter(armedBefore);
        }
    }

    private dispatchResolvedKeyDown(event: TUIKeyboardEvent): boolean {
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
            // Лог — для разработчика: стабильная pc-форма, без глифов мака.
            chord: res.kind === "chord" ? formatKeybinding(res.chord) : undefined,
        });

        // Keyboard modality, symmetric to OverlayLayer.elementFromPoint; see FOCUS_SCOPED_CONTEXT_KEYS.
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
            this.setChordHint(
                `(${formatKeybinding(res.chord, keybindingLabelStyle(this.contextKeys))}) was pressed. Waiting for next key…`,
            );
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
            // Модификаторы аккорда — для hold-сессий (MRU-вкладки). Через контекст, а не позиционный
            // аргумент — чтобы не конфликтовать с собственными аргументами команд.
            const trigger: CommandTrigger = {
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
            };
            // Без args команда зовётся без аргументов: не подсовывать undefined командам с дефолтами.
            const commandArgs = res.args === undefined ? [] : [res.args];
            // Стрелки и Shift-выделение у нас — команды, а расширение обязано увидеть их как
            // Keyboard, а не Command (cursorChangeSource.ts).
            withCursorChangeSource("keyboard", () => {
                this.armory.withTrigger(trigger, () => this.commands.execute(res.commandId, ...commandArgs));
            });
            // Keydown always emits a paired keypress (preventDefault doesn't suppress it). Once a command
            // consumed the keydown, the keypress must not also hit the widget: Enter would insert a newline
            // behind acceptSelectedSuggestion, PageDown would page a list twice.
            this.swallowNextKeyPress = true;
            return true;
        }

        if (wasInChord) {
            // Broken chord: report the unmatched combination, like VS Code.
            const combo = formatKeybinding(
                [...prefix, eventToKeybinding(event)],
                keybindingLabelStyle(this.contextKeys),
            );
            this.showChordNotFound(combo);
            return true; // consumed (no command, no leak)
        }

        this.setChordHint(null);
        return false;
    }

    /** Живёт обычной записью StatusBarService левее прочих левых сегментов. */
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
}
