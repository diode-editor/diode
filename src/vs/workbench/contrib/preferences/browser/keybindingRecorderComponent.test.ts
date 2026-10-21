import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { detachedLayoutService, testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";
import {
    formatKeybinding,
    parseChord,
    serializeChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { KeybindingRecorderComponent } from "./keybindingRecorderComponent.ts";

function makeHost(tier = "kitty", os = "linux") {
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    const recorder = new KeybindingRecorderComponent({ tier, os }, testLayoutService(body));
    testApp.render();
    return { body, testApp, recorder };
}

describe("KeybindingRecorderComponent — recording", () => {
    it("accumulates chord parts and accepts on Enter", async () => {
        const { testApp, recorder } = makeHost();

        const recording = recorder.record("Save File");
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("Press desired key combination");
        expect(testApp.backend.screenToString()).toContain("Save File");

        testApp.sendKey("Ctrl+K");
        testApp.sendKey("Ctrl+U");
        testApp.render();
        expect(testApp.backend.screenToString()).toContain(formatKeybinding(parseChord("ctrl+k ctrl+u")));

        testApp.sendKey("Enter");
        const chord = await recording;

        expect(chord).not.toBeNull();
        expect(serializeChord(chord!)).toBe("ctrl+k ctrl+u");
        expect(recorder.isOpen()).toBe(false);
    });

    it("on mac the chord is labeled with glyphs", () => {
        const { testApp, recorder } = makeHost("kitty", "mac");
        void recorder.record("Save File");
        testApp.backend.sendRaw("\x1b[107;9u"); // Cmd+K
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("⌘K");
    });

    it("Escape cancels recording", async () => {
        const { testApp, recorder } = makeHost();

        const recording = recorder.record("Save File");
        testApp.sendKey("Ctrl+S");
        testApp.sendKey("Escape");

        expect(await recording).toBeNull();
        expect(recorder.isOpen()).toBe(false);
    });

    it("Enter with an empty chord does not accept — the recorder stays open", () => {
        const { testApp, recorder } = makeHost();

        void recorder.record("Save File");
        testApp.sendKey("Enter");

        expect(recorder.isOpen()).toBe(true);
    });

    it("Ctrl+Enter is part of the chord, not acceptance", async () => {
        const { testApp, recorder } = makeHost();

        const recording = recorder.record("Save File");
        testApp.sendKey("Ctrl+Enter");
        testApp.sendKey("Enter");

        const chord = await recording;
        expect(serializeChord(chord!)).toBe("ctrl+enter");
    });

    it("a lone modifier (Kitty) does not enter the chord", async () => {
        const { testApp, recorder } = makeHost();

        const recording = recorder.record("Save File");
        // Kitty sends keydown for a lone Control (CSI-u 57442 — simplified, we send just the key).
        testApp.backend.sendRaw("\x1b[57442u");
        testApp.sendKey("Ctrl+S");
        testApp.sendKey("Enter");

        const chord = await recording;
        expect(serializeChord(chord!)).toBe("ctrl+s");
    });

    it("dispose closes and releases the overlay session", () => {
        const { recorder } = makeHost();

        void recorder.record("Save File");
        recorder.dispose();

        expect(recorder.isOpen()).toBe(false);
    });

    it("a repeated record cancels the previous recording", async () => {
        const { recorder } = makeHost();

        const first = recorder.record("Save File");
        const second = recorder.record("Show Hover");

        expect(await first).toBeNull();
        expect(recorder.isOpen()).toBe(true);
        void second;
    });

    it("record before the root is attached — an explicit error", () => {
        const recorder = new KeybindingRecorderComponent({ tier: "kitty", os: "linux" }, detachedLayoutService());

        expect(recorder.isOpen()).toBe(false);
        expect(() => recorder.record("x")).toThrow(/root is not attached/);
    });

    it("dispose before the first recording does not throw (session still null)", () => {
        const recorder = new KeybindingRecorderComponent({ tier: "kitty", os: "linux" }, testLayoutService());

        // session === null — ?. in dispose is required, otherwise TypeError.
        expect(() => {
            recorder.dispose();
        }).not.toThrow();
    });

    it("overlay: recorder id, focus on it and the 'Define Keybinding' title", () => {
        const { testApp, recorder } = makeHost();

        void recorder.record("Save File");
        testApp.render();

        expect(testApp.querySelector("#keybindingRecorder")).not.toBeNull();
        expect(testApp.focusedElement?.id).toBe("keybindingRecorder");
        expect(testApp.backend.screenToString()).toContain("Define Keybinding");
    });
});

describe("KeybindingRecorderComponent — terminal warnings", () => {
    it("a non-portable combination shows a warning", () => {
        const { testApp, recorder } = makeHost();

        void recorder.record("Command Palette");
        // Ctrl+Shift+P as CSI-u (p=112, mod 6 = shift+ctrl) — sendKey doesn't know this form.
        testApp.backend.sendRaw("\x1b[112;6u");
        testApp.render();

        expect(testApp.backend.screenToString()).toContain("May not be available on legacy terminals");
    });

    it("on kitty tier a portable combination carries NEITHER a warning NOR the legacy note", () => {
        const { testApp, recorder } = makeHost("kitty");

        void recorder.record("Save File");
        testApp.sendKey("Ctrl+S");
        testApp.render();

        const screen = testApp.backend.screenToString();
        // Kitty and a portable combination: neither the portability branch nor the legacy branch may fire.
        expect(screen).not.toContain("May not be available");
        expect(screen).not.toContain("Legacy terminal");
        // The warning row under the hint is empty.
        const lines = screen.split("\n");
        const hintRow = lines.findIndex((l) => l.includes("accept"));
        expect(hintRow).toBeGreaterThanOrEqual(0);
        expect(lines[hintRow + 1]).not.toMatch(/[A-Za-z]/);
    });

    it("on legacy tier a permanent dimmed note is visible", () => {
        const { testApp, recorder } = makeHost("legacy");

        void recorder.record("Save File");
        testApp.render();

        expect(testApp.backend.screenToString()).toContain("Legacy terminal: some combinations");
    });
});
