import type { RawTerminalToken } from "@tuidom/core/input/rawTerminalToken";
import { tokenize } from "@tuidom/core/input/tokenize";

import type { Keybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

/**
 * Keyboard Doctor — модель без UI и DI: шаги проверки, вердикт по нажатию,
 * рецепты эмуляторов и текст отчёта. Отчёт — тело фидбека маковода: по нему
 * должно быть видно, ГДЕ потерялась клавиша — не дошла вовсе, дошла без
 * модификатора или дошла, но не сматчилась.
 *
 * Протокол проверок — docs/TODO/MacKeybindings.md («Протокол фидбека»).
 */

/** Снимок окружения, который доктор показывает и кладёт в отчёт. */
export interface KeyboardDoctorEnv {
    readonly os: string;
    readonly osSource: string;
    readonly tier: string;
    /** Рунг мак-лестницы; `undefined` — клавиатура не маковская. */
    readonly macKeysRung: string | undefined;
    readonly capabilities: readonly string[];
    readonly modes: readonly string[];
    /** Как назвался внешний терминал (tmux client_termtype / XTVERSION / LC_TERMINAL / TERM_PROGRAM). */
    readonly terminalName: string | undefined;
    readonly term: string | undefined;
}

/** Одно нажатие, как его увидел редактор: байты → токены → событие. */
export interface ObservedKey {
    readonly raw: string;
    readonly key: string;
    readonly code: string;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
}

/** Бинд, найденный для пришедшей комбинации: команда и действует ли он в этом окружении. */
export interface MatchedBinding {
    readonly commandId: string;
    readonly when: string | undefined;
    readonly active: boolean;
}

export interface DoctorStep {
    readonly id: string;
    /** Что нажать — словами человека. */
    readonly prompt: string;
    /** Что должно приехать; `undefined` — ждём печатный символ без модификаторов. */
    readonly expected: Keybinding | undefined;
    /** Должна ли пришедшая комбинация исполнять команду. */
    readonly expectsBinding: boolean;
    /** Ждём keyup этой клавиши-модификатора (hold-сессии: Ctrl+Tab). */
    readonly keyUp?: string;
    /** Пояснение в отчёт: что именно ловим. */
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
    /** `null` — человек отметил «ничего не произошло». */
    readonly received: ObservedKey | null;
    readonly bindings: readonly MatchedBinding[];
    readonly keyUpSeen: boolean;
}

// ─── Шаги ───

function isMac(env: KeyboardDoctorEnv): boolean {
    return env.os === "mac";
}

function inTmux(env: KeyboardDoctorEnv): boolean {
    return env.modes.includes("tmux");
}

/** `mod` в конкретный модификатор — как его развернёт реестр на этом рунге. */
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

/**
 * Проверки по порядку, отфильтрованные под окружение. Опасные комбинации
 * (Cmd+Q/W/H, Ctrl+C/D/Z вне редактора, префикс tmux) не просим нажимать —
 * о них спрашивают словами.
 */
export function doctorSteps(env: KeyboardDoctorEnv): DoctorStep[] {
    const mac = isMac(env);
    const tmux = inTmux(env);
    const steps: DoctorStep[] = [];
    // Ctrl+S под tmux бывает префиксом — уйдёт мультиплексору.
    if (!tmux) steps.push(step(env, "base.save", "mod+s", "работает ли базовый набор"));
    steps.push(
        step(env, "base.palette", "mod+shift+p", "работает ли базовый набор"),
        step(env, "base.quickOpen", "mod+p", "работает ли базовый набор"),
        step(env, "base.find", "mod+f", "работает ли базовый набор"),
    );
    if (mac) {
        steps.push(
            step(env, "option.word", "alt+left", "вставился символ вместо перехода — Option не настроен как Alt"),
            step(env, "option.compose", "alt+a", "пришло å вместо Alt+A — тот же диагноз", { expectsBinding: false }),
            {
                id: "option.intl",
                prompt: "Option+буква, которая на твоей раскладке даёт @ [ ] { } (нет такой — Escape)",
                expected: undefined,
                expectsBinding: false,
                catches: "не съели ли мы ввод символа на интернациональной раскладке",
            },
        );
    }
    steps.push(step(env, "home", "home", "уехал ли курсор или проскроллился буфер терминала"));
    if (mac) steps.push(step(env, "missionControl", "ctrl+left", "переключился Space вместо перехода по слову"));
    steps.push(
        step(env, "ctrlShift.e", "ctrl+shift+e", "доезжает ли Ctrl+Shift; не вылез ли caron (ˇ)"),
        step(env, "ctrlShift.m", "ctrl+shift+m", "доезжает ли Ctrl+Shift; не вылез ли caron (ˇ)"),
        step(env, "hold", "ctrl+tab", "есть ли keyup (kitty event types) — от него закрывается оверлей вкладок", {
            prompt: `${formatForHuman(parseKeybinding("ctrl+tab"), env)} — подержи Ctrl и отпусти`,
            keyUp: "Control",
            expectsBinding: false,
        }),
    );
    if (env.macKeysRung === "cmd") {
        steps.push(
            step(env, "cmd.save", "meta+s", "доезжает ли super и что показывают байты"),
            step(env, "cmd.quickOpen", "meta+p", "доезжает ли super и что показывают байты"),
            step(env, "cmd.top", "meta+up", "доезжает ли super и что показывают байты"),
            step(env, "cmd.deleteAllLeft", "meta+backspace", "доезжает ли super и что показывают байты"),
        );
    }
    if (mac && tmux) {
        steps.push(
            step(env, "cmd.tmux", "alt+s", "Cmd под tmux приезжает как Alt — Cmd-бинды должны быть выключены", {
                prompt: "Cmd+S (внутри tmux)",
                expectsBinding: false,
            }),
        );
    }
    return steps;
}

// ─── Вердикт ───

const MODIFIERS = ["ctrlKey", "shiftKey", "altKey", "metaKey"] as const;

const PRINTABLE_CHAR = /^\P{C}$/u;

function keysMatch(expected: Keybinding, received: ObservedKey): boolean {
    if (received.key.toLowerCase() === expected.key.toLowerCase()) return true;
    return expected.key.length === 1 && received.code === `Key${expected.key.toUpperCase()}`;
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
        // Один печатный кодпоинт (не имя клавиши вроде «Enter»), без модификаторов-аккордов.
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
    if (missing.length > 0 || extra.length > 0) return { kind: "different" };
    if (s.expectsBinding && !result.bindings.some((b) => b.active)) return { kind: "not-matched" };
    if (s.keyUp !== undefined && !result.keyUpSeen) return { kind: "no-keyup" };
    return { kind: "ok" };
}

export function describeVerdict(verdict: Verdict): string {
    switch (verdict.kind) {
        case "ok":
            return "OK";
        case "lost":
            return "не дошла вовсе";
        case "missing-modifier":
            return `дошла без модификатора: ${verdict.missing.join("+")}`;
        case "different":
            return "пришло другое";
        case "not-matched":
            return "дошла, но не сматчилась";
        case "no-keyup":
            return "дошла, но keyup модификатора не пришёл";
    }
}

// ─── Форматирование ───

/** Комбинация так, как её называет владелец клавиатуры: на маке Option/Cmd. */
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

/** Токены входного парсера для сырых байт — средняя ступень «байты → токены → событие». */
export function describeTokens(raw: string): string[] {
    return tokenize(raw).map((token) => [token.kind, ...tokenFlags(token)].join(" "));
}

export function describeEvent(received: ObservedKey): string {
    const mods = MODIFIERS.filter((m) => received[m]).map((m) => modifierName(m, false));
    return `key=${JSON.stringify(received.key)} code=${received.code === "" ? "—" : received.code} mods=${mods.length > 0 ? mods.join("+") : "—"}`;
}

export function describeBindings(bindings: readonly MatchedBinding[]): string {
    if (bindings.length === 0) return "нет";
    return bindings
        .map(
            (b) =>
                `${b.commandId}${b.active ? "" : " (не действует здесь)"}${b.when === undefined ? "" : ` [when: ${b.when}]`}`,
        )
        .join("; ");
}

export function describeEnv(env: KeyboardDoctorEnv): string[] {
    const rung = env.macKeysRung === undefined ? "—" : `mac-${env.macKeysRung}`;
    const caps = env.capabilities.length > 0 ? env.capabilities.join(", ") : "—";
    return [
        `os: ${env.os} (источник: ${env.osSource}) · tier: ${env.tier} · рунг: ${rung}`,
        `caps: ${caps} · modes: ${env.modes.join(", ")}`,
        `терминал: ${env.terminalName ?? "не опознан"} · TERM=${env.term ?? "—"}`,
    ];
}

// ─── Рецепты эмуляторов (не проверено на живом маке) ───

type TerminalFamily = "iterm2" | "apple_terminal" | "kitty" | "ghostty" | "wezterm";

const FAMILY_PREFIXES: readonly [string, TerminalFamily][] = [
    ["iterm", "iterm2"],
    ["apple_terminal", "apple_terminal"],
    ["kitty", "kitty"],
    ["ghostty", "ghostty"],
    ["wezterm", "wezterm"],
];

export function terminalFamily(name: string | undefined): TerminalFamily | undefined {
    const normalized = name?.trim().toLowerCase() ?? "";
    return FAMILY_PREFIXES.find(([prefix]) => normalized.startsWith(prefix))?.[1];
}

const RECIPES: Record<TerminalFamily, readonly string[]> = {
    iterm2: [
        "iTerm2: Settings → Profiles → Keys → Left/Right Command = Super (иначе Cmd уходит в меню).",
        "iTerm2: включи «Apps can change how keys are reported» (Kitty keyboard protocol).",
        "iTerm2: Left Option key = Esc+ (Option как Alt; правый оставь для символов).",
    ],
    apple_terminal: [
        "Terminal.app: Cmd до приложений не доходит никогда (нет Kitty-протокола) — рунг не выше mac-legacy.",
        "Terminal.app: Settings → Profiles → Keyboard → «Use Option as Meta key».",
    ],
    kitty: [
        "kitty.conf: macos_option_as_alt left (только левый — правый оставь для @ [ ] { }).",
        "kitty.conf: сними свои Cmd-шорткаты, которые нужны редактору: map cmd+t/cmd+n/cmd+p … no_op (Cmd+C/V оставь).",
    ],
    ghostty: [
        "ghostty: macos-option-as-alt = left.",
        "ghostty: keybind = alt+arrow_left=unbind и alt+arrow_right=unbind — иначе шлёт legacy ESC b/f.",
        "ghostty: сними super+… шорткаты, нужные редактору (keybind = super+p=unbind …).",
    ],
    wezterm: [
        "wezterm.lua: config.enable_kitty_keyboard = true.",
        "wezterm.lua: config.send_composed_key_when_left_alt_is_pressed = false (левый Option как Alt).",
    ],
};

const TMUX_RECIPE: readonly string[] = [
    "tmux (≥ 3.5): set -s extended-keys always; set -s extended-keys-format csi-u; set -as terminal-features ',*:extkeys'.",
    "tmux: Cmd под tmux не доезжает никогда — у tmux три модификатора, Cmd сливается с Option.",
    "tmux: чтобы Diode видел LC_DIODE_PLATFORM после переподключения — set -ag update-environment LC_DIODE_PLATFORM.",
];

const SSH_RECIPE =
    "ssh: чтобы мак-раскладка включилась на хосте, выставь в эмуляторе LC_DIODE_PLATFORM=mac (LC_* ssh пересылает по умолчанию) или keyboard.platform = mac в настройках.";

export function emulatorRecipes(env: KeyboardDoctorEnv): string[] {
    const family = terminalFamily(env.terminalName);
    const recipes = family === undefined ? [] : [...RECIPES[family]];
    if (inTmux(env)) recipes.push(...TMUX_RECIPE);
    if (env.modes.includes("ssh") && !isMac(env)) recipes.push(SSH_RECIPE);
    return recipes;
}

// ─── Отчёт ───

export function formatReport(env: KeyboardDoctorEnv, results: readonly StepResult[]): string {
    const lines = ["Diode Keyboard Doctor", ...describeEnv(env), ""];
    results.forEach((result, index) => {
        const { step: s, received } = result;
        const expected = s.expected === undefined ? "печатный символ" : formatForHuman(s.expected, env);
        lines.push(`[${String(index + 1)}] ${s.prompt} — ловим: ${s.catches}`);
        lines.push(`    ожидали: ${expected}`);
        if (received === null) {
            lines.push("    получили: ничего");
        } else {
            lines.push(`    байты: ${hexBytes(received.raw)}`);
            lines.push(`    токены: ${describeTokens(received.raw).join(" | ")}`);
            lines.push(`    событие: ${describeEvent(received)}`);
            lines.push(`    бинд: ${describeBindings(result.bindings)}`);
            if (s.keyUp !== undefined) lines.push(`    keyup ${s.keyUp}: ${result.keyUpSeen ? "да" : "нет"}`);
        }
        lines.push(`    вердикт: ${describeVerdict(judge(result, env))}`);
    });
    const recipes = emulatorRecipes(env);
    if (recipes.length > 0) {
        lines.push("", "Рецепты (не проверено на живом маке — поправь, если у тебя иначе):");
        for (const recipe of recipes) lines.push(`- ${recipe}`);
    }
    lines.push("", "Про Cmd+Q / Cmd+W / Cmd+H и Ctrl+C / Ctrl+D / Ctrl+Z вне редактора — напиши словами, работают ли.");
    return `${lines.join("\n")}\n`;
}
