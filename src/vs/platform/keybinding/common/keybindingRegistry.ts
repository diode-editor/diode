import type { IDisposable } from "@tuidom/all/common/disposable";
import type { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { token } from "../../instantiation/common/diContainer.ts";

export const KeybindingRegistryDIToken = token<KeybindingRegistry>("KeybindingRegistry");

export interface KeyboardEventLike {
    readonly key: string;
    readonly code?: string;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
}

export interface Keybinding {
    key: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

/**
 * A full keybinding is a sequence of one or more chord parts.
 * Length 1 = an ordinary single combination (e.g. Ctrl+S).
 * Length 2+ = a chord (e.g. Ctrl+K Ctrl+S).
 */
export type KeybindingChord = Keybinding[];

/**
 * Result of feeding a key event into the registry.
 *  - "command": a full binding matched — execute commandId.
 *  - "chord":   the event matched the prefix of one or more chords; the
 *               registry is now waiting for the next part. `chord` holds the
 *               parts pressed so far (for status-bar feedback).
 *  - "none":    nothing matched (and any pending chord was reset).
 */
export type KeybindingResolution =
    | { kind: "command"; commandId: string; when?: string }
    | { kind: "chord"; chord: KeybindingChord }
    | { kind: "none" };

interface KeybindingEntry {
    chord: KeybindingChord;
    commandId: string;
    when?: string;
}

const specialKeyMap: Record<string, string> = {
    enter: "Enter",
    escape: "Escape",
    tab: "Tab",
    backspace: "Backspace",
    space: " ",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    delete: "Delete",
    insert: "Insert",
    f1: "F1",
    f2: "F2",
    f3: "F3",
    f4: "F4",
    f5: "F5",
    f6: "F6",
    f7: "F7",
    f8: "F8",
    f9: "F9",
    f10: "F10",
    f11: "F11",
    f12: "F12",
};

const modifierNames = new Set(["ctrl", "shift", "alt", "meta"]);

export function parseKeybinding(spec: string): Keybinding {
    const parts = spec.toLowerCase().split("+");
    let ctrlKey = false;
    let shiftKey = false;
    let altKey = false;
    let metaKey = false;
    let rawKey = "";

    for (const part of parts) {
        if (part === "ctrl") ctrlKey = true;
        else if (part === "shift") shiftKey = true;
        else if (part === "alt") altKey = true;
        else if (part === "meta") metaKey = true;
        else rawKey = part;
    }

    const key = specialKeyMap[rawKey] ?? rawKey;

    return { key, ctrlKey, shiftKey, altKey, metaKey };
}

/**
 * Parses a chord spec — one or more whitespace-separated combinations.
 * Example: "ctrl+k ctrl+s" → [Ctrl+K, Ctrl+S]; "ctrl+s" → [Ctrl+S].
 */
export function parseChord(spec: string): KeybindingChord {
    return spec
        .trim()
        .split(/\s+/)
        .filter((part) => part !== "")
        .map(parseKeybinding);
}

function formatKey(key: string): string {
    if (key === " ") return "Space";
    if (key.startsWith("Arrow")) return key.slice("Arrow".length); // ArrowLeft → Left
    if (key.length === 1) return key.toUpperCase();
    // Event key values (Enter, PageDown, Home, F1, …) are already display-ready.
    return key;
}

/** Formats a single chord part, e.g. "Ctrl+Shift+K". */
function formatPart(part: Keybinding): string {
    const segments: string[] = [];
    if (part.ctrlKey) segments.push("Ctrl");
    if (part.shiftKey) segments.push("Shift");
    if (part.altKey) segments.push("Alt");
    if (part.metaKey) segments.push("Meta");
    segments.push(formatKey(part.key));
    return segments.join("+");
}

/** Formats a full chord into a human-readable string, e.g. "Ctrl+K Ctrl+S". */
export function formatKeybinding(chord: KeybindingChord): string {
    return chord.map(formatPart).join(" ");
}

/** Structural equality of two chords (used for `-command` unbind matching). */
function chordsEqual(a: KeybindingChord, b: KeybindingChord): boolean {
    if (a.length !== b.length) return false;
    return a.every((part, i) => {
        const other = b[i];
        return (
            part.key.toLowerCase() === other.key.toLowerCase() &&
            part.ctrlKey === other.ctrlKey &&
            part.shiftKey === other.shiftKey &&
            part.altKey === other.altKey &&
            part.metaKey === other.metaKey
        );
    });
}

function matchesBinding(event: KeyboardEventLike, binding: Keybinding): boolean {
    const modifiersMatch =
        event.ctrlKey === binding.ctrlKey &&
        event.shiftKey === binding.shiftKey &&
        event.altKey === binding.altKey &&
        event.metaKey === binding.metaKey;
    if (!modifiersMatch) return false;

    if (event.key.toLowerCase() === binding.key.toLowerCase()) return true;

    // Layout-independent fallback: for single-letter Ctrl/Meta shortcuts match by physical key code.
    // This makes e.g. Ctrl+S work even when the Russian layout is active.
    if (binding.key.length === 1 && (event.ctrlKey || event.metaKey) && event.code != null && event.code !== "") {
        const expectedCode = `Key${binding.key.toUpperCase()}`;
        if (event.code === expectedCode) return true;
    }

    return false;
}

export class KeybindingRegistry implements IDisposable {
    private entries: KeybindingEntry[] = [];

    // Events accumulated for an in-progress chord (empty when not in chord mode).
    private pendingEvents: KeyboardEventLike[] = [];

    public register(chord: Keybinding | KeybindingChord, commandId: string, when?: string): IDisposable {
        const entry: KeybindingEntry = {
            chord: Array.isArray(chord) ? chord : [chord],
            commandId,
            when,
        };
        this.entries.push(entry);
        return {
            dispose: () => {
                const index = this.entries.indexOf(entry);
                if (index !== -1) this.entries.splice(index, 1);
            },
        };
    }

    /**
     * Removes registered bindings for a command (VS Code `-command` unbind).
     * With a `chord`, only the entry matching that exact combination is removed;
     * without one, every binding for the command is removed.
     */
    public removeBindings(commandId: string, chord?: KeybindingChord): void {
        this.entries = this.entries.filter((entry) => {
            if (entry.commandId !== commandId) return true;
            if (chord && !chordsEqual(entry.chord, chord)) return true;
            return false;
        });
    }

    /**
     * Feeds a key event into the registry, advancing chord state as needed.
     *
     * Precedence: a binding that becomes a *complete* match at the current
     * depth wins immediately over a longer candidate that shares the same
     * prefix — so ordinary single-key bindings are never shadowed by a chord
     * that happens to start with the same combination.
     */
    public resolveKey(event: KeyboardEventLike, contextKeys?: ContextKeyService): KeybindingResolution {
        const seq = [...this.pendingEvents, event];

        const whenPasses = (entry: KeybindingEntry): boolean => {
            if (!entry.when) return true;
            if (!contextKeys) return false;
            return contextKeys.evaluate(entry.when);
        };

        const prefixMatches = (entry: KeybindingEntry): boolean => {
            if (entry.chord.length < seq.length) return false;
            for (let i = 0; i < seq.length; i++) {
                if (!matchesBinding(seq[i], entry.chord[i])) return false;
            }
            return true;
        };

        let hasLongerCandidate = false;
        // Iterate backward: last-registered wins on a complete match.
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            if (!whenPasses(entry) || !prefixMatches(entry)) continue;
            if (entry.chord.length === seq.length) {
                this.pendingEvents = [];
                return { kind: "command", commandId: entry.commandId, when: entry.when };
            }
            hasLongerCandidate = true;
        }

        if (hasLongerCandidate) {
            this.pendingEvents = seq;
            return { kind: "chord", chord: this.getPendingChord(contextKeys) };
        }

        // No candidate. If we were mid-chord, the just-pressed key broke the
        // sequence: cancel it and report "none". The key is consumed by the
        // chord layer (not re-resolved as a standalone binding), matching VS
        // Code — pressing Ctrl+K then an unrelated key does nothing.
        this.pendingEvents = [];
        return { kind: "none" };
    }

    /** Number of key presses accumulated for an in-progress chord (diagnostics). */
    public get pendingLength(): number {
        return this.pendingEvents.length;
    }

    /** Cancels any in-progress chord (e.g. on timeout, Escape, focus change). */
    public resetPending(): void {
        this.pendingEvents = [];
    }

    /**
     * Returns the chord parts pressed so far for the in-progress chord,
     * resolved against the registered bindings (so display uses the canonical
     * combination, not the raw event). Falls back to the raw events. Empty when
     * no chord is in progress.
     */
    public getPendingChord(contextKeys?: ContextKeyService): KeybindingChord {
        const seq = this.pendingEvents;
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            if (entry.chord.length <= seq.length) continue;
            if (entry.when && !contextKeys?.evaluate(entry.when)) continue;
            let matches = true;
            for (let j = 0; j < seq.length; j++) {
                if (!matchesBinding(seq[j], entry.chord[j])) {
                    matches = false;
                    break;
                }
            }
            if (matches) return entry.chord.slice(0, seq.length);
        }
        return seq.map((e) => ({
            key: e.key,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
        }));
    }

    /**
     * Returns the chord to display for a command, in priority order:
     *  1. the first registered binding whose `when` clause passes in the current
     *     context — a context-specific binding (e.g. a tier-specific fallback)
     *     is the one actually usable, so it wins over an unconditional default;
     *  2. else the first registered unconditional binding;
     *  3. else the first registered binding regardless of `when`.
     */
    public getKeybindingForCommand(commandId: string, contextKeys?: ContextKeyService): KeybindingChord | undefined {
        let unconditional: KeybindingChord | undefined;
        let firstAny: KeybindingChord | undefined;
        for (const entry of this.entries) {
            if (entry.commandId !== commandId) continue;
            firstAny ??= entry.chord;
            if (entry.when) {
                if (contextKeys?.evaluate(entry.when)) return entry.chord;
            } else {
                unconditional ??= entry.chord;
            }
        }
        return unconditional ?? firstAny;
    }

    public dispose(): void {
        this.entries.length = 0;
        this.pendingEvents = [];
    }
}
