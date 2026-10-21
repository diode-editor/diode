import { describe, expect, it } from "vitest";

import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import {
    describeBindings,
    describeEnv,
    describeEvent,
    describeTokens,
    describeVerdict,
    doctorSteps,
    emulatorRecipes,
    formatForHuman,
    formatReport,
    hexBytes,
    judge,
    type KeyboardDoctorEnv,
    type ObservedKey,
    type StepResult,
    terminalFamily,
    type Verdict,
} from "./keyboardDoctorModel.ts";

const PC: KeyboardDoctorEnv = {
    os: "linux",
    osSource: "default",
    tier: "kitty",
    macKeysRung: undefined,
    capabilities: ["extended-keys"],
    modes: ["local"],
    terminalName: undefined,
    term: "xterm-kitty",
};
const MAC_CMD: KeyboardDoctorEnv = {
    ...PC,
    os: "mac",
    osSource: "env",
    macKeysRung: "cmd",
    capabilities: ["extended-keys", "super"],
    modes: ["ssh"],
    terminalName: "kitty(0.45.0)",
};
const MAC_TMUX: KeyboardDoctorEnv = { ...MAC_CMD, macKeysRung: "extended", modes: ["local", "tmux"] };

function key(spec: string, raw = ""): ObservedKey {
    const part = parseKeybinding(spec);
    return { raw, code: "", ...part };
}

function stepOf(env: KeyboardDoctorEnv, id: string) {
    const found = doctorSteps(env).find((s) => s.id === id);
    if (found === undefined) throw new Error(`no step ${id}`);
    return found;
}

function result(env: KeyboardDoctorEnv, id: string, received: ObservedKey | null, extra: Partial<StepResult> = {}) {
    return { step: stepOf(env, id), received, bindings: [], keyUpSeen: false, ...extra };
}

describe("doctorSteps — checks for the environment", () => {
    it("step wording follows the feedback protocol (what to press and what it checks)", () => {
        const describe = (env: KeyboardDoctorEnv) =>
            doctorSteps(env).map(
                (s) => `${s.id}: ${s.prompt} — ${s.catches}${s.expectsBinding ? "" : " [no keybinding]"}`,
            );
        expect([...describe(MAC_CMD), ...describe(MAC_TMUX).filter((line) => line.startsWith("cmd.tmux"))]).toEqual([
            "base.save: Cmd+S — whether the basic set works",
            "base.palette: Shift+Cmd+P — whether the basic set works",
            "base.quickOpen: Cmd+P — whether the basic set works",
            "base.find: Cmd+F — whether the basic set works",
            "option.word: Option+Left — a character is inserted instead of moving — Option is not set up as Alt",
            "option.compose: Option+A — å arrives instead of Alt+A — same diagnosis [no keybinding]",
            "option.intl: Option+letter that types @ [ ] { } on your layout (if none — Escape) — whether we swallow character input on an international layout [no keybinding]",
            "home: Home — whether the cursor moves or the terminal buffer scrolls",
            "missionControl: Ctrl+Left — macOS switches Space instead of moving by word",
            "ctrlShift.e: Ctrl+Shift+E — whether Ctrl+Shift arrives; whether a caron (ˇ) pops up",
            "ctrlShift.m: Ctrl+Shift+M — whether Ctrl+Shift arrives; whether a caron (ˇ) pops up",
            "hold: Ctrl+Tab — hold Ctrl, then release — whether keyup arrives (kitty event types) — it closes the tab switcher overlay [no keybinding]",
            "cmd.save: Cmd+S — whether super arrives and what the bytes show",
            "cmd.quickOpen: Cmd+P — whether super arrives and what the bytes show",
            "cmd.top: Cmd+Up — whether super arrives and what the bytes show",
            "cmd.deleteAllLeft: Cmd+Backspace — whether super arrives and what the bytes show",
            "cmd.tmux: Cmd+S (inside tmux) — under tmux Cmd arrives as Alt — Cmd keybindings must be off [no keybinding]",
        ]);
        expect(stepOf(MAC_CMD, "hold").keyUp).toBe("Control");
    });

    it("pc: basic set, Home, Ctrl+Shift, hold — no Mac checks", () => {
        expect(doctorSteps(PC).map((s) => s.id)).toEqual([
            "base.save",
            "base.palette",
            "base.quickOpen",
            "base.find",
            "home",
            "ctrlShift.e",
            "ctrlShift.m",
            "hold",
        ]);
    });

    it("Mac with Cmd: mod is Cmd, plus Option, Mission Control and Cmd checks", () => {
        const steps = doctorSteps(MAC_CMD);
        expect(steps.map((s) => s.id)).toEqual([
            "base.save",
            "base.palette",
            "base.quickOpen",
            "base.find",
            "option.word",
            "option.compose",
            "option.intl",
            "home",
            "missionControl",
            "ctrlShift.e",
            "ctrlShift.m",
            "hold",
            "cmd.save",
            "cmd.quickOpen",
            "cmd.top",
            "cmd.deleteAllLeft",
        ]);
        expect(stepOf(MAC_CMD, "base.save").prompt).toBe("Cmd+S");
        expect(stepOf(MAC_CMD, "option.word").prompt).toBe("Option+Left");
        expect(stepOf(MAC_CMD, "hold").prompt).toBe("Ctrl+Tab — hold Ctrl, then release");
    });

    it("Mac under tmux: no Ctrl+S (may be the prefix) and no Cmd steps, but with the «Cmd ≡ Alt» check", () => {
        const ids = doctorSteps(MAC_TMUX).map((s) => s.id);
        expect(ids).not.toContain("base.save");
        expect(ids.filter((id) => id.startsWith("cmd."))).toEqual(["cmd.tmux"]);
        expect(stepOf(MAC_TMUX, "base.palette").prompt).toBe("Ctrl+Shift+P");
    });
});

describe("judge — where the key got lost", () => {
    const saveBound = [{ commandId: "workbench.action.files.save", when: undefined, active: true }];

    it.each<[string, StepResult, Verdict]>([
        ["nothing arrived", result(MAC_CMD, "cmd.save", null), { kind: "lost" }],
        ["arrived and matched", result(MAC_CMD, "cmd.save", key("meta+s"), { bindings: saveBound }), { kind: "ok" }],
        ["arrived, but did not match", result(MAC_CMD, "cmd.save", key("meta+s")), { kind: "not-matched" }],
        [
            "keybinding exists, but is inactive here",
            result(MAC_CMD, "cmd.save", key("meta+s"), { bindings: [{ ...saveBound[0], active: false }] }),
            { kind: "not-matched" },
        ],
        [
            "arrived without a modifier",
            result(MAC_CMD, "ctrlShift.e", key("ctrl+e")),
            { kind: "missing-modifier", missing: ["Shift"] },
        ],
        [
            "Cmd swallowed entirely",
            result(MAC_CMD, "cmd.save", key("s")),
            { kind: "missing-modifier", missing: ["Cmd"] },
        ],
        ["å arrived instead of Option+A", result(MAC_CMD, "option.compose", key("å")), { kind: "different" }],
        ["modifier substituted (Cmd arrived as Alt)", result(MAC_CMD, "cmd.save", key("alt+s")), { kind: "different" }],
        ["extra modifier", result(MAC_CMD, "missionControl", key("ctrl+shift+left")), { kind: "different" }],
        [
            "Option+A without a keybinding — OK, no keybinding expected",
            result(MAC_CMD, "option.compose", key("alt+a")),
            { kind: "ok" },
        ],
        ["layout character arrived", result(MAC_CMD, "option.intl", key("@")), { kind: "ok" }],
        ["a chord instead of a character", result(MAC_CMD, "option.intl", key("alt+l")), { kind: "different" }],
        ["a key name instead of a character", result(MAC_CMD, "option.intl", key("enter")), { kind: "different" }],
        ["hold without keyup", result(MAC_CMD, "hold", key("ctrl+tab")), { kind: "no-keyup" }],
        ["hold with keyup", result(MAC_CMD, "hold", key("ctrl+tab"), { keyUpSeen: true }), { kind: "ok" }],
        ["Cmd under tmux arrived as Alt — expected", result(MAC_TMUX, "cmd.tmux", key("alt+s")), { kind: "ok" }],
    ])("%s", (_name, stepResult, expected) => {
        expect(judge(stepResult, MAC_CMD)).toEqual(expected);
    });

    it("letter case and the Russian layout do not matter: matching goes by key code", () => {
        const received = { ...key("meta+\u044b"), code: "KeyS" }; // "meta+y"
        expect(judge(result(MAC_CMD, "cmd.save", received, { bindings: saveBound }), MAC_CMD)).toEqual({ kind: "ok" });
        expect(judge(result(MAC_CMD, "cmd.save", key("meta+S"), { bindings: saveBound }), MAC_CMD)).toEqual({
            kind: "ok",
        });
    });

    it("on pc modifiers use pc names", () => {
        expect(judge(result(PC, "base.save", key("s")), PC)).toEqual({ kind: "missing-modifier", missing: ["Ctrl"] });
        expect(formatForHuman(parseKeybinding("alt+meta+x"), PC)).toBe("Alt+Meta+X");
    });

    it("describeVerdict: human-readable wording", () => {
        expect(
            (
                [
                    { kind: "ok" },
                    { kind: "lost" },
                    { kind: "missing-modifier", missing: ["Cmd", "Shift"] },
                    { kind: "different" },
                    { kind: "not-matched" },
                    { kind: "no-keyup" },
                ] as const
            ).map(describeVerdict),
        ).toEqual([
            "OK",
            "did not arrive at all",
            "arrived without modifier: Cmd+Shift",
            "something else arrived",
            "arrived, but did not match",
            "arrived, but the modifier keyup never came",
        ]);
    });
});

describe("descriptions of the bytes → tokens → event → keybinding chain", () => {
    it("hexBytes — utf-8 bytes", () => {
        expect(hexBytes("\x1b[115;9u")).toBe("1b 5b 31 31 35 3b 39 75");
        expect(hexBytes("å")).toBe("c3 a5");
        expect(hexBytes("\t")).toBe("09");
    });

    it("describeTokens: csi-u with super, legacy ESC prefix, printable character", () => {
        expect(describeTokens("\x1b[115;9u")).toEqual(["csi-u key=s codepoint=115 eventType=0 mods=Meta"]);
        expect(describeTokens("\x1bs")).toEqual(["esc-char char=s"]);
        expect(describeTokens("a")).toEqual(["char codepoint=97 char=a"]);
        expect(describeTokens("\x1b[97;6u")).toEqual(["csi-u key=a codepoint=97 eventType=0 mods=Ctrl+Shift"]);
    });

    it("describeEvent / describeBindings", () => {
        expect(describeEvent({ ...key("ctrl+shift+e"), code: "KeyE" })).toBe('key="e" code=KeyE mods=Ctrl+Shift');
        expect(describeEvent(key("x"))).toBe('key="x" code=— mods=—');
        expect(describeBindings([])).toBe("none");
        expect(
            describeBindings([
                { commandId: "a", when: undefined, active: true },
                { commandId: "b", when: "macKeys >= 3", active: false },
            ]),
        ).toBe("a; b (inactive here) [when: macKeys >= 3]");
    });

    it("describeEnv: OS source, rung, capabilities and terminal", () => {
        expect(describeEnv(MAC_CMD)).toEqual([
            "os: mac (source: env) · tier: kitty · rung: mac-cmd",
            "caps: extended-keys, super · modes: ssh",
            "terminal: kitty(0.45.0) · TERM=xterm-kitty",
        ]);
        expect(describeEnv(MAC_TMUX)[1]).toBe("caps: extended-keys, super · modes: local, tmux");
        expect(describeEnv({ ...PC, capabilities: [], term: undefined })).toEqual([
            "os: linux (source: default) · tier: kitty · rung: —",
            "caps: — · modes: local",
            "terminal: unknown · TERM=—",
        ]);
    });
});

describe("emulator recipes", () => {
    it.each<[string | undefined, string | undefined]>([
        ["iTerm2 3.5.0", "iterm2"],
        ["Apple_Terminal", "apple_terminal"],
        ["kitty(0.45.0)", "kitty"],
        ["ghostty 1.1.0", "ghostty"],
        ["WezTerm 20240203", "wezterm"],
        ["foot", undefined],
        [undefined, undefined],
    ])("%s → %s", (name, family) => {
        expect(terminalFamily(name)).toBe(family);
    });

    it("recipes verbatim (updated from real-Mac feedback)", () => {
        const recipes = (terminalName: string) => emulatorRecipes({ ...MAC_TMUX, terminalName });
        expect(recipes("Apple_Terminal")).toEqual([
            "Terminal.app: Cmd never reaches applications (no Kitty protocol) — rung is at most mac-legacy.",
            "Terminal.app: Settings → Profiles → Keyboard → «Use Option as Meta key».",
            "tmux (≥ 3.5): set -s extended-keys always; set -s extended-keys-format csi-u; set -as terminal-features ',*:extkeys'.",
            "tmux: Cmd never arrives under tmux — tmux has three modifiers, so Cmd merges with Option.",
            "tmux: for Diode to see LC_DIODE_PLATFORM after reattaching — set -ag update-environment LC_DIODE_PLATFORM.",
        ]);
        expect(emulatorRecipes({ ...MAC_CMD, terminalName: "iTerm2" })).toEqual([
            "iTerm2: Settings → Profiles → Keys → Left/Right Command = Super (otherwise Cmd goes to the menu).",
            "iTerm2: enable «Apps can change how keys are reported» (Kitty keyboard protocol).",
            "iTerm2: Left Option key = Esc+ (Option as Alt; keep the right one for symbols).",
        ]);
        expect(emulatorRecipes({ ...MAC_CMD, terminalName: "ghostty" })).toEqual([
            "ghostty: macos-option-as-alt = left.",
            "ghostty: keybind = alt+arrow_left=unbind and alt+arrow_right=unbind — otherwise it sends legacy ESC b/f.",
            "ghostty: remove super+… shortcuts that the editor needs (keybind = super+p=unbind …).",
        ]);
        expect(emulatorRecipes({ ...MAC_CMD, terminalName: "WezTerm" })).toEqual([
            "wezterm.lua: config.enable_kitty_keyboard = true.",
            "wezterm.lua: config.send_composed_key_when_left_alt_is_pressed = false (left Option as Alt).",
        ]);
    });

    it("emulator recipe + tmux + ssh hint when the Mac is not detected", () => {
        expect(emulatorRecipes({ ...MAC_TMUX, terminalName: "iTerm2" }).join("\n")).toMatch(
            /Command = Super[\s\S]*tmux/,
        );
        expect(emulatorRecipes({ ...PC, modes: ["ssh"] })).toEqual([expect.stringContaining("LC_DIODE_PLATFORM=mac")]);
        expect(emulatorRecipes(PC)).toEqual([]);
    });
});

describe("formatReport — the report in one piece", () => {
    it("environment, each check with its chain and verdict, recipes and questions in words", () => {
        const report = formatReport(MAC_CMD, [
            result(
                MAC_CMD,
                "cmd.save",
                { ...key("meta+s", "\x1b[115;9u"), code: "KeyS" },
                {
                    bindings: [{ commandId: "workbench.action.files.save", when: "macKeys >= 3", active: true }],
                },
            ),
            result(MAC_CMD, "home", null),
            result(MAC_CMD, "option.intl", key("@", "@")),
            result(MAC_CMD, "hold", key("ctrl+tab", "\x1b[9;5u")),
        ]);
        expect(report).toBe(
            [
                "Diode Keyboard Doctor",
                "os: mac (source: env) · tier: kitty · rung: mac-cmd",
                "caps: extended-keys, super · modes: ssh",
                "terminal: kitty(0.45.0) · TERM=xterm-kitty",
                "",
                "[1] Cmd+S — checks: whether super arrives and what the bytes show",
                "    expected: Cmd+S",
                "    bytes: 1b 5b 31 31 35 3b 39 75",
                "    tokens: csi-u key=s codepoint=115 eventType=0 mods=Meta",
                '    event: key="s" code=KeyS mods=Meta',
                "    keybinding: workbench.action.files.save [when: macKeys >= 3]",
                "    verdict: OK",
                "[2] Home — checks: whether the cursor moves or the terminal buffer scrolls",
                "    expected: Home",
                "    received: nothing",
                "    verdict: did not arrive at all",
                "[3] Option+letter that types @ [ ] { } on your layout (if none — Escape) — checks: whether we swallow character input on an international layout",
                "    expected: printable character",
                "    bytes: 40",
                "    tokens: char codepoint=64 char=@",
                '    event: key="@" code=— mods=—',
                "    keybinding: none",
                "    verdict: OK",
                "[4] Ctrl+Tab — hold Ctrl, then release — checks: whether keyup arrives (kitty event types) — it closes the tab switcher overlay",
                "    expected: Ctrl+Tab",
                "    bytes: 1b 5b 39 3b 35 75",
                "    tokens: csi-u key=Tab codepoint=9 eventType=0 mods=Ctrl",
                '    event: key="Tab" code=— mods=Ctrl',
                "    keybinding: none",
                "    keyup Control: no",
                "    verdict: arrived, but the modifier keyup never came",
                "",
                "Recipes (not verified on a real Mac — correct them if yours differs):",
                "- kitty.conf: macos_option_as_alt left (left only — keep the right one for @ [ ] { }).",
                "- kitty.conf: remove your Cmd shortcuts that the editor needs: map cmd+t/cmd+n/cmd+p … no_op (keep Cmd+C/V).",
                "",
                "Cmd+Q / Cmd+W / Cmd+H and Ctrl+C / Ctrl+D / Ctrl+Z outside the editor — describe in words whether they work.",
                "",
            ].join("\n"),
        );
    });

    it("several tokens in one press are joined with « | »", () => {
        const report = formatReport(PC, [result(PC, "home", key("home", "\x1bOH\x1bOH"))]);
        expect(report).toContain("    tokens: ss3 key=Home finalByte=H | ss3 key=Home finalByte=H");
    });

    it("no recipes, no recipes section", () => {
        expect(formatReport(PC, [])).not.toContain("Recipes");
    });
});
