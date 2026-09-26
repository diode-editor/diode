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
    if (found === undefined) throw new Error(`нет шага ${id}`);
    return found;
}

function result(env: KeyboardDoctorEnv, id: string, received: ObservedKey | null, extra: Partial<StepResult> = {}) {
    return { step: stepOf(env, id), received, bindings: [], keyUpSeen: false, ...extra };
}

describe("doctorSteps — проверки под окружение", () => {
    it("формулировки шагов — протокол фидбека (что нажать и что ловим)", () => {
        const describe = (env: KeyboardDoctorEnv) =>
            doctorSteps(env).map((s) => `${s.id}: ${s.prompt} — ${s.catches}${s.expectsBinding ? "" : " [без бинда]"}`);
        expect([...describe(MAC_CMD), ...describe(MAC_TMUX).filter((line) => line.startsWith("cmd.tmux"))]).toEqual([
            "base.save: Cmd+S — работает ли базовый набор",
            "base.palette: Shift+Cmd+P — работает ли базовый набор",
            "base.quickOpen: Cmd+P — работает ли базовый набор",
            "base.find: Cmd+F — работает ли базовый набор",
            "option.word: Option+Left — вставился символ вместо перехода — Option не настроен как Alt",
            "option.compose: Option+A — пришло å вместо Alt+A — тот же диагноз [без бинда]",
            "option.intl: Option+буква, которая на твоей раскладке даёт @ [ ] { } (нет такой — Escape) — не съели ли мы ввод символа на интернациональной раскладке [без бинда]",
            "home: Home — уехал ли курсор или проскроллился буфер терминала",
            "missionControl: Ctrl+Left — переключился Space вместо перехода по слову",
            "ctrlShift.e: Ctrl+Shift+E — доезжает ли Ctrl+Shift; не вылез ли caron (ˇ)",
            "ctrlShift.m: Ctrl+Shift+M — доезжает ли Ctrl+Shift; не вылез ли caron (ˇ)",
            "hold: Ctrl+Tab — подержи Ctrl и отпусти — есть ли keyup (kitty event types) — от него закрывается оверлей вкладок [без бинда]",
            "cmd.save: Cmd+S — доезжает ли super и что показывают байты",
            "cmd.quickOpen: Cmd+P — доезжает ли super и что показывают байты",
            "cmd.top: Cmd+Up — доезжает ли super и что показывают байты",
            "cmd.deleteAllLeft: Cmd+Backspace — доезжает ли super и что показывают байты",
            "cmd.tmux: Cmd+S (внутри tmux) — Cmd под tmux приезжает как Alt — Cmd-бинды должны быть выключены [без бинда]",
        ]);
        expect(stepOf(MAC_CMD, "hold").keyUp).toBe("Control");
    });

    it("pc: базовый набор, Home, Ctrl+Shift, hold — без мак-проверок", () => {
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

    it("мак с Cmd: mod — это Cmd, плюс Option-, Mission Control- и Cmd-проверки", () => {
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
        expect(stepOf(MAC_CMD, "hold").prompt).toBe("Ctrl+Tab — подержи Ctrl и отпусти");
    });

    it("мак под tmux: без Ctrl+S (бывает префиксом) и без Cmd-шагов, но с проверкой «Cmd ≡ Alt»", () => {
        const ids = doctorSteps(MAC_TMUX).map((s) => s.id);
        expect(ids).not.toContain("base.save");
        expect(ids.filter((id) => id.startsWith("cmd."))).toEqual(["cmd.tmux"]);
        expect(stepOf(MAC_TMUX, "base.palette").prompt).toBe("Ctrl+Shift+P");
    });
});

describe("judge — где потерялась клавиша", () => {
    const saveBound = [{ commandId: "workbench.action.files.save", when: undefined, active: true }];

    it.each<[string, StepResult, Verdict]>([
        ["ничего не пришло", result(MAC_CMD, "cmd.save", null), { kind: "lost" }],
        ["дошла и сматчилась", result(MAC_CMD, "cmd.save", key("meta+s"), { bindings: saveBound }), { kind: "ok" }],
        ["дошла, но не сматчилась", result(MAC_CMD, "cmd.save", key("meta+s")), { kind: "not-matched" }],
        [
            "бинд есть, но не действует здесь",
            result(MAC_CMD, "cmd.save", key("meta+s"), { bindings: [{ ...saveBound[0], active: false }] }),
            { kind: "not-matched" },
        ],
        [
            "дошла без модификатора",
            result(MAC_CMD, "ctrlShift.e", key("ctrl+e")),
            { kind: "missing-modifier", missing: ["Shift"] },
        ],
        ["Cmd съеден целиком", result(MAC_CMD, "cmd.save", key("s")), { kind: "missing-modifier", missing: ["Cmd"] }],
        ["пришло å вместо Option+A", result(MAC_CMD, "option.compose", key("å")), { kind: "different" }],
        ["модификатор подменён (Cmd пришёл как Alt)", result(MAC_CMD, "cmd.save", key("alt+s")), { kind: "different" }],
        ["лишний модификатор", result(MAC_CMD, "missionControl", key("ctrl+shift+left")), { kind: "different" }],
        ["Option+A без бинда — ОК, бинд не ждём", result(MAC_CMD, "option.compose", key("alt+a")), { kind: "ok" }],
        ["символ раскладки доехал", result(MAC_CMD, "option.intl", key("@")), { kind: "ok" }],
        ["вместо символа — аккорд", result(MAC_CMD, "option.intl", key("alt+l")), { kind: "different" }],
        ["вместо символа — имя клавиши", result(MAC_CMD, "option.intl", key("enter")), { kind: "different" }],
        ["hold без keyup", result(MAC_CMD, "hold", key("ctrl+tab")), { kind: "no-keyup" }],
        ["hold с keyup", result(MAC_CMD, "hold", key("ctrl+tab"), { keyUpSeen: true }), { kind: "ok" }],
        ["Cmd под tmux приехал как Alt — ожидаемо", result(MAC_TMUX, "cmd.tmux", key("alt+s")), { kind: "ok" }],
    ])("%s", (_name, stepResult, expected) => {
        expect(judge(stepResult, MAC_CMD)).toEqual(expected);
    });

    it("регистр буквы и русская раскладка не мешают: сверка по коду клавиши", () => {
        const received = { ...key("meta+ы"), code: "KeyS" };
        expect(judge(result(MAC_CMD, "cmd.save", received, { bindings: saveBound }), MAC_CMD)).toEqual({ kind: "ok" });
        expect(judge(result(MAC_CMD, "cmd.save", key("meta+S"), { bindings: saveBound }), MAC_CMD)).toEqual({
            kind: "ok",
        });
    });

    it("на pc модификаторы называются по-pc", () => {
        expect(judge(result(PC, "base.save", key("s")), PC)).toEqual({ kind: "missing-modifier", missing: ["Ctrl"] });
        expect(formatForHuman(parseKeybinding("alt+meta+x"), PC)).toBe("Alt+Meta+X");
    });

    it("describeVerdict: человеческие формулировки", () => {
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
            "не дошла вовсе",
            "дошла без модификатора: Cmd+Shift",
            "пришло другое",
            "дошла, но не сматчилась",
            "дошла, но keyup модификатора не пришёл",
        ]);
    });
});

describe("описания цепочки байты → токены → событие → бинд", () => {
    it("hexBytes — utf-8 байты", () => {
        expect(hexBytes("\x1b[115;9u")).toBe("1b 5b 31 31 35 3b 39 75");
        expect(hexBytes("å")).toBe("c3 a5");
        expect(hexBytes("\t")).toBe("09");
    });

    it("describeTokens: csi-u с super, legacy ESC-префикс, печатный символ", () => {
        expect(describeTokens("\x1b[115;9u")).toEqual(["csi-u key=s codepoint=115 eventType=0 mods=Meta"]);
        expect(describeTokens("\x1bs")).toEqual(["esc-char char=s"]);
        expect(describeTokens("a")).toEqual(["char codepoint=97 char=a"]);
        expect(describeTokens("\x1b[97;6u")).toEqual(["csi-u key=a codepoint=97 eventType=0 mods=Ctrl+Shift"]);
    });

    it("describeEvent / describeBindings", () => {
        expect(describeEvent({ ...key("ctrl+shift+e"), code: "KeyE" })).toBe('key="e" code=KeyE mods=Ctrl+Shift');
        expect(describeEvent(key("x"))).toBe('key="x" code=— mods=—');
        expect(describeBindings([])).toBe("нет");
        expect(
            describeBindings([
                { commandId: "a", when: undefined, active: true },
                { commandId: "b", when: "macKeys >= 3", active: false },
            ]),
        ).toBe("a; b (не действует здесь) [when: macKeys >= 3]");
    });

    it("describeEnv: источник ОС, рунг, возможности и терминал", () => {
        expect(describeEnv(MAC_CMD)).toEqual([
            "os: mac (источник: env) · tier: kitty · рунг: mac-cmd",
            "caps: extended-keys, super · modes: ssh",
            "терминал: kitty(0.45.0) · TERM=xterm-kitty",
        ]);
        expect(describeEnv(MAC_TMUX)[1]).toBe("caps: extended-keys, super · modes: local, tmux");
        expect(describeEnv({ ...PC, capabilities: [], term: undefined })).toEqual([
            "os: linux (источник: default) · tier: kitty · рунг: —",
            "caps: — · modes: local",
            "терминал: не опознан · TERM=—",
        ]);
    });
});

describe("рецепты эмуляторов", () => {
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

    it("рецепты — дословно (правятся по фидбеку с живого мака)", () => {
        const recipes = (terminalName: string) => emulatorRecipes({ ...MAC_TMUX, terminalName });
        expect(recipes("Apple_Terminal")).toEqual([
            "Terminal.app: Cmd до приложений не доходит никогда (нет Kitty-протокола) — рунг не выше mac-legacy.",
            "Terminal.app: Settings → Profiles → Keyboard → «Use Option as Meta key».",
            "tmux (≥ 3.5): set -s extended-keys always; set -s extended-keys-format csi-u; set -as terminal-features ',*:extkeys'.",
            "tmux: Cmd под tmux не доезжает никогда — у tmux три модификатора, Cmd сливается с Option.",
            "tmux: чтобы Diode видел LC_DIODE_PLATFORM после переподключения — set -ag update-environment LC_DIODE_PLATFORM.",
        ]);
        expect(emulatorRecipes({ ...MAC_CMD, terminalName: "iTerm2" })).toEqual([
            "iTerm2: Settings → Profiles → Keys → Left/Right Command = Super (иначе Cmd уходит в меню).",
            "iTerm2: включи «Apps can change how keys are reported» (Kitty keyboard protocol).",
            "iTerm2: Left Option key = Esc+ (Option как Alt; правый оставь для символов).",
        ]);
        expect(emulatorRecipes({ ...MAC_CMD, terminalName: "ghostty" })).toEqual([
            "ghostty: macos-option-as-alt = left.",
            "ghostty: keybind = alt+arrow_left=unbind и alt+arrow_right=unbind — иначе шлёт legacy ESC b/f.",
            "ghostty: сними super+… шорткаты, нужные редактору (keybind = super+p=unbind …).",
        ]);
        expect(emulatorRecipes({ ...MAC_CMD, terminalName: "WezTerm" })).toEqual([
            "wezterm.lua: config.enable_kitty_keyboard = true.",
            "wezterm.lua: config.send_composed_key_when_left_alt_is_pressed = false (левый Option как Alt).",
        ]);
    });

    it("рецепт эмулятора + tmux + подсказка про ssh, когда мак не опознан", () => {
        expect(emulatorRecipes({ ...MAC_TMUX, terminalName: "iTerm2" }).join("\n")).toMatch(
            /Command = Super[\s\S]*tmux/,
        );
        expect(emulatorRecipes({ ...PC, modes: ["ssh"] })).toEqual([expect.stringContaining("LC_DIODE_PLATFORM=mac")]);
        expect(emulatorRecipes(PC)).toEqual([]);
    });
});

describe("formatReport — отчёт одним куском", () => {
    it("окружение, каждая проверка с цепочкой и вердиктом, рецепты и вопросы словами", () => {
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
                "os: mac (источник: env) · tier: kitty · рунг: mac-cmd",
                "caps: extended-keys, super · modes: ssh",
                "терминал: kitty(0.45.0) · TERM=xterm-kitty",
                "",
                "[1] Cmd+S — ловим: доезжает ли super и что показывают байты",
                "    ожидали: Cmd+S",
                "    байты: 1b 5b 31 31 35 3b 39 75",
                "    токены: csi-u key=s codepoint=115 eventType=0 mods=Meta",
                '    событие: key="s" code=KeyS mods=Meta',
                "    бинд: workbench.action.files.save [when: macKeys >= 3]",
                "    вердикт: OK",
                "[2] Home — ловим: уехал ли курсор или проскроллился буфер терминала",
                "    ожидали: Home",
                "    получили: ничего",
                "    вердикт: не дошла вовсе",
                "[3] Option+буква, которая на твоей раскладке даёт @ [ ] { } (нет такой — Escape) — ловим: не съели ли мы ввод символа на интернациональной раскладке",
                "    ожидали: печатный символ",
                "    байты: 40",
                "    токены: char codepoint=64 char=@",
                '    событие: key="@" code=— mods=—',
                "    бинд: нет",
                "    вердикт: OK",
                "[4] Ctrl+Tab — подержи Ctrl и отпусти — ловим: есть ли keyup (kitty event types) — от него закрывается оверлей вкладок",
                "    ожидали: Ctrl+Tab",
                "    байты: 1b 5b 39 3b 35 75",
                "    токены: csi-u key=Tab codepoint=9 eventType=0 mods=Ctrl",
                '    событие: key="Tab" code=— mods=Ctrl',
                "    бинд: нет",
                "    keyup Control: нет",
                "    вердикт: дошла, но keyup модификатора не пришёл",
                "",
                "Рецепты (не проверено на живом маке — поправь, если у тебя иначе):",
                "- kitty.conf: macos_option_as_alt left (только левый — правый оставь для @ [ ] { }).",
                "- kitty.conf: сними свои Cmd-шорткаты, которые нужны редактору: map cmd+t/cmd+n/cmd+p … no_op (Cmd+C/V оставь).",
                "",
                "Про Cmd+Q / Cmd+W / Cmd+H и Ctrl+C / Ctrl+D / Ctrl+Z вне редактора — напиши словами, работают ли.",
                "",
            ].join("\n"),
        );
    });

    it("несколько токенов в одном нажатии — через « | »", () => {
        const report = formatReport(PC, [result(PC, "home", key("home", "\x1bOH\x1bOH"))]);
        expect(report).toContain("    токены: ss3 key=Home finalByte=H | ss3 key=Home finalByte=H");
    });

    it("без рецептов секции рецептов нет", () => {
        expect(formatReport(PC, [])).not.toContain("Рецепты");
    });
});
