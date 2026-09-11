import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { formatKeybinding, parseChord, serializeChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { KeybindingRecorderComponent } from "./keybindingRecorderComponent.ts";

function makeHost(tier = "kitty") {
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    const recorder = new KeybindingRecorderComponent({ tier });
    recorder.attachHost(body);
    testApp.render();
    return { body, testApp, recorder };
}

describe("KeybindingRecorderComponent — запись", () => {
    it("копит части чорда и принимает по Enter", async () => {
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

    it("Escape отменяет запись", async () => {
        const { testApp, recorder } = makeHost();

        const recording = recorder.record("Save File");
        testApp.sendKey("Ctrl+S");
        testApp.sendKey("Escape");

        expect(await recording).toBeNull();
        expect(recorder.isOpen()).toBe(false);
    });

    it("Enter при пустом чорде не принимает — рекордер остаётся открыт", () => {
        const { testApp, recorder } = makeHost();

        void recorder.record("Save File");
        testApp.sendKey("Enter");

        expect(recorder.isOpen()).toBe(true);
    });

    it("Ctrl+Enter — часть чорда, а не принятие", async () => {
        const { testApp, recorder } = makeHost();

        const recording = recorder.record("Save File");
        testApp.sendKey("Ctrl+Enter");
        testApp.sendKey("Enter");

        const chord = await recording;
        expect(serializeChord(chord!)).toBe("ctrl+enter");
    });

    it("одиночный модификатор (Kitty) не попадает в чорд", async () => {
        const { testApp, recorder } = makeHost();

        const recording = recorder.record("Save File");
        // Kitty шлёт keydown для одиночного Control (CSI-u 57442 — упрощённо шлём key).
        testApp.backend.sendRaw("\x1b[57442u");
        testApp.sendKey("Ctrl+S");
        testApp.sendKey("Enter");

        const chord = await recording;
        expect(serializeChord(chord!)).toBe("ctrl+s");
    });

    it("dispose закрывает и освобождает overlay-сессию", () => {
        const { recorder } = makeHost();

        void recorder.record("Save File");
        recorder.dispose();

        expect(recorder.isOpen()).toBe(false);
    });

    it("повторный record отменяет предыдущую запись", async () => {
        const { recorder } = makeHost();

        const first = recorder.record("Save File");
        const second = recorder.record("Show Hover");

        expect(await first).toBeNull();
        // Вторая запись живёт.
        expect(recorder.isOpen()).toBe(true);
        void second;
    });

    it("record без attachHost — честная ошибка", () => {
        const recorder = new KeybindingRecorderComponent({ tier: "kitty" });

        expect(recorder.isOpen()).toBe(false);
        expect(() => recorder.record("x")).toThrow(/host is not attached/);
    });
});

describe("KeybindingRecorderComponent — терминальные предупреждения", () => {
    it("непереносимая комбинация показывает предупреждение", () => {
        const { testApp, recorder } = makeHost();

        void recorder.record("Command Palette");
        // Ctrl+Shift+P как CSI-u (p=112, мод 6 = shift+ctrl) — sendKey такой формы не знает.
        testApp.backend.sendRaw("\x1b[112;6u");
        testApp.render();

        expect(testApp.backend.screenToString()).toContain("May not be available on legacy terminals");
    });

    it("переносимая комбинация предупреждения не несёт", () => {
        const { testApp, recorder } = makeHost();

        void recorder.record("Save File");
        testApp.sendKey("Ctrl+S");
        testApp.render();

        expect(testApp.backend.screenToString()).not.toContain("May not be available");
    });

    it("на legacy-tier видна постоянная приглушённая заметка", () => {
        const { testApp, recorder } = makeHost("legacy");

        void recorder.record("Save File");
        testApp.render();

        expect(testApp.backend.screenToString()).toContain("Legacy terminal: some combinations");
    });
});
