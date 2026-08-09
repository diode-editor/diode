import { isInsideTmux, isSsh } from "../../../../../../tuidom/backend/terminalEnv.ts";

/**
 * Pure model for terminal-environment detection. No I/O, no DI — fully
 * unit-testable. The service layer (TerminalEnvironmentService) wires these
 * functions to the real backend probe + config overrides.
 *
 * Three axes (see plan / [[keybinding-resolver-design]]):
 *  - Capability: independent feature flags the terminal supports.
 *  - Tier: a named preset bundle of capabilities, an ordered ladder.
 *  - Mode: an unordered set of named contexts (local/ssh/tmux, plus custom).
 */

// ─── Capabilities ───

export type Capability = "extended-keys" | "osc52" | "truecolor" | "kitty-graphics" | "mouse-sgr";

export const ALL_CAPABILITIES: readonly Capability[] = [
    "extended-keys",
    "osc52",
    "truecolor",
    "kitty-graphics",
    "mouse-sgr",
];

export type CapabilitySet = Record<Capability, boolean>;

export function emptyCapabilities(): CapabilitySet {
    return {
        "extended-keys": false,
        osc52: false,
        truecolor: false,
        "kitty-graphics": false,
        "mouse-sgr": false,
    };
}

// ─── Tier ───

/** Ordered capability ladder, weakest → strongest. */
export type Tier = "legacy" | "csi-u" | "kitty";
export const TIER_ORDER: readonly Tier[] = ["legacy", "csi-u", "kitty"];

/**
 * Resolve the tier from a capability set.
 *  - kitty:  full Kitty keyboard protocol + graphics (top-tier modern terminal)
 *  - csi-u:  can disambiguate modified keys (extended-keys / modifyOtherKeys)
 *  - legacy: ambiguous control codes only
 */
export function resolveTier(caps: CapabilitySet): Tier {
    if (caps["extended-keys"] && caps["kitty-graphics"]) return "kitty";
    if (caps["extended-keys"]) return "csi-u";
    return "legacy";
}

/** True when tier `a` is at least as capable as tier `b`. */
export function tierAtLeast(a: Tier, b: Tier): boolean {
    return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b);
}

// ─── OS ───

export type OsName = "mac" | "linux" | "windows";

export function resolveOs(platform: NodeJS.Platform): OsName {
    if (platform === "darwin") return "mac";
    if (platform === "win32") return "windows";
    return "linux";
}

// ─── Modes ───

export type BuiltinMode = "local" | "ssh" | "tmux";

/**
 * The auto-detected (predicate-driven) modes for an environment snapshot.
 * `local` is the absence of `ssh`. Custom/manual modes are layered on top by
 * the service; they are not derivable from the environment.
 */
export function detectBaseModes(env: NodeJS.ProcessEnv = process.env): Set<BuiltinMode> {
    const modes = new Set<BuiltinMode>();
    const ssh = isSsh(env);
    if (ssh) modes.add("ssh");
    else modes.add("local");
    if (isInsideTmux(env)) modes.add("tmux");
    return modes;
}

// ─── Sync capability hints (no probe required) ───

const TRUECOLOR_TERM_HINTS = ["truecolor", "24bit"];
const KITTY_TERM_HINTS = ["kitty", "ghostty", "wezterm"];
/** Terminals known to speak the Kitty keyboard protocol (extended-keys). */
const EXTENDED_KEYS_TERM_HINTS = ["kitty", "ghostty", "wezterm", "foot", "rio", "alacritty"];
/** Env flags set by those terminals (survive even when $TERM is masked, e.g. inside tmux). */
const EXTENDED_KEYS_ENV_FLAGS = ["KITTY_WINDOW_ID", "GHOSTTY_RESOURCES_DIR", "WEZTERM_PANE", "ALACRITTY_WINDOW_ID"];

function termHaystack(env: NodeJS.ProcessEnv): string {
    return `${env.TERM ?? ""} ${env.TERM_PROGRAM ?? ""}`.toLowerCase();
}

/** Truecolor is reliably advertised by $COLORTERM. */
export function detectTruecolor(env: NodeJS.ProcessEnv = process.env): boolean {
    const colorterm = (env.COLORTERM ?? "").toLowerCase();
    return TRUECOLOR_TERM_HINTS.includes(colorterm);
}

/**
 * kitty-graphics support is best-effort: DA1 doesn't reliably advertise it, so
 * we infer it from $TERM / $TERM_PROGRAM naming the known graphics terminals.
 */
export function detectKittyGraphicsHint(env: NodeJS.ProcessEnv = process.env): boolean {
    const haystack = termHaystack(env);
    return KITTY_TERM_HINTS.some((h) => haystack.includes(h));
}

/**
 * Synchronous best-guess for Kitty keyboard-protocol support from environment alone —
 * the provisional value used at startup before (and if) an async probe confirms it.
 * Note: inside tmux/ssh $TERM is often masked, so this may under-report; the async
 * probe upgrades it.
 *
 * Внутри tmux env-флаги хост-терминала ничего не доказывают: kitty пробрасывает
 * `KITTY_WINDOW_ID` через ssh и в сессию tmux, но расширенные клавиши до нас
 * доходят только если сам tmux их пропускает (`extended-keys on`, tmux ≥ 3.2).
 * По умолчанию он этого не делает — и Ctrl+Shift+F приезжает неотличимым от
 * Ctrl+F. Поверив флагу, мы завышали tier и выключали legacy-фоллбэки, то есть
 * теряли и комбинацию, и запасной путь к команде. Поэтому под мультиплексором
 * ждём подтверждения: probe (`CSI ? u`) или реально увиденный расширенный ввод.
 */
export function detectExtendedKeysHint(env: NodeJS.ProcessEnv = process.env): boolean {
    const haystack = termHaystack(env);
    if (EXTENDED_KEYS_TERM_HINTS.some((h) => haystack.includes(h))) return true;
    if (isInsideTmux(env)) return false;
    return EXTENDED_KEYS_ENV_FLAGS.some((flag) => env[flag] != null && env[flag] !== "");
}
