import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { FitContentElement } from "@tuidom/elements/layout/fitContentElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { detachedLayoutService, testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";
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

// pc steps: save, palette, quickOpen, find, home, ctrlShift.e, ctrlShift.m, hold.
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
        testLayoutService(body),
    );
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
    it("walks through the steps, records presses and resolves with the report", async () => {
        const { testApp, doctor, screen } = makeDoctor();
        const run = doctor.run();
        expect(screen()).toContain("Keyboard Doctor");
        expect(screen()).toContain("Step 1/8: press Ctrl+S");
        expect(screen()).toContain("os: linux (source: default)");
        expect(screen()).toContain("Checks: whether the basic set works");
        expect(screen()).toContain("Nothing pressed yet");
        expect(screen()).toContain("Escape — nothing happened");

        testApp.sendKey("Ctrl+S");
        expect(screen()).toContain("Step 2/8");
        expect(screen()).toContain('Last: key="s"');
        expect(screen()).toContain("keybinding: save · OK");

        // Ctrl+Shift+P "did not arrive" on this step — Escape.
        testApp.sendKey("Escape");
        expect(screen()).toContain("Last: nothing · keybinding: none · did not arrive at all");

        for (let i = 2; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        expect(screen()).toContain("Step 8/8: press Ctrl+Tab — hold Ctrl, then release");

        // Hold: keydown Ctrl+Tab (CSI-u), then keyup Control (Kitty event type 3).
        testApp.backend.sendRaw("\x1b[9;5u");
        expect(screen()).toContain("now release the modifier");
        expect(screen()).toContain("Enter — keyup never came");
        testApp.backend.sendRaw("\x1b[57442;5:3u");

        const report = await run;
        expect(doctor.isOpen()).toBe(false);
        expect(report).toContain("[1] Ctrl+S");
        expect(report).toContain("    verdict: OK");
        expect(report).toContain("[2] Ctrl+Shift+P");
        expect(report).toContain("    keyup Control: yes");
        expect(report.match(/verdict: did not arrive at all/g)).toHaveLength(PC_STEPS - 2);
    });

    it("hold without keyup: a bare Enter closes the step with the «keyup never came» verdict", async () => {
        const { testApp, doctor } = makeDoctor();
        const run = doctor.run();
        for (let i = 0; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("Ctrl+Enter"); // not a bare Enter — keep waiting for keyup
        expect(doctor.isOpen()).toBe(true);
        testApp.backend.sendRaw("\x1b[57441;2:3u"); // keyup of a different modifier — not ours
        expect(doctor.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        const report = await run;
        expect(report).toContain("    keyup Control: no");
        expect(report).toContain("the modifier keyup never came");
    });

    it("a bare key and Escape with a modifier are presses, not «nothing arrived»", async () => {
        const { testApp, doctor } = makeDoctor();
        const run = doctor.run();
        testApp.sendKey("Home");
        testApp.backend.sendRaw("\x1b[27;2u"); // Shift+Escape (CSI-u) — the harness DSL has no such form
        for (let i = 2; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("Enter");
        const report = await run;
        expect(report).toContain('    event: key="Home" code=Home mods=—');
        expect(report).toContain('    event: key="Escape" code=Escape mods=Shift');
    });

    it("on completion focus returns to where it was", async () => {
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

    it("keyup outside a keyup step does nothing; lone modifiers are not a step press", async () => {
        const { testApp, doctor, screen } = makeDoctor();
        const run = doctor.run();
        testApp.backend.sendRaw("\x1b[57442;5:3u");
        // Control, Shift, CapsLock as separate keydowns (Kitty) — they have no paired keypress.
        for (const raw of ["\x1b[57442u", "\x1b[57441u", "\x1b[57358u"]) testApp.backend.sendRaw(raw);
        expect(screen()).toContain("Step 1/8");
        testApp.sendKey("Ctrl+S");
        for (let i = 1; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("Enter");
        const report = await run;
        expect(report).toContain(
            "[1] Ctrl+S — checks: whether the basic set works\n    expected: Ctrl+S\n    bytes: 13",
        );
        expect(report).not.toMatch(/key="(Control|Shift|CapsLock)"/);
    });

    it("on the hold step: a keyup before the press and a bare key while awaiting keyup do not close the step", async () => {
        const { testApp, doctor, screen } = makeDoctor();
        const run = doctor.run();
        for (let i = 0; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.backend.sendRaw("\x1b[57442;5:3u"); // Ctrl released before Ctrl+Tab itself
        expect(screen()).toContain("Step 8/8");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("a"); // not Enter — keep waiting for keyup
        expect(doctor.isOpen()).toBe(true);
        testApp.backend.sendRaw("\x1b[57442;5:3u");
        expect(await run).toContain("    keyup Control: yes");
    });

    it("Cmd (super bit) reaches the doctor as Meta, the keybinding is looked up by what arrived", async () => {
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
        expect(report).toContain("    bytes: 1b 5b 31 31 35 3b 39 75");
        expect(report).toContain("    verdict: arrived, but did not match");
    });

    it("an environment change (rung raised on the fly) redraws the header; the subscription is dropped after the end", async () => {
        const { testApp, doctor, setEnv, screen, listeners } = makeDoctor();
        const run = doctor.run();
        setEnv({ ...PC, os: "mac", osSource: "terminal" });
        expect(screen()).toContain("os: mac (source: terminal)");
        for (let i = 0; i < PC_STEPS - 1; i++) testApp.sendKey("Escape");
        testApp.sendKey("Ctrl+Tab");
        testApp.sendKey("Enter");
        await run;
        expect(listeners.size).toBe(0);
    });

    it("a repeated run starts over; run without attachHost throws; dispose closes", () => {
        const { testApp, doctor, screen } = makeDoctor();
        void doctor.run();
        testApp.sendKey("Ctrl+S");
        void doctor.run();
        expect(screen()).toContain("Step 1/8");
        doctor.dispose();
        expect(doctor.isOpen()).toBe(false);

        const detached = new KeyboardDoctorComponent(
            { snapshot: () => PC, onDidChange: () => ({ dispose() {} }) },
            () => [],
            detachedLayoutService(),
        );
        expect(detached.isOpen()).toBe(false);
        expect(() => detached.run()).toThrow(/root is not attached/);
        expect(() => {
            detached.dispose();
        }).not.toThrow();
    });
});
