import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { withCursorChangeSource } from "../../../../editor/common/core/cursorChangeSource.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { deserializeWhen, whenPositiveKeys } from "../../../../platform/contextkey/common/contextKeyExpr.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type {
    Keybinding,
    KeybindingRegistry,
    KeybindingResolution,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
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

// Same as VS Code.
const CHORD_TIMEOUT_MS = 5000;

const CHORD_NOT_FOUND_MS = 4000;

// Focus-scoped context keys (set from `activeElement`). While a capturing overlay owns the
// keyboard, only bindings whose `when` names one of these may run — otherwise a shortcut
// would act on a panel behind the still-visible overlay. See dispatchKeyDown.
const FOCUS_SCOPED_CONTEXT_KEYS = [
    "inputWidgetFocus",
    "textInputFocus",
    "textViewFocus",
    "listFocus",
    "editorAreaFocus",
] as const;

/** The binding requires a focus key to be true (in a non-negated position: `!listFocus` is not focus-scoped). */
function isFocusScopedWhen(when: string | undefined): boolean {
    // Stryker disable next-line ConditionalExpression: equivalent — parsing undefined also yields undefined (the parser catches its own exception); the branch is for types
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

/**
 * `true` — consumed, `false` — not handled; `focus` — left to the focused widget's default action: no command
 * runs, the root's later listeners don't see it.
 */
type KeyDownOutcome = boolean | "focus";

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
 * Does not own the view: WorkbenchComponent attaches capture/bubble listeners to BodyElement and
 * supplies the {@link updateContextKeys} and {@link hasKeyboardCapturingOverlay} hooks; the terminal supplies
 * {@link isKeyForFocusedWidget}.
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
        /* no-op by default; the view owner supplies its own implementation */
    };

    public hasKeyboardCapturingOverlay: () => boolean = () => false;

    /**
     * Asked outside a chord, before anything runs, with what the key would do: `true` leaves the key
     * to the focused widget (the terminal sends it to the shell, like upstream's
     * `attachCustomKeyEventHandler`). The owner of that widget supplies it.
     */
    // Stryker disable next-line ArrowFunction: equivalent — `undefined` from the mutated default is just as falsy as `false`
    public isKeyForFocusedWidget: (event: TUIKeyboardEvent, resolution: KeybindingResolution) => boolean = () => false;

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
        // Stryker disable next-line StringLiteral,ObjectLiteral: the channel name and label are captions in the Output selector and do not affect logging behavior
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

    // Bubble phase: a non-modifier key gets here only outside a chord (capture stops it otherwise);
    // a lone modifier keydown gets here in a chord too, and dispatchKeyDown ignores it.
    public readonly handleKeyDown = (event: TUIKeyboardEvent): void => {
        const outcome = this.dispatchKeyDownOutcome(event);
        if (outcome === true) event.preventDefault();
        // Neither a consumed key nor one left to the focused widget reaches the root's other
        // listeners — menu mnemonics: Alt+F in the terminal is the shell's, not the File menu's.
        if (outcome === true || outcome === "focus") event.stopImmediatePropagation();
    };

    // Releasing a modifier ends command "hold sessions" (MRU tabs) via
    // ModifierReleaseArmory. Only Kitty with event types sends keyup for a lone modifier.
    public readonly handleKeyUp = (event: TUIKeyboardEvent): void => {
        this.armory.fireRelease(event.key);
    };

    private observeExtendedKeys(event: TUIKeyboardEvent): void {
        // Only Kitty encodes the Super bit, so an observed meta proves both it and extended-keys.
        // BEFORE resolving: context keys are re-read on this same keypress, so the first Cmd+S already finds the Cmd binding.
        if (event.metaKey && !this.terminalEnv.hasCapability("super")) this.terminalEnv.noteSuperObserved();
        if (this.terminalEnv.hasCapability("extended-keys")) return;
        if (CSI_U_KEY_RAW.test(event.raw)) this.terminalEnv.noteExtendedKeysObserved();
    }

    /** `true` means the key was consumed (the caller calls preventDefault). */
    public dispatchKeyDown(event: TUIKeyboardEvent): boolean {
        return this.dispatchKeyDownOutcome(event) === true;
    }

    private dispatchKeyDownOutcome(event: TUIKeyboardEvent): KeyDownOutcome {
        // A lone modifier keydown (Kitty) is not a keystroke, like VS Code's `_doDispatch`: it neither
        // resolves, breaks nor advances a chord, and does not end a hold session.
        if (isModifierKey(event.key)) return false;
        // A keypress that does not extend the hold session ends it: legacy terminals send no modifier
        // keyup, so a Ctrl+Tab series would otherwise live until the next switch.
        const armedBefore = this.armory.pendingGeneration;
        try {
            return this.dispatchResolvedKeyDown(event);
        } finally {
            this.armory.commitStaleAfter(armedBefore);
        }
    }

    private dispatchResolvedKeyDown(event: TUIKeyboardEvent): KeyDownOutcome {
        this.updateContextKeys();
        this.clearChordTimeout();
        this.clearNotFoundTimer();
        this.swallowNextKeyPress = false;
        const pendingBefore = this.keybindings.pendingLength;
        // Mid-chord the key always continues the chord (upstream's `inChordMode`).
        if (
            pendingBefore === 0 &&
            this.isKeyForFocusedWidget(event, this.keybindings.softResolveKey(event, this.contextKeys))
        ) {
            this.setChordHint(null);
            return "focus";
        }
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
            // The log is for developers: stable pc form, no mac glyphs.
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
            // Chord modifiers are for hold sessions (MRU tabs). Passed via context, not as a positional
            // argument, so they do not clash with the commands' own arguments.
            const trigger: CommandTrigger = {
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
            };
            // Without args the command is called with no arguments: do not pass undefined to commands with defaults.
            const commandArgs = res.args === undefined ? [] : [res.args];
            // Arrows and Shift selection are commands here, but extensions must see them as
            // Keyboard, not Command (cursorChangeSource.ts).
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
            return true; // no command, no leak
        }

        this.setChordHint(null);
        return false;
    }

    /** Lives as a regular StatusBarService entry, left of the other left-side segments. */
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
