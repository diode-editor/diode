import { isInsideTmux, isSsh } from "@tuidom/terminal-backend/terminalEnv";

import type { MacKeysRung } from "../../../../platform/keybinding/common/macKeys.ts";

// Three axes: capabilities (independent flags), tier (an ordered ladder of capability
// bundles), modes (an unordered set of contexts: local/ssh/tmux plus custom).

/**
 * `super` means "Cmd gets through": it does not follow from tier (kitty under tmux is
 * `tier == kitty` with super dead), hence a separate primitive.
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
 * The OS of the **keyboard**, not the process: over ssh from a Mac to a Linux host the
 * layout must be the Mac one, even though `process.platform === "linux"`. Upstream does
 * the same — the UI side decides the layout.
 */
export type OsName = "mac" | "linux" | "windows";

const OS_NAMES: readonly OsName[] = ["mac", "linux", "windows"];

/**
 * Provenance of the answer, for the status bar and Keyboard Doctor:
 *  - setting:  `keyboard.platform` — the user is always right;
 *  - env:      `LC_DIODE_PLATFORM` from the emulator config (LC_* passes through ssh);
 *  - terminal: the terminal itself identified as a Mac one (`LC_TERMINAL`, XTVERSION);
 *  - platform: `process.platform` of a local session;
 *  - default:  no signals — "unknown", treated as non-mac.
 */
export type OsSource = "setting" | "env" | "terminal" | "platform" | "default";

export interface ResolvedOs {
    readonly os: OsName;
    readonly source: OsSource;
}

export interface OsSignals {
    readonly setting?: string;
    readonly envPlatform?: string;
    /** Set by iTerm2 itself. */
    readonly lcTerminal?: string;
    /** XTVERSION or tmux `#{client_termtype}`, e.g. `iTerm2 3.5.0`, `kitty(0.45.0)`. */
    readonly terminalName?: string;
    readonly platform: NodeJS.Platform;
    readonly ssh: boolean;
}

/** Prefixes of the XTVERSION / LC_TERMINAL reply. */
const MAC_ONLY_TERMINALS = ["iterm2", "apple_terminal"];

function asOsName(value: string | undefined): OsName | undefined {
    const normalized = value?.trim().toLowerCase();
    return OS_NAMES.find((name) => name === normalized);
}

/** Positive only: an unknown name means "unknown", not "not mac". */
export function isMacOnlyTerminal(name: string | undefined): boolean {
    // Stryker disable next-line StringLiteral: any non-empty replacement matches no prefix either — an equivalent mutant.
    const normalized = name?.trim().toLowerCase() ?? "";
    return MAC_ONLY_TERMINALS.some((prefix) => normalized.startsWith(prefix));
}

/**
 * The "which OS is the keyboard" signal ladder, top to bottom:
 *  1. the `keyboard.platform` setting (except `auto`);
 *  2. `LC_DIODE_PLATFORM`;
 *  3. `LC_TERMINAL` of a Mac terminal;
 *  4. a Mac terminal name (XTVERSION / tmux `client_termtype`);
 *  5. `process.platform === "darwin"` — but not over ssh: the Mac may be reached from a PC keyboard;
 *  6. otherwise not mac.
 *
 * Steps 1–2 are explicit and may say "not mac". Steps 3–5 are positive only: if they
 * do not fire, the answer is "unknown" and the decision passes to the next step down.
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
 * Whether a late (async) signal may flip an already resolved answer.
 * Only towards mac, never back; a late signal does not override an explicit user
 * answer (setting, variable).
 */
export function canUpgradeToMac(current: ResolvedOs, next: ResolvedOs): boolean {
    if (current.os === "mac" || next.os !== "mac") return false;
    return current.source !== "setting" && current.source !== "env";
}

/**
 * Rung of the mac ladder from (os, caps, modes); `undefined` means the keyboard is not a Mac one.
 * Under tmux there is never Cmd, even with a forced `super`: tmux encodes Alt and super
 * in one bit, so a Cmd binding would fire on an Alt keypress.
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
 * under-report. Under tmux the host terminal's env flags (`KITTY_WINDOW_ID` is passed through) prove
 * nothing: extended keys get through only if tmux itself passes them (`extended-keys on`, ≥ 3.2).
 * Trusting the flag overstated the tier and disabled legacy fallbacks, so Ctrl+Shift+F arrived as
 * Ctrl+F. Under a multiplexer, wait for the probe or observed extended input.
 */
export function detectExtendedKeysHint(env: NodeJS.ProcessEnv = process.env): boolean {
    const haystack = termHaystack(env);
    if (EXTENDED_KEYS_TERM_HINTS.some((h) => haystack.includes(h))) return true;
    if (isInsideTmux(env)) return false;
    return EXTENDED_KEYS_ENV_FLAGS.some((flag) => env[flag] != null && env[flag] !== "");
}
