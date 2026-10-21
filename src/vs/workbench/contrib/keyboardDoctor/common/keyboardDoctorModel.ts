import type { RawTerminalToken } from "@tuidom/core/input/rawTerminalToken";
import { tokenize } from "@tuidom/core/input/tokenize";

import type { Keybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

// The report must show WHERE the key got lost: did not arrive, arrived without the modifier, or did not match.
// Check protocol: docs/TODO/MacKeybindings.md#протокол-фидбека-от-маковода.

export interface KeyboardDoctorEnv {
    readonly os: string;
    readonly osSource: string;
    readonly tier: string;
    /** Mac ladder rung; `undefined` — not a Mac keyboard. */
    readonly macKeysRung: string | undefined;
    readonly capabilities: readonly string[];
    readonly modes: readonly string[];
    /** How the outer terminal identified itself (tmux client_termtype / XTVERSION / LC_TERMINAL / TERM_PROGRAM). */
    readonly terminalName: string | undefined;
    readonly term: string | undefined;
}

export interface ObservedKey {
    readonly raw: string;
    readonly key: string;
    readonly code: string;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
}

export interface MatchedBinding {
    readonly commandId: string;
    readonly when: string | undefined;
    readonly active: boolean;
}

export interface DoctorStep {
    readonly id: string;
    readonly prompt: string;
    /** What should arrive; `undefined` — wait for a printable character without modifiers. */
    readonly expected: Keybinding | undefined;
    readonly expectsBinding: boolean;
    /** Wait for keyup of this modifier key (hold sessions: Ctrl+Tab). */
    readonly keyUp?: string;
    readonly catches: string;
}

export type Verdict =
    | { readonly kind: "ok" }
    | { readonly kind: "lost" }
    | { readonly kind: "missing-modifier"; readonly missing: readonly string[] }
    | { readonly kind: "different" }
    | { readonly kind: "not-matched" }
    | { readonly kind: "no-keyup" };

export interface StepResult {
    readonly step: DoctorStep;
    /** `null` — the user marked "nothing happened". */
    readonly received: ObservedKey | null;
    readonly bindings: readonly MatchedBinding[];
    readonly keyUpSeen: boolean;
}

function isMac(env: KeyboardDoctorEnv): boolean {
    return env.os === "mac";
}

function inTmux(env: KeyboardDoctorEnv): boolean {
    return env.modes.includes("tmux");
}

/** `mod` to a concrete modifier — as the registry expands it on this rung. */
function concrete(spec: string, env: KeyboardDoctorEnv): Keybinding {
    return parseKeybinding(spec.replace("mod+", env.macKeysRung === "cmd" ? "meta+" : "ctrl+"));
}

function step(
    env: KeyboardDoctorEnv,
    id: string,
    spec: string,
    catches: string,
    options: { expectsBinding?: boolean; prompt?: string; keyUp?: string } = {},
): DoctorStep {
    const expected = concrete(spec, env);
    return {
        id,
        prompt: options.prompt ?? formatForHuman(expected, env),
        expected,
        expectsBinding: options.expectsBinding ?? true,
        keyUp: options.keyUp,
        catches,
    };
}

/** Dangerous combinations (Cmd+Q/W/H, Ctrl+C/D/Z outside the editor, the tmux prefix) are not pressed — we ask in words. */
export function doctorSteps(env: KeyboardDoctorEnv): DoctorStep[] {
    const mac = isMac(env);
    const tmux = inTmux(env);
    const steps: DoctorStep[] = [];
    // Under tmux Ctrl+S can be the prefix — it goes to the multiplexer.
    if (!tmux) steps.push(step(env, "base.save", "mod+s", "whether the basic set works"));
    steps.push(
        step(env, "base.palette", "mod+shift+p", "whether the basic set works"),
        step(env, "base.quickOpen", "mod+p", "whether the basic set works"),
        step(env, "base.find", "mod+f", "whether the basic set works"),
    );
    if (mac) {
        steps.push(
            step(
                env,
                "option.word",
                "alt+left",
                "a character is inserted instead of moving — Option is not set up as Alt",
            ),
            step(env, "option.compose", "alt+a", "å arrives instead of Alt+A — same diagnosis", {
                expectsBinding: false,
            }),
            {
                id: "option.intl",
                prompt: "Option+letter that types @ [ ] { } on your layout (if none — Escape)",
                expected: undefined,
                expectsBinding: false,
                catches: "whether we swallow character input on an international layout",
            },
        );
    }
    steps.push(step(env, "home", "home", "whether the cursor moves or the terminal buffer scrolls"));
    if (mac) steps.push(step(env, "missionControl", "ctrl+left", "macOS switches Space instead of moving by word"));
    steps.push(
        step(env, "ctrlShift.e", "ctrl+shift+e", "whether Ctrl+Shift arrives; whether a caron (ˇ) pops up"),
        step(env, "ctrlShift.m", "ctrl+shift+m", "whether Ctrl+Shift arrives; whether a caron (ˇ) pops up"),
        step(
            env,
            "hold",
            "ctrl+tab",
            "whether keyup arrives (kitty event types) — it closes the tab switcher overlay",
            {
                prompt: `${formatForHuman(parseKeybinding("ctrl+tab"), env)} — hold Ctrl, then release`,
                keyUp: "Control",
                expectsBinding: false,
            },
        ),
    );
    if (env.macKeysRung === "cmd") {
        steps.push(
            step(env, "cmd.save", "meta+s", "whether super arrives and what the bytes show"),
            step(env, "cmd.quickOpen", "meta+p", "whether super arrives and what the bytes show"),
            step(env, "cmd.top", "meta+up", "whether super arrives and what the bytes show"),
            step(env, "cmd.deleteAllLeft", "meta+backspace", "whether super arrives and what the bytes show"),
        );
    }
    if (mac && tmux) {
        steps.push(
            step(env, "cmd.tmux", "alt+s", "under tmux Cmd arrives as Alt — Cmd keybindings must be off", {
                prompt: "Cmd+S (inside tmux)",
                expectsBinding: false,
            }),
        );
    }
    return steps;
}

const MODIFIERS = ["ctrlKey", "shiftKey", "altKey", "metaKey"] as const;

const PRINTABLE_CHAR = /^\P{C}$/u;

function keysMatch(expected: Keybinding, received: ObservedKey): boolean {
    if (received.key.toLowerCase() === expected.key.toLowerCase()) return true;
    // Layout-independent, by physical key: only letters have `KeyS`.
    return received.code === `Key${expected.key.toUpperCase()}`;
}

function modifierName(modifier: (typeof MODIFIERS)[number], mac: boolean): string {
    if (modifier === "ctrlKey") return "Ctrl";
    if (modifier === "shiftKey") return "Shift";
    if (modifier === "altKey") return mac ? "Option" : "Alt";
    return mac ? "Cmd" : "Meta";
}

export function judge(result: StepResult, env: KeyboardDoctorEnv): Verdict {
    const { step: s, received } = result;
    if (received === null) return { kind: "lost" };
    const expected = s.expected;
    if (expected === undefined) {
        // A single printable code point (not a key name like "Enter"), without chord modifiers.
        const printable =
            PRINTABLE_CHAR.test(received.key) && !received.ctrlKey && !received.altKey && !received.metaKey;
        return printable ? { kind: "ok" } : { kind: "different" };
    }
    if (!keysMatch(expected, received)) return { kind: "different" };
    const missing = MODIFIERS.filter((m) => expected[m] && !received[m]);
    const extra = MODIFIERS.filter((m) => !expected[m] && received[m]);
    if (missing.length > 0 && extra.length === 0) {
        return { kind: "missing-modifier", missing: missing.map((m) => modifierName(m, isMac(env))) };
    }
    // We get here with a non-empty `missing` only together with a non-empty `extra`.
    if (extra.length > 0) return { kind: "different" };
    if (s.expectsBinding && !result.bindings.some((b) => b.active)) return { kind: "not-matched" };
    if (s.keyUp !== undefined && !result.keyUpSeen) return { kind: "no-keyup" };
    return { kind: "ok" };
}

export function describeVerdict(verdict: Verdict): string {
    switch (verdict.kind) {
        case "ok":
            return "OK";
        case "lost":
            return "did not arrive at all";
        case "missing-modifier":
            return `arrived without modifier: ${verdict.missing.join("+")}`;
        case "different":
            return "something else arrived";
        case "not-matched":
            return "arrived, but did not match";
        case "no-keyup":
            return "arrived, but the modifier keyup never came";
    }
}

export function formatForHuman(part: Keybinding, env: KeyboardDoctorEnv): string {
    const mac = isMac(env);
    const segments = MODIFIERS.filter((m) => part[m]).map((m) => modifierName(m, mac));
    const key = part.key.startsWith("Arrow") ? part.key.slice("Arrow".length) : part.key;
    segments.push(key.length === 1 ? key.toUpperCase() : key);
    return segments.join("+");
}

export function hexBytes(raw: string): string {
    return [...new TextEncoder().encode(raw)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function tokenFlags(token: RawTerminalToken): string[] {
    const flags: string[] = [];
    for (const field of ["key", "codepoint", "finalByte", "number", "char", "letter", "eventType"] as const) {
        if (field in token) flags.push(`${field}=${String((token as unknown as Record<string, unknown>)[field])}`);
    }
    const mods = MODIFIERS.filter((m) => m in token && (token as unknown as Record<string, boolean>)[m]);
    if (mods.length > 0) flags.push(`mods=${mods.map((m) => modifierName(m, false)).join("+")}`);
    return flags;
}

export function describeTokens(raw: string): string[] {
    return tokenize(raw).map((token) => [token.kind, ...tokenFlags(token)].join(" "));
}

export function describeEvent(received: ObservedKey): string {
    const mods = MODIFIERS.filter((m) => received[m]).map((m) => modifierName(m, false));
    return `key=${JSON.stringify(received.key)} code=${received.code === "" ? "—" : received.code} mods=${mods.length > 0 ? mods.join("+") : "—"}`;
}

export function describeBindings(bindings: readonly MatchedBinding[]): string {
    if (bindings.length === 0) return "none";
    return bindings
        .map(
            (b) =>
                `${b.commandId}${b.active ? "" : " (inactive here)"}${b.when === undefined ? "" : ` [when: ${b.when}]`}`,
        )
        .join("; ");
}

export function describeEnv(env: KeyboardDoctorEnv): string[] {
    const rung = env.macKeysRung === undefined ? "—" : `mac-${env.macKeysRung}`;
    const caps = env.capabilities.length > 0 ? env.capabilities.join(", ") : "—";
    return [
        `os: ${env.os} (source: ${env.osSource}) · tier: ${env.tier} · rung: ${rung}`,
        `caps: ${caps} · modes: ${env.modes.join(", ")}`,
        `terminal: ${env.terminalName ?? "unknown"} · TERM=${env.term ?? "—"}`,
    ];
}

// Emulator recipes are not verified on a real Mac.

type TerminalFamily = "iterm2" | "apple_terminal" | "kitty" | "ghostty" | "wezterm";

const FAMILY_PREFIXES: readonly [string, TerminalFamily][] = [
    ["iterm", "iterm2"],
    ["apple_terminal", "apple_terminal"],
    ["kitty", "kitty"],
    ["ghostty", "ghostty"],
    ["wezterm", "wezterm"],
];

export function terminalFamily(name: string | undefined): TerminalFamily | undefined {
    // Stryker disable next-line StringLiteral: any non-empty replacement also matches no prefix — equivalent mutant.
    const normalized = name?.trim().toLowerCase() ?? "";
    return FAMILY_PREFIXES.find(([prefix]) => normalized.startsWith(prefix))?.[1];
}

const RECIPES: Record<TerminalFamily, readonly string[]> = {
    iterm2: [
        "iTerm2: Settings → Profiles → Keys → Left/Right Command = Super (otherwise Cmd goes to the menu).",
        "iTerm2: enable «Apps can change how keys are reported» (Kitty keyboard protocol).",
        "iTerm2: Left Option key = Esc+ (Option as Alt; keep the right one for symbols).",
    ],
    apple_terminal: [
        "Terminal.app: Cmd never reaches applications (no Kitty protocol) — rung is at most mac-legacy.",
        "Terminal.app: Settings → Profiles → Keyboard → «Use Option as Meta key».",
    ],
    kitty: [
        "kitty.conf: macos_option_as_alt left (left only — keep the right one for @ [ ] { }).",
        "kitty.conf: remove your Cmd shortcuts that the editor needs: map cmd+t/cmd+n/cmd+p … no_op (keep Cmd+C/V).",
    ],
    ghostty: [
        "ghostty: macos-option-as-alt = left.",
        "ghostty: keybind = alt+arrow_left=unbind and alt+arrow_right=unbind — otherwise it sends legacy ESC b/f.",
        "ghostty: remove super+… shortcuts that the editor needs (keybind = super+p=unbind …).",
    ],
    wezterm: [
        "wezterm.lua: config.enable_kitty_keyboard = true.",
        "wezterm.lua: config.send_composed_key_when_left_alt_is_pressed = false (left Option as Alt).",
    ],
};

const TMUX_RECIPE: readonly string[] = [
    "tmux (≥ 3.5): set -s extended-keys always; set -s extended-keys-format csi-u; set -as terminal-features ',*:extkeys'.",
    "tmux: Cmd never arrives under tmux — tmux has three modifiers, so Cmd merges with Option.",
    "tmux: for Diode to see LC_DIODE_PLATFORM after reattaching — set -ag update-environment LC_DIODE_PLATFORM.",
];

const SSH_RECIPE =
    "ssh: to enable the Mac keymap on the host, set LC_DIODE_PLATFORM=mac in the emulator (ssh forwards LC_* by default) or keyboard.platform = mac in settings.";

export function emulatorRecipes(env: KeyboardDoctorEnv): string[] {
    const family = terminalFamily(env.terminalName);
    const recipes = family === undefined ? [] : [...RECIPES[family]];
    if (inTmux(env)) recipes.push(...TMUX_RECIPE);
    if (env.modes.includes("ssh") && !isMac(env)) recipes.push(SSH_RECIPE);
    return recipes;
}

export function formatReport(env: KeyboardDoctorEnv, results: readonly StepResult[]): string {
    const lines = ["Diode Keyboard Doctor", ...describeEnv(env), ""];
    results.forEach((result, index) => {
        const { step: s, received } = result;
        const expected = s.expected === undefined ? "printable character" : formatForHuman(s.expected, env);
        lines.push(`[${String(index + 1)}] ${s.prompt} — checks: ${s.catches}`);
        lines.push(`    expected: ${expected}`);
        if (received === null) {
            lines.push("    received: nothing");
        } else {
            lines.push(`    bytes: ${hexBytes(received.raw)}`);
            lines.push(`    tokens: ${describeTokens(received.raw).join(" | ")}`);
            lines.push(`    event: ${describeEvent(received)}`);
            lines.push(`    keybinding: ${describeBindings(result.bindings)}`);
            if (s.keyUp !== undefined) lines.push(`    keyup ${s.keyUp}: ${result.keyUpSeen ? "yes" : "no"}`);
        }
        lines.push(`    verdict: ${describeVerdict(judge(result, env))}`);
    });
    const recipes = emulatorRecipes(env);
    if (recipes.length > 0) {
        lines.push("", "Recipes (not verified on a real Mac — correct them if yours differs):");
        for (const recipe of recipes) lines.push(`- ${recipe}`);
    }
    lines.push(
        "",
        "Cmd+Q / Cmd+W / Cmd+H and Ctrl+C / Ctrl+D / Ctrl+Z outside the editor — describe in words whether they work.",
    );
    return `${lines.join("\n")}\n`;
}
