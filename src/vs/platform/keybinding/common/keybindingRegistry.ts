import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { type ContextKeyExpression, deserializeWhen, serializeWhen } from "../../contextkey/common/contextKeyExpr.ts";
import type { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import { requiresExtendedKeys } from "./keybindingPortability.ts";
import {
    type IKeybindingPriority,
    KeybindingLayerRank,
    KeybindingWeight,
    sortByPriority,
} from "./keybindingResolver.ts";
import { macKeysAtLeast, macKeysBelow } from "./macKeys.ts";

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
    /** Ctrl on pc and mac rungs below cmd, Cmd on `mac-cmd`: the registry expands it into two entries ({@link expandModKey}). */
    modKey?: boolean;
}

export type KeybindingChord = Keybinding[];

/** `chord` carries the pressed prefix parts (for the status bar); `none` resets the pending chord. */
export type KeybindingResolution =
    | { kind: "command"; commandId: string; when?: string; args?: unknown }
    | { kind: "chord"; chord: KeybindingChord }
    | { kind: "none" };

export type KeybindingSource = "default" | "extension" | "user";

export interface IKeybindingEntrySnapshot {
    readonly chord: KeybindingChord;
    readonly commandId: string;
    readonly when?: string;
    readonly source: KeybindingSource;
    /** Passed as the first argument of `execute`. */
    readonly args?: unknown;
}

interface KeybindingEntry extends IKeybindingPriority {
    chord: KeybindingChord;
    commandId: string;
    when?: string;
    source: KeybindingSource;
    args?: unknown;
}

/** A binding or a removal (`-command`). */
export interface IKeybindingLayerRule {
    /** Command id; a leading `-` removes its bindings from the default and extension layers. */
    readonly command: string;
    /** Optional for a removal: without a chord all bindings of the command are removed. */
    readonly chord?: KeybindingChord;
    /** For a removal, only entries whose `when` contains all of these conditions are removed. */
    readonly when?: string;
    readonly args?: unknown;
}

interface IKeybindingRemoval {
    readonly commandId: string;
    readonly chord: KeybindingChord | undefined;
    readonly when: string | undefined;
}

type LayerSource = Exclude<KeybindingSource, "default">;

/** Replaced as a whole. */
interface IKeybindingLayer {
    readonly entries: readonly KeybindingEntry[];
    readonly removals: readonly IKeybindingRemoval[];
}

const EMPTY_LAYER: IKeybindingLayer = { entries: [], removals: [] };

/** `when` conditions as a set of canonical conjuncts: `(a) && (b && c)` → `{a, b, c}`. */
function whenTerms(when: string): string[] {
    const expr = deserializeWhen(when);
    return expr === undefined ? [when] : conjuncts(expr);
}

function conjuncts(expr: ContextKeyExpression): string[] {
    return expr.type === "and" ? expr.exprs.flatMap(conjuncts) : [serializeWhen(expr)];
}

/**
 * By inclusion, like upstream `whenIsEntirelyIncluded` simplified to conjuncts: an entry is removed
 * if its `when` contains all conditions of the removal.
 */
function isTargetedForRemoval(removal: IKeybindingRemoval, entry: KeybindingEntry): boolean {
    if (removal.commandId !== entry.commandId) return false;
    if (removal.chord !== undefined && !chordsEqual(removal.chord, entry.chord)) return false;
    if (removal.when === undefined) return true;
    // Stryker disable next-line ConditionalExpression: equivalent, parsing undefined yields [undefined], where non-empty removal conditions are never found
    if (entry.when === undefined) return false;
    const entryTerms = whenTerms(entry.when);
    return whenTerms(removal.when).every((term) => entryTerms.includes(term));
}

export interface IKeybindingRuleOptions {
    /** Defaults to `EditorCore`. */
    readonly weight?: number;
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

export function parseKeybinding(spec: string): Keybinding {
    const parts = spec.toLowerCase().split("+");
    let ctrlKey = false;
    let shiftKey = false;
    let altKey = false;
    let metaKey = false;
    let modKey = false;
    let rawKey = "";

    for (const part of parts) {
        if (part === "ctrl") ctrlKey = true;
        else if (part === "shift") shiftKey = true;
        else if (part === "alt") altKey = true;
        else if (part === "meta") metaKey = true;
        else if (part === "mod") modKey = true;
        else rawKey = part;
    }

    const key = specialKeyMap[rawKey] ?? rawKey;

    return modKey ? { key, ctrlKey, shiftKey, altKey, metaKey, modKey } : { key, ctrlKey, shiftKey, altKey, metaKey };
}

function andWhen(a: string | undefined, b: string): string {
    return a === undefined ? b : `(${a}) && (${b})`;
}

function resolveModPart(part: Keybinding, modifier: "ctrlKey" | "metaKey"): Keybinding {
    if (part.modKey !== true) return part;
    const { modKey: _mod, ...concrete } = part;
    return { ...concrete, [modifier]: true };
}

/**
 * Expands `mod` into a concrete modifier by mac rung: Ctrl wherever Cmd doesn't
 * get through (pc, mac-legacy, mac-extended), and Cmd on `mac-cmd`. The conditions
 * are mutually exclusive: no environment has both entries active at once.
 * A chord without `mod` is returned as is.
 */
export function expandModKey(
    chord: KeybindingChord,
    when: string | undefined,
): { chord: KeybindingChord; when: string | undefined }[] {
    if (!chord.some((part) => part.modKey === true)) return [{ chord, when }];
    return [
        { chord: chord.map((part) => resolveModPart(part, "ctrlKey")), when: andWhen(when, macKeysBelow("cmd")) },
        { chord: chord.map((part) => resolveModPart(part, "metaKey")), when: andWhen(when, macKeysAtLeast("cmd")) },
    ];
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

/**
 * How to label key combinations (counterpart of VS Code `UILabelProvider` / `AriaLabelProvider`):
 *  - `pc`       — "Ctrl+Shift+K";
 *  - `mac`      — glyphs, as in macOS menus and VS Code on mac: "⇧⌘K", "⌘←";
 *  - `macWords` — words for mac, "Shift+Cmd+K": search by "cmd" and accessible labels.
 */
export type KeybindingLabelStyle = "pc" | "mac" | "macWords";

interface ModifierLabels {
    readonly ctrlKey: string;
    readonly shiftKey: string;
    readonly altKey: string;
    readonly metaKey: string;
    readonly separator: string;
}

// Modifier order matches VS Code (`_simpleAsString`): Ctrl, Shift, Alt, Meta.
const MODIFIER_LABELS: Record<KeybindingLabelStyle, ModifierLabels> = {
    pc: { ctrlKey: "Ctrl", shiftKey: "Shift", altKey: "Alt", metaKey: "Meta", separator: "+" },
    mac: { ctrlKey: "\u2303", shiftKey: "\u21e7", altKey: "\u2325", metaKey: "\u2318", separator: "" },
    macWords: { ctrlKey: "Ctrl", shiftKey: "Shift", altKey: "Option", metaKey: "Cmd", separator: "+" },
};

// On mac VS Code labels arrow keys with arrows: "⌘←", not "⌘Left".
const MAC_ARROWS: Partial<Record<string, string>> = {
    ArrowLeft: "\u2190",
    ArrowUp: "\u2191",
    ArrowRight: "\u2192",
    ArrowDown: "\u2193",
};

function formatKey(key: string, style: KeybindingLabelStyle): string {
    if (key === " ") return "Space";
    if (style === "mac") {
        const arrow = MAC_ARROWS[key];
        if (arrow !== undefined) return arrow;
    }
    if (key.startsWith("Arrow")) return key.slice("Arrow".length); // ArrowLeft → Left
    if (key.length === 1) return key.toUpperCase();
    // Event key values (Enter, PageDown, Home, F1, …) are already display-ready.
    return key;
}

/** Formats a single chord part, e.g. "Ctrl+Shift+K" / "⇧⌘K". */
function formatPart(part: Keybinding, style: KeybindingLabelStyle): string {
    const labels = MODIFIER_LABELS[style];
    const segments: string[] = [];
    if (part.ctrlKey) segments.push(labels.ctrlKey);
    if (part.shiftKey) segments.push(labels.shiftKey);
    if (part.altKey) segments.push(labels.altKey);
    if (part.metaKey) segments.push(labels.metaKey);
    segments.push(formatKey(part.key, style));
    return segments.join(labels.separator);
}

/** Formats a full chord into a human-readable string, e.g. "Ctrl+K Ctrl+S" / "⌘K ⌘S". */
export function formatKeybinding(chord: KeybindingChord, style: KeybindingLabelStyle = "pc"): string {
    return chord.map((part) => formatPart(part, style)).join(" ");
}

/**
 * Label style for the current keyboard: glyphs on mac (`isMac` is the keyboard's OS,
 * not the process's, see `TerminalEnvironmentService`), otherwise pc. The key is re-read
 * on every keypress, so the label follows the OS refined after startup.
 */
export function keybindingLabelStyle(contextKeys: ContextKeyService | undefined): KeybindingLabelStyle {
    return contextKeys?.get("isMac") === true ? "mac" : "pc";
}

// Reverse of specialKeyMap: event key value → spec name ("ArrowUp" → "up", " " → "space").
const specialKeyNames: Record<string, string> = Object.fromEntries(
    Object.entries(specialKeyMap).map(([spec, key]) => [key, spec]),
);

function serializeKey(key: string): string {
    return specialKeyNames[key] ?? key.toLowerCase();
}

/** Serializes a single part into spec form, e.g. "ctrl+shift+k". */
function serializePart(part: Keybinding): string {
    const segments: string[] = [];
    if (part.ctrlKey) segments.push("ctrl");
    if (part.shiftKey) segments.push("shift");
    if (part.altKey) segments.push("alt");
    if (part.metaKey) segments.push("meta");
    if (part.modKey === true) segments.push("mod");
    segments.push(serializeKey(part.key));
    return segments.join("+");
}

/**
 * Serializes a chord into the spec form accepted by {@link parseChord} and
 * keybindings.json, e.g. "ctrl+k ctrl+u". Inverse of parseChord up to key
 * casing (keys outside the special-key table serialize lower-case, which is
 * how parseChord normalizes them anyway). Display formatting is
 * {@link formatKeybinding}, not this.
 */
export function serializeChord(chord: KeybindingChord): string {
    return chord.map(serializePart).join(" ");
}

/** Structural equality of two chords (`-command` unbind matching, conflict grouping). */
export function chordsEqual(a: KeybindingChord, b: KeybindingChord): boolean {
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

    // Layout-independent fallback: for single-letter shortcuts match by physical key code.
    // This makes e.g. Ctrl+S work even when the Russian layout is active. With Alt only a
    // non-Latin key falls back (Alt + Cyrillic "a" → Alt+F): a Latin key decides by itself, so AZERTY Alt+a
    // (physical Q) stays Alt+A — the same rule as the menu bar mnemonics.
    const physicalFallback = event.ctrlKey || event.metaKey || (event.altKey && event.key.charCodeAt(0) >= 0x80);
    // No guards for multi-char keys or a missing code: `Key${"ENTER"}` is never a real code.
    return physicalFallback && event.code === `Key${binding.key.toUpperCase()}`;
}

export class KeybindingRegistry implements IDisposable {
    private entries: KeybindingEntry[] = [];
    /** Entries in ascending priority ({@link sortByPriority}); `null` means rebuild on next read. */
    private prioritized: KeybindingEntry[] | null = null;
    /** Sequence number of the next rule: the tie-breaker at equal weight. */
    private nextSeq = 0;
    /** Extension and user layers, replaced as a whole ({@link setExtensionKeybindings}, {@link setUserKeybindings}). */
    private layers: Record<LayerSource, IKeybindingLayer> = { extension: EMPTY_LAYER, user: EMPTY_LAYER };

    // Events accumulated for an in-progress chord (empty when not in chord mode).
    private pendingEvents: KeyboardEventLike[] = [];

    public register(
        chord: Keybinding | KeybindingChord,
        commandId: string,
        when?: string,
        source: KeybindingSource = "default",
        args?: unknown,
        options: IKeybindingRuleOptions = {},
    ): IDisposable {
        const added = this.createEntries(
            Array.isArray(chord) ? chord : [chord],
            commandId,
            when,
            source,
            args,
            options,
        );
        this.entries.push(...added);
        this.prioritized = null;
        return {
            dispose: () => {
                for (const entry of added) {
                    const index = this.entries.indexOf(entry);
                    if (index !== -1) this.entries.splice(index, 1);
                }
                this.prioritized = null;
            },
        };
    }

    private createEntries(
        chord: KeybindingChord,
        commandId: string,
        when: string | undefined,
        source: KeybindingSource,
        args: unknown,
        options: IKeybindingRuleOptions,
    ): KeybindingEntry[] {
        const seq = this.nextSeq++;
        const weight = options.weight ?? KeybindingWeight.EditorCore;
        return expandModKey(chord, when).map((variant) => ({
            chord: variant.chord,
            commandId,
            when: variant.when,
            source,
            args,
            layer: KeybindingLayerRank[source],
            weight,
            seq,
        }));
    }

    /**
     * Replaces the extension layer (`contributes.keybindings` of all extensions at once,
     * like upstream `setExtensionKeybindings`). The layer's removals (`-command`) drop
     * default and extension entries; user bindings are left alone.
     */
    public setExtensionKeybindings(rules: readonly IKeybindingLayerRule[]): void {
        this.setLayer("extension", rules);
    }

    /**
     * Replaces the user layer (the whole `keybindings.json`). Its bindings beat
     * default and extension regardless of registration time; its removals drop
     * default and extension entries but leave the user's own bindings alone.
     */
    public setUserKeybindings(rules: readonly IKeybindingLayerRule[]): void {
        this.setLayer("user", rules);
    }

    private setLayer(source: LayerSource, rules: readonly IKeybindingLayerRule[]): void {
        const entries: KeybindingEntry[] = [];
        // Stryker disable next-line ArrayDeclaration: equivalent, a stray element without commandId matches no entry
        const removals: IKeybindingRemoval[] = [];
        for (const rule of rules) {
            if (rule.command.startsWith("-")) {
                removals.push({ commandId: rule.command.slice(1), chord: rule.chord, when: rule.when });
            } else if (rule.chord !== undefined) {
                entries.push(...this.createEntries(rule.chord, rule.command, rule.when, source, rule.args, {}));
            }
        }
        this.layers = { ...this.layers, [source]: { entries, removals } };
        this.prioritized = null;
    }

    /**
     * Live entries in ascending priority, the order the resolver reads them in
     * (from the end). Layer removals apply here, declaratively: entries are never
     * deleted, so swapping a layer doesn't shift the priority of the rest.
     */
    private byPriority(): readonly KeybindingEntry[] {
        this.prioritized ??= this.computePriority();
        return this.prioritized;
    }

    private computePriority(): KeybindingEntry[] {
        const { extension, user } = this.layers;
        const removals = [...extension.removals, ...user.removals];
        const live = [...this.entries, ...extension.entries, ...user.entries].filter(
            (entry) => entry.source === "user" || !removals.some((removal) => isTargetedForRemoval(removal, entry)),
        );
        return sortByPriority(live);
    }

    /**
     * Live bindings in ascending priority: among entries of one chord with a
     * passing `when` the resolver picks the last. The user layer beats extension,
     * extension beats defaults; within a layer weight decides, and at equal
     * weight registration order. Removed entries are not listed.
     */
    public listBindings(): readonly IKeybindingEntrySnapshot[] {
        return this.byPriority().map((entry) => ({
            chord: entry.chord,
            commandId: entry.commandId,
            when: entry.when,
            source: entry.source,
            args: entry.args,
        }));
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
        // From the end, strongest first: it wins on a complete match.
        const entries = this.byPriority();
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (!whenPasses(entry) || !prefixMatches(entry)) continue;
            if (entry.chord.length === seq.length) {
                this.pendingEvents = [];
                return { kind: "command", commandId: entry.commandId, when: entry.when, args: entry.args };
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

    /**
     * {@link resolveKey} without side effects: the pending chord stays as it was. Upstream's
     * `softDispatch` — asks what the key would do before deciding who gets it.
     */
    public softResolveKey(event: KeyboardEventLike, contextKeys?: ContextKeyService): KeybindingResolution {
        const pending = this.pendingEvents;
        try {
            return this.resolveKey(event, contextKeys);
        } finally {
            this.pendingEvents = pending;
        }
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
        const entries = this.byPriority();
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
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
     * Returns the chord to display for a command. Priority levels, top to bottom:
     *  1. a binding declared UNDER THE TIER GATE and active now: that's the
     *     canonical VS Code binding (we gate only those), and on a terminal that
     *     delivers it, it is the one to label, not the fallback;
     *  2. other bindings with a passing `when`: a contextual binding is more
     *     useful than an unconditional default;
     *  3. unconditional bindings;
     *  4. any own binding regardless of `when` and shadowing (the command is
     *     unavailable in this context, so label its canonical binding).
     *
     * Within a level own entries go from the higher layer and weight (a user
     * binding before a default one), and on ties in registration order (primary
     * before fallbacks). Levels 1–3 skip shadowed entries: those whose chord the
     * resolver would hand to another command in this context (a stronger entry
     * on the same chord or a complete prefix chord), so the label never promises
     * someone else's key.
     *
     * Deliverability cuts across levels: a chord the current tier's terminal
     * doesn't deliver loses to any deliverable one, otherwise the command palette
     * and menus would label the command with a dead binding (as happened with Format
     * Document: Shift+Alt+F and the chord share one action-wide `when`, and the
     * unreachable one came first; and in the command palette, where the conditional
     * Ctrl+Shift+P beat the unconditional F1). With no deliverable chord at all
     * the label stays as before: showing the canonical binding is more honest than nothing.
     *
     * `overlay` is a "what if" context (see `ContextKeyService.evaluate`): the label
     * of a binding for a field that isn't focused now is computed with its focus key.
     */
    public getKeybindingForCommand(
        commandId: string,
        contextKeys?: ContextKeyService,
        overlay?: Readonly<Record<string, boolean | string | number>>,
    ): KeybindingChord | undefined {
        // Without context the tier is unknown: assume everything gets through (label
        // as before, by registration order).
        const legacyTerminal = contextKeys?.get("tier") === "legacy";
        const deliverable = (chord: KeybindingChord): boolean => !legacyTerminal || !requiresExtendedKeys(chord);
        // The `when` text can't tell the canonical binding from the fallback: both
        // also carry the command's scope. Semantics can: the canonical one stops
        // applying once the terminal is "downgraded" to legacy.
        const asLegacy = { ...overlay, tier: "legacy" };

        const prioritized = this.byPriority();
        const passes = (entry: KeybindingEntry): boolean =>
            !entry.when || contextKeys?.evaluate(entry.when, overlay) === true;
        // Whether the entry is shadowed in this context, i.e. the resolver would hand
        // its chord to another command: a stronger entry on the same chord or a
        // shorter prefix chord (a complete match at a lower depth always wins).
        // Labeling a shadowed entry promises someone else's key.
        const shadowed = (entry: KeybindingEntry): boolean =>
            prioritized.some(
                (other, index) =>
                    other.commandId !== commandId &&
                    passes(other) &&
                    (other.chord.length < entry.chord.length
                        ? chordsEqual(other.chord, entry.chord.slice(0, other.chord.length))
                        : chordsEqual(other.chord, entry.chord) && index > prioritized.indexOf(entry)),
            );
        // Own entries from the higher layer and weight; within one, in registration
        // order, so the action's primary comes before its fallback bindings.
        const own = prioritized
            .filter((entry) => entry.commandId === commandId)
            .sort((a, b) => b.layer - a.layer || b.weight - a.weight || a.seq - b.seq);

        const gated: KeybindingChord[] = [];
        const passing: KeybindingChord[] = [];
        const unconditional: KeybindingChord[] = [];
        for (const entry of own) {
            if (shadowed(entry)) continue;
            if (!entry.when) {
                unconditional.push(entry.chord);
                continue;
            }
            if (!passes(entry)) continue;
            (contextKeys?.evaluate(entry.when, asLegacy) === true ? passing : gated).push(entry.chord);
        }
        // The last level is all own entries ignoring context: the command is unavailable
        // here, and the label is its canonical (first) binding, as before.
        const ranked = [...gated, ...passing, ...unconditional, ...own.map((entry) => entry.chord)];
        return ranked.find(deliverable) ?? ranked.at(0);
    }

    public dispose(): void {
        this.entries.length = 0;
        this.layers = { extension: EMPTY_LAYER, user: EMPTY_LAYER };
        this.prioritized = null;
        this.pendingEvents = [];
    }
}
