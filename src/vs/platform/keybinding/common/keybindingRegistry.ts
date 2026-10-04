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
    /**
     * Токен `mod` (аналог `KeyMod.CtrlCmd` VS Code): Ctrl на pc и на мак-рунгах
     * ниже cmd, Cmd — на `mac-cmd`. Реестр разворачивает такую часть в две
     * конкретные записи с условием по рунгу (см. {@link expandModKey}); в
     * самих записях реестра `modKey` не встречается.
     */
    modKey?: boolean;
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
    | { kind: "command"; commandId: string; when?: string; args?: unknown }
    | { kind: "chord"; chord: KeybindingChord }
    | { kind: "none" };

/** Where a registry entry came from — drives the Source column and reset semantics in the shortcuts editor. */
export type KeybindingSource = "default" | "extension" | "user";

/** Read-only view of a registry entry (shortcuts editor, user-rule bookkeeping). */
export interface IKeybindingEntrySnapshot {
    readonly chord: KeybindingChord;
    readonly commandId: string;
    readonly when?: string;
    readonly source: KeybindingSource;
    /** Аргумент команды (VS Code `args` у правила): передаётся первым аргументом `execute`. */
    readonly args?: unknown;
}

interface KeybindingEntry extends IKeybindingPriority {
    chord: KeybindingChord;
    commandId: string;
    when?: string;
    source: KeybindingSource;
    args?: unknown;
}

/** Правило слоя extension или user: бинд либо снятие (`-command`, как в VS Code). */
export interface IKeybindingLayerRule {
    /** Id команды; ведущий `-` — снять её бинды из слоёв default и extension. */
    readonly command: string;
    /** У снятия необязательна: без комбинации снимаются все бинды команды. */
    readonly chord?: KeybindingChord;
    /** У снятия — снимаются только записи, чей `when` содержит все условия этого. */
    readonly when?: string;
    readonly args?: unknown;
}

/** Снятие бинда: какие записи default/extension исключить из резолва. */
interface IKeybindingRemoval {
    readonly commandId: string;
    readonly chord: KeybindingChord | undefined;
    readonly when: string | undefined;
}

type LayerSource = Exclude<KeybindingSource, "default">;

/** Слой extension или user: его бинды и снятия, заменяются целиком. */
interface IKeybindingLayer {
    readonly entries: readonly KeybindingEntry[];
    readonly removals: readonly IKeybindingRemoval[];
}

const EMPTY_LAYER: IKeybindingLayer = { entries: [], removals: [] };

/** Условия when как набор канонических конъюнктов: `(a) && (b && c)` → `{a, b, c}`. */
function whenTerms(when: string): string[] {
    const expr = deserializeWhen(when);
    return expr === undefined ? [when] : conjuncts(expr);
}

function conjuncts(expr: ContextKeyExpression): string[] {
    return expr.type === "and" ? expr.exprs.flatMap(conjuncts) : [serializeWhen(expr)];
}

/**
 * Снимает ли снятие запись. When у снятия сопоставляется включением (как
 * `whenIsEntirelyIncluded` upstream, в упрощении до конъюнктов): запись
 * снимается, если её `when` содержит все условия снятия.
 */
function isTargetedForRemoval(removal: IKeybindingRemoval, entry: KeybindingEntry): boolean {
    if (removal.commandId !== entry.commandId) return false;
    if (removal.chord !== undefined && !chordsEqual(removal.chord, entry.chord)) return false;
    if (removal.when === undefined) return true;
    // Stryker disable next-line ConditionalExpression: эквивалентный — разбор undefined даёт [undefined], и непустые условия снятия в нём не найдутся
    if (entry.when === undefined) return false;
    const entryTerms = whenTerms(entry.when);
    return whenTerms(removal.when).every((term) => entryTerms.includes(term));
}

/** Необязательные параметры правила. */
export interface IKeybindingRuleOptions {
    /** Вес правила ({@link KeybindingWeight}); по умолчанию `EditorCore`. */
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

/** AND двух необязательных when-выражений. */
function andWhen(a: string | undefined, b: string): string {
    return a === undefined ? b : `(${a}) && (${b})`;
}

function resolveModPart(part: Keybinding, modifier: "ctrlKey" | "metaKey"): Keybinding {
    if (part.modKey !== true) return part;
    const { modKey: _mod, ...concrete } = part;
    return { ...concrete, [modifier]: true };
}

/**
 * Разворачивает `mod` в конкретный модификатор по мак-рунгу: Ctrl везде, где
 * Cmd не доезжает (pc, mac-legacy, mac-extended), и Cmd на `mac-cmd`. Условия
 * взаимоисключающие — ни в одном окружении обе записи не активны разом.
 * Чорд без `mod` возвращается как есть.
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
 * Как подписывать комбинации (аналог `UILabelProvider` / `AriaLabelProvider` VS Code):
 *  - `pc`       — «Ctrl+Shift+K»;
 *  - `mac`      — глифами, как в меню macOS и в VS Code на маке: «⇧⌘K», «⌘←»;
 *  - `macWords` — словами для мака, «Shift+Cmd+K»: поиск по «cmd» и доступные подписи.
 */
export type KeybindingLabelStyle = "pc" | "mac" | "macWords";

interface ModifierLabels {
    readonly ctrlKey: string;
    readonly shiftKey: string;
    readonly altKey: string;
    readonly metaKey: string;
    readonly separator: string;
}

// Порядок модификаторов — как у VS Code (`_simpleAsString`): Ctrl, Shift, Alt, Meta.
const MODIFIER_LABELS: Record<KeybindingLabelStyle, ModifierLabels> = {
    pc: { ctrlKey: "Ctrl", shiftKey: "Shift", altKey: "Alt", metaKey: "Meta", separator: "+" },
    mac: { ctrlKey: "\u2303", shiftKey: "\u21e7", altKey: "\u2325", metaKey: "\u2318", separator: "" },
    macWords: { ctrlKey: "Ctrl", shiftKey: "Shift", altKey: "Option", metaKey: "Cmd", separator: "+" },
};

// Стрелки на маке VS Code подписывает стрелками: «⌘←», а не «⌘Left».
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
 * Стиль подписи под текущую клавиатуру: глифы на маке (`isMac` — ОС клавиатуры,
 * а не процесса, см. `TerminalEnvironmentService`), иначе pc. Ключ перечитывается
 * на каждом нажатии, так что подпись следует за уточнённой после старта ОС.
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
    /** Записи по возрастанию приоритета ({@link sortByPriority}); `null` — пересобрать при следующем чтении. */
    private prioritized: KeybindingEntry[] | null = null;
    /** Номер следующего правила — тайбрейк при равном весе. */
    private nextSeq = 0;
    /** Слои extension и user: заменяются целиком ({@link setExtensionKeybindings}, {@link setUserKeybindings}). */
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
     * Заменяет слой расширений (`contributes.keybindings` всех расширений разом,
     * как upstream `setExtensionKeybindings`). Снятия слоя (`-command`) убирают
     * записи default и extension; user-бинды они не трогают.
     */
    public setExtensionKeybindings(rules: readonly IKeybindingLayerRule[]): void {
        this.setLayer("extension", rules);
    }

    /**
     * Заменяет слой пользователя (`keybindings.json` целиком). Его бинды
     * сильнее default и extension независимо от момента регистрации, снятия
     * убирают записи default и extension — свои user-бинды не трогают.
     */
    public setUserKeybindings(rules: readonly IKeybindingLayerRule[]): void {
        this.setLayer("user", rules);
    }

    private setLayer(source: LayerSource, rules: readonly IKeybindingLayerRule[]): void {
        const entries: KeybindingEntry[] = [];
        // Stryker disable next-line ArrayDeclaration: эквивалентный — посторонний элемент без commandId ни с одной записью не совпадёт
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
     * Действующие записи по возрастанию приоритета — порядок, в котором их
     * читает резолвер (с конца). Снятия слоёв применяются здесь, декларативно:
     * записи никуда не удаляются, поэтому смена слоя не сдвигает приоритет
     * остальных.
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
     * Действующие бинды по возрастанию приоритета: из записей одной
     * комбинации с проходящим `when` резолвер выбирает последнюю. Слой user
     * сильнее extension, extension — дефолтов; внутри слоя — вес, при равном
     * весе — порядок регистрации. Снятые записи сюда не попадают.
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
        // С конца — от самого сильного: на полном совпадении побеждает он.
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
     * Returns the chord to display for a command. Ступени приоритета, сверху вниз:
     *  1. бинд, объявленный ПОД TIER-ГЕЙТОМ и действующий сейчас — это
     *     канонический бинд VS Code (мы гейтим только такие), и на терминале,
     *     который его передаёт, подписывать надо именно его, а не фолбэк;
     *  2. остальные бинды с проходящим `when` — контекстный бинд полезнее
     *     безусловного дефолта;
     *  3. безусловные бинды;
     *  4. любой свой бинд, независимо от `when` и перехвата (команда в этом
     *     контексте недоступна — подпись её канонического бинда).
     *
     * Внутри ступени свои записи идут от старшего слоя и веса (пользовательский
     * бинд — раньше дефолтного), при равных — в порядке регистрации (primary
     * раньше запасных). В ступенях 1–3 пропускаются перехваченные записи: те,
     * чью комбинацию резолвер в этом контексте отдал бы другой команде (более
     * сильной записи на той же комбинации или полной комбинации-префиксу), —
     * подпись не обещает чужую клавишу.
     *
     * Поперёк ступеней действует доставляемость: комбинация, которую терминал
     * текущего tier'а не передаёт, проигрывает любой доставляемой — иначе
     * палитра и меню подписывали бы команду нерабочим биндом (так было у Format
     * Document: Shift+Alt+F и чорд делят один action-wide `when`, и первым шёл
     * недостижимый; и у палитры, где условный Ctrl+Shift+P обгонял безусловный
     * F1). Если доставляемой комбинации нет вовсе, подпись остаётся прежней —
     * честнее показать канонический бинд, чем ничего.
     *
     * `overlay` — контекст «что если» (см. `ContextKeyService.evaluate`): подпись
     * бинда поля, которое сейчас не в фокусе, считается с его фокус-ключом.
     */
    public getKeybindingForCommand(
        commandId: string,
        contextKeys?: ContextKeyService,
        overlay?: Readonly<Record<string, boolean | string | number>>,
    ): KeybindingChord | undefined {
        // Без контекста tier неизвестен — считаем, что доезжает всё (подпись
        // как раньше, по порядку регистрации).
        const legacyTerminal = contextKeys?.get("tier") === "legacy";
        const deliverable = (chord: KeybindingChord): boolean => !legacyTerminal || !requiresExtendedKeys(chord);
        // Отличить канонический бинд от фолбэка по тексту `when` нельзя: оба
        // несут ещё и область команды. Зато можно по смыслу — канонический
        // перестаёт действовать, если «ухудшить» терминал до legacy.
        const asLegacy = { ...overlay, tier: "legacy" };

        const prioritized = this.byPriority();
        const passes = (entry: KeybindingEntry): boolean =>
            !entry.when || contextKeys?.evaluate(entry.when, overlay) === true;
        // Затенена ли запись в этом контексте — то есть отдал бы резолвер её
        // комбинацию другой команде: более сильной записи на той же комбинации
        // или более короткой комбинации-префиксу (полное совпадение на меньшей
        // глубине побеждает всегда). Затенённую подписывать — обещать чужое.
        const shadowed = (entry: KeybindingEntry): boolean =>
            prioritized.some(
                (other, index) =>
                    other.commandId !== commandId &&
                    passes(other) &&
                    (other.chord.length < entry.chord.length
                        ? chordsEqual(other.chord, entry.chord.slice(0, other.chord.length))
                        : chordsEqual(other.chord, entry.chord) && index > prioritized.indexOf(entry)),
            );
        // Свои записи — от старшего слоя и веса; внутри одного — в порядке
        // регистрации, чтобы primary экшена шёл раньше его запасных биндов.
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
        // Последняя ступень — все свои записи без учёта контекста: команда здесь
        // недоступна, и подпись — её канонический (первый) бинд, как раньше.
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
