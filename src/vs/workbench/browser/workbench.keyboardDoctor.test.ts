import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TerminalEnvironmentServiceDIToken } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";

// Keyboard Doctor сквозняком по настоящему контейнеру: проводка DI (снимок
// окружения, подписка на его смену, поиск биндов в живом реестре), host
// оверлея от WorkbenchComponent и доставка отчёта в безымянный документ.

describe("Workbench — Keyboard Doctor", () => {
    let harness: IAppHarness;
    let workspace: ITempWorkspace;

    afterEach(() => {
        harness.dispose();
        workspace.dispose();
    });

    it("команда открывает доктора, он видит реальные бинды и окружение, отчёт уходит в документ", async () => {
        workspace = createTempWorkspace({ prefix: "diode-keyboard-doctor-", files: { "file.txt": "hello" } });
        harness = createAppTestHarness({
            openFile: workspace.path("file.txt"),
            focusEditor: true,
            size: new Size(160, 40),
        });
        const { testApp, commands } = harness;
        const screen = (): string => {
            testApp.render();
            return testApp.backend.screenToString();
        };

        const done = commands.execute("diode.keyboardDoctor");
        expect(screen()).toContain("Keyboard Doctor");
        expect(screen()).toContain("Шаг 1/");
        expect(screen()).not.toContain("super");

        // Смена окружения на лету (увидели Cmd) перерисовывает шапку.
        harness.container.get(TerminalEnvironmentServiceDIToken).noteSuperObserved();
        expect(screen()).toContain("super");

        // Ctrl+S ищется в живом реестре: save — через mod, действует в этом окружении.
        testApp.sendKey("Ctrl+S");
        expect(screen()).toContain("бинд: workbench.action.files.save [when: macKeys < 3]");

        for (let i = 0; i < 30 && screen().includes("Keyboard Doctor"); i++) {
            testApp.sendKey(screen().includes("теперь отпусти модификатор") ? "Enter" : "Escape");
        }
        await done;
        expect(harness.activeEditor().getText()).toMatch(/^Diode Keyboard Doctor\n/);
    });
});
