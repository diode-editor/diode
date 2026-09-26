import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { FitContentElement } from "@tuidom/elements/layout/fitContentElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { Keybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { KeyboardDoctorEnv, MatchedBinding } from "../common/keyboardDoctorModel.ts";

import { type BindingLookup, KeyboardDoctorComponent } from "./keyboardDoctorComponent.ts";

const PC: KeyboardDoctorEnv = {
    os: "linux",
    osSource: "default",
    tier: "kitty",
    macKeysRung: undefined,
    capabilities: ["extended-keys"],
    modes: ["local"],
    terminalName: undefined,
    term: undefined,
};

// Шаги pc: save, palette, quickOpen, find, home, ctrlShift.e, ctrlShift.m, hold.
const PC_STEPS = 8;

function makeDoctor(initial: KeyboardDoctorEnv = PC, lookup?: BindingLookup) {
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(160, 30));
    let env = initial;
    const listeners = new Set<() => void>();
    const lookups: Keybinding[] = [];
    const doctor = new KeyboardDoctorComponent(
        {
            snapshot: () => env,
            onDidChange: (listener) => {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
        },
        lookup ??
            ((part): MatchedBinding[] => {
                lookups.push(part);
                return part.ctrlKey && part.key === "s" ? [{ commandId: "save", when: undefined, active: true }] : [];
            }),
    );
    doctor.attachHost(body);
    testApp.render();
    const setEnv = (next: KeyboardDoctorEnv): void => {
        env = next;
        for (const listener of listeners) listener();
    };
    const screen = (): string => {
        testApp.render();
        return testApp.backend.screenToString();
    };
    return { testApp, doctor, setEnv, screen, lookups, listeners, body };
}

describe("KeyboardDoctorComponent", () => {
    it("ведёт по шагам, записывает нажатия и резолвится отчётом", async () => {
        const { testApp, doctor, screen } = makeDoctor();
        const run = doctor.run();
        expect(screen()).toContain("Keyboard Doctor");
        expect(screen()).toContain("Шаг 1/8: нажми Ctrl+S");
        expect(screen()).toContain("os: linux (источник: default)");
        expect(screen()).toContain("Ловим: работает ли базовый набор");
        expect(screen()).toContain("Пока ничего не нажато");
        expect(screen()).toContain("Escape — ничего не произошло");

        testApp.sendKey("Ctrl+S");
        expect(screen()).toContain("Шаг 2/8");
        expect(screen()).toContain('Было: key="s"');
        expect(screen()).toContain("бинд: save · OK");

        // Ctrl+Shift+P на этом шаге «не дошла» — Escape.
        testApp.sendKey("Escape");
        expect(screen()).toContain("Было: ничего · бинд: нет · не дошла вовсе");

        for (let i = 2; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        expect(screen()).toContain("Шаг 8/8: нажми Ctrl+Tab — подержи Ctrl и отпусти");

        // Hold: keydown Ctrl+Tab (CSI-u), затем keyup Control (Kitty event type 3).
        testApp.backend.sendRaw("\x1b[9;5u");
        expect(screen()).toContain("теперь отпусти модификатор");
        expect(screen()).toContain("Enter — keyup так и не пришёл");
        testApp.backend.sendRaw("\x1b[57442;5:3u");

        const report = await run;
        expect(doctor.isOpen()).toBe(false);
        expect(report).toContain("[1] Ctrl+S");
        expect(report).toContain("    вердикт: OK");
        expect(report).toContain("[2] Ctrl+Shift+P");
        expect(report).toContain("    keyup Control: да");
        expect(report.match(/вердикт: не дошла вовсе/g)).toHaveLength(PC_STEPS - 2);
    });

    it("hold без keyup: голый Enter закрывает шаг с вердиктом «keyup не пришёл»", async () => {
        const { testApp, doctor } = makeDoctor();
        const run = doctor.run();
        for (let i = 0; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("Ctrl+Enter"); // не голый Enter — продолжаем ждать keyup
        expect(doctor.isOpen()).toBe(true);
        testApp.backend.sendRaw("\x1b[57441;2:3u"); // keyup чужого модификатора — не тот
        expect(doctor.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        const report = await run;
        expect(report).toContain("    keyup Control: нет");
        expect(report).toContain("keyup модификатора не пришёл");
    });

    it("голая клавиша и Escape с модификатором — это нажатия, а не «ничего не пришло»", async () => {
        const { testApp, doctor } = makeDoctor();
        const run = doctor.run();
        testApp.sendKey("Home");
        testApp.backend.sendRaw("\x1b[27;2u"); // Shift+Escape (CSI-u) — DSL харнесса такой формы не знает
        for (let i = 2; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("Enter");
        const report = await run;
        expect(report).toContain('    событие: key="Home" code=Home mods=—');
        expect(report).toContain('    событие: key="Escape" code=Escape mods=Shift');
    });

    it("по завершении фокус возвращается туда, где был", async () => {
        const { testApp, doctor, body } = makeDoctor();
        const target = new FitContentElement();
        target.id = "target";
        target.focusable = true;
        body.setContent(target);
        target.focus();
        const run = doctor.run();
        expect(testApp.focusedElement?.id).toBe("keyboardDoctor");
        for (let i = 0; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("Enter");
        await run;
        expect(testApp.focusedElement?.id).toBe("target");
    });

    it("keyup вне шага с keyup ничего не делает; одиночный модификатор — не нажатие шага", () => {
        const { testApp, doctor, screen } = makeDoctor();
        void doctor.run();
        testApp.backend.sendRaw("\x1b[57442;5:3u");
        testApp.backend.sendRaw("\x1b[57442u");
        expect(screen()).toContain("Шаг 1/8");
    });

    it("Cmd (super-бит) доходит до доктора как Meta, бинд ищется по пришедшему", async () => {
        const macCmd: KeyboardDoctorEnv = { ...PC, os: "mac", macKeysRung: "cmd", capabilities: ["super"] };
        const { testApp, doctor, lookups } = makeDoctor(macCmd, (part) => {
            lookups.push(part);
            return [];
        });
        const run = doctor.run();
        testApp.backend.sendRaw("\x1b[115;9u");
        expect(lookups[0]).toMatchObject({ key: "s", metaKey: true, ctrlKey: false });
        for (let i = 1; i < 30 && doctor.isOpen(); i++) testApp.sendKey("Escape");
        const report = await run;
        expect(report).toContain("[1] Cmd+S");
        expect(report).toContain("    байты: 1b 5b 31 31 35 3b 39 75");
        expect(report).toContain("    вердикт: дошла, но не сматчилась");
    });

    it("смена окружения (рунг поднялся на лету) перерисовывает шапку; после конца подписка снята", async () => {
        const { testApp, doctor, setEnv, screen, listeners } = makeDoctor();
        const run = doctor.run();
        setEnv({ ...PC, os: "mac", osSource: "terminal" });
        expect(screen()).toContain("os: mac (источник: terminal)");
        for (let i = 0; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("Enter");
        await run;
        expect(listeners.size).toBe(0);
    });

    it("повторный run начинает заново; run без attachHost — честная ошибка; dispose закрывает", () => {
        const { testApp, doctor, screen } = makeDoctor();
        void doctor.run();
        testApp.sendKey("Ctrl+S");
        void doctor.run();
        expect(screen()).toContain("Шаг 1/8");
        doctor.dispose();
        expect(doctor.isOpen()).toBe(false);

        const detached = new KeyboardDoctorComponent(
            { snapshot: () => PC, onDidChange: () => ({ dispose() {} }) },
            () => [],
        );
        expect(detached.isOpen()).toBe(false);
        expect(() => detached.run()).toThrow(/host is not attached/);
        expect(() => {
            detached.dispose();
        }).not.toThrow();
    });
});
