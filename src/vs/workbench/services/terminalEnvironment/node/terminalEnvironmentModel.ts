import { isInsideTmux, isSsh } from "@tuidom/terminal-backend/terminalEnv";

import type { MacKeysRung } from "../../../../platform/keybinding/common/macKeys.ts";

// Three axes: capabilities (independent flags), tier (an ordered ladder of capability
// bundles), modes (an unordered set of contexts: local/ssh/tmux plus custom).

/**
 * `super` — «Cmd доезжает»: из tier не выводится (kitty под tmux — это
 * `tier == kitty`, а super мёртв), поэтому отдельный примитив.
 */
export type Capability = "extended-keys" | "osc52" | "truecolor" | "kitty-graphics" | "mouse-sgr" | "super";

export const ALL_CAPABILITIES: readonly Capability[] = [
    "extended-keys",
    "osc52",
    "truecolor",
    "kitty-graphics",
    "mouse-sgr",
    "super",
];

export type CapabilitySet = Record<Capability, boolean>;

export function emptyCapabilities(): CapabilitySet {
    return {
        "extended-keys": false,
        osc52: false,
        truecolor: false,
        "kitty-graphics": false,
        "mouse-sgr": false,
        super: false,
    };
}

export type Tier = "legacy" | "csi-u" | "kitty";
export const TIER_ORDER: readonly Tier[] = ["legacy", "csi-u", "kitty"];

export function resolveTier(caps: CapabilitySet): Tier {
    if (caps["extended-keys"] && caps["kitty-graphics"]) return "kitty";
    if (caps["extended-keys"]) return "csi-u";
    return "legacy";
}

export function tierAtLeast(a: Tier, b: Tier): boolean {
    return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b);
}

/**
 * ОС **клавиатуры**, а не процесса: по ssh с мака на Linux-хост раскладка
 * должна быть маковской, хотя `process.platform === "linux"`. Так же поступает
 * эталон — раскладку решает UI-сторона.
 */
export type OsName = "mac" | "linux" | "windows";

const OS_NAMES: readonly OsName[] = ["mac", "linux", "windows"];

/**
 * Провенанс ответа — для статус-бара и Keyboard Doctor:
 *  - setting:  `keyboard.platform` — человек всегда прав;
 *  - env:      `LC_DIODE_PLATFORM` из конфига эмулятора (LC_* доезжает по ssh);
 *  - terminal: сам терминал назвался маковским (`LC_TERMINAL`, XTVERSION);
 *  - platform: `process.platform` локальной сессии;
 *  - default:  сигналов нет — «не знаю», считаем не-мак.
 */
export type OsSource = "setting" | "env" | "terminal" | "platform" | "default";

export interface ResolvedOs {
    readonly os: OsName;
    readonly source: OsSource;
}

export interface OsSignals {
    readonly setting?: string;
    readonly envPlatform?: string;
    /** iTerm2 ставит сам. */
    readonly lcTerminal?: string;
    /** XTVERSION или tmux `#{client_termtype}`, напр. `iTerm2 3.5.0`, `kitty(0.45.0)`. */
    readonly terminalName?: string;
    readonly platform: NodeJS.Platform;
    readonly ssh: boolean;
}

/** Префиксы ответа XTVERSION / LC_TERMINAL. */
const MAC_ONLY_TERMINALS = ["iterm2", "apple_terminal"];

function asOsName(value: string | undefined): OsName | undefined {
    const normalized = value?.trim().toLowerCase();
    return OS_NAMES.find((name) => name === normalized);
}

/** Только позитив: незнакомое имя — «не знаю», а не «не мак». */
export function isMacOnlyTerminal(name: string | undefined): boolean {
    // Stryker disable next-line StringLiteral: любой непустой заменитель тоже не совпадёт ни с одним префиксом — эквивалентный мутант.
    const normalized = name?.trim().toLowerCase() ?? "";
    return MAC_ONLY_TERMINALS.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Лестница сигналов «какая ОС у клавиатуры», сверху вниз:
 *  1. настройка `keyboard.platform` (кроме `auto`);
 *  2. `LC_DIODE_PLATFORM`;
 *  3. `LC_TERMINAL` маковского терминала;
 *  4. имя терминала (XTVERSION / tmux `client_termtype`) — маковское;
 *  5. `process.platform === "darwin"` — но не по ssh: в мак могли зайти с PC-клавиатуры;
 *  6. иначе — не мак.
 *
 * Пп. 1–2 — явные и могут сказать «не мак». Пп. 3–5 только позитивные: не
 * сработали ⇒ «не знаю», и решение отдаётся ступени ниже.
 */
export function resolveOs(signals: OsSignals): ResolvedOs {
    const fromSetting = asOsName(signals.setting);
    if (fromSetting) return { os: fromSetting, source: "setting" };
    const fromEnv = asOsName(signals.envPlatform);
    if (fromEnv) return { os: fromEnv, source: "env" };
    if (isMacOnlyTerminal(signals.lcTerminal) || isMacOnlyTerminal(signals.terminalName)) {
        return { os: "mac", source: "terminal" };
    }
    if (signals.platform === "darwin" && !signals.ssh) return { os: "mac", source: "platform" };
    if (signals.platform === "win32" && !signals.ssh) return { os: "windows", source: "platform" };
    return { os: "linux", source: "default" };
}

/**
 * Можно ли поздним (асинхронным) сигналом перевернуть уже принятый ответ.
 * Только в сторону мака и никогда обратно; явный ответ человека (настройка,
 * переменная) поздний сигнал не перебивает.
 */
export function canUpgradeToMac(current: ResolvedOs, next: ResolvedOs): boolean {
    if (current.os === "mac" || next.os !== "mac") return false;
    return current.source !== "setting" && current.source !== "env";
}

/**
 * Рунг мак-лестницы из (os, caps, modes); `undefined` — клавиатура не маковская.
 * Под tmux Cmd не бывает никогда, даже при форсированном `super`: tmux пишет
 * Alt и super в один бит, и Cmd-бинд выстрелил бы по команде на Alt.
 */
export function resolveMacKeysRung(
    os: OsName,
    caps: CapabilitySet,
    modes: ReadonlySet<string>,
): MacKeysRung | undefined {
    if (os !== "mac") return undefined;
    if (caps.super && !modes.has("tmux")) return "cmd";
    if (caps["extended-keys"]) return "extended";
    return "legacy";
}

export type BuiltinMode = "local" | "ssh" | "tmux";

export function detectBaseModes(env: NodeJS.ProcessEnv = process.env): Set<BuiltinMode> {
    const modes = new Set<BuiltinMode>();
    const ssh = isSsh(env);
    if (ssh) modes.add("ssh");
    else modes.add("local");
    if (isInsideTmux(env)) modes.add("tmux");
    return modes;
}

const TRUECOLOR_TERM_HINTS = ["truecolor", "24bit"];
const KITTY_TERM_HINTS = ["kitty", "ghostty", "wezterm"];
const EXTENDED_KEYS_TERM_HINTS = ["kitty", "ghostty", "wezterm", "foot", "rio", "alacritty"];
/** Env flags set by those terminals (survive even when $TERM is masked, e.g. inside tmux). */
const EXTENDED_KEYS_ENV_FLAGS = ["KITTY_WINDOW_ID", "GHOSTTY_RESOURCES_DIR", "WEZTERM_PANE", "ALACRITTY_WINDOW_ID"];

function termHaystack(env: NodeJS.ProcessEnv): string {
    return `${env.TERM ?? ""} ${env.TERM_PROGRAM ?? ""}`.toLowerCase();
}

export function detectTruecolor(env: NodeJS.ProcessEnv = process.env): boolean {
    const colorterm = (env.COLORTERM ?? "").toLowerCase();
    return TRUECOLOR_TERM_HINTS.includes(colorterm);
}

/** DA1 doesn't reliably advertise kitty graphics, so it is inferred from $TERM / $TERM_PROGRAM. */
export function detectKittyGraphicsHint(env: NodeJS.ProcessEnv = process.env): boolean {
    const haystack = termHaystack(env);
    return KITTY_TERM_HINTS.some((h) => haystack.includes(h));
}

/**
 * Provisional value until the async probe; under tmux/ssh $TERM is often masked, so it may
 * under-report. Под tmux env-флаги хост-терминала (`KITTY_WINDOW_ID` пробрасывается) ничего
 * не доказывают: расширенные клавиши доходят, только если их пропускает сам tmux
 * (`extended-keys on`, ≥ 3.2). Поверив флагу, мы завышали tier и выключали legacy-фоллбэки —
 * Ctrl+Shift+F приезжал как Ctrl+F. Под мультиплексором ждём probe или увиденный расширенный ввод.
 */
export function detectExtendedKeysHint(env: NodeJS.ProcessEnv = process.env): boolean {
    const haystack = termHaystack(env);
    if (EXTENDED_KEYS_TERM_HINTS.some((h) => haystack.includes(h))) return true;
    if (isInsideTmux(env)) return false;
    return EXTENDED_KEYS_ENV_FLAGS.some((flag) => env[flag] != null && env[flag] !== "");
}
