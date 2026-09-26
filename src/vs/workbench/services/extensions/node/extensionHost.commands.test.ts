import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    registerAndActivate,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { currentCursorChangeSource } from "../../../../editor/common/core/cursorChangeSource.ts";

describe("ExtensionHost — commands bridge (subprocess)", () => {
    it("host → subprocess: ядро исполняет прокси-команду расширения через реальный RPC", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [extensionFixture("test.registersCommand", "registersCommand.cjs")],
        });
        try {
            // Команда зарегистрирована сабпроцессом → в host CommandRegistry есть прокси.
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);

            // Полная цепочка: CommandRegistry.execute → прокси → RPC на сабпроцесс →
            // локальный callback → editor.options → RPC editor.setOptions обратно.
            const result = await harness.commandRegistry.execute("test.applyTab", 5);
            expect(result).toBe("applied:5");

            await settle();
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(5);
        } finally {
            await harness.dispose();
        }
    });

    it("commandTitles из contributes.commands делают прокси видимым в палитре", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [
                {
                    ...extensionFixture("test.registersCommand", "registersCommand.cjs"),
                    commandTitles: { "test.applyTab": "Apply Tab" },
                },
            ],
        });
        try {
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
            // Без title команда исполнима, но невидима; с title — попадает в listCommands.
            const listed = harness.commandRegistry.listCommands();
            expect(listed).toContainEqual({ id: "test.applyTab", title: "Apply Tab" });
        } finally {
            await harness.dispose();
        }
    });

    it("host → subprocess: dispose расширения снимает прокси из host-реестра", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            const disposable = await registerAndActivate(
                harness.host,
                extensionFixture("test.registersCommand", "registersCommand.cjs"),
            );
            await settle();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);

            disposable.dispose();
            await settle();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("subprocess → host: fall-through executeCommand исполняет команду ядра", async () => {
        // Порядок: сначала регистрируем хостовую команду, потом активируем расширение —
        // поэтому harness создаётся БЕЗ extensions, регистрация вручную.
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            let captured: number | null = null;
            harness.commandRegistry.register("test.hostApply", (n) => {
                captured = n as number;
                harness.group.getActiveEditor()?.setIndentOptions({ tabSize: n as number });
                return "host-ran";
            });

            await registerAndActivate(harness.host, extensionFixture("test.callsHost", "callsHostCommand.cjs"));
            await settle();

            expect(captured).toBe(7);
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(7);
        } finally {
            await harness.dispose();
        }
    });

    // Продюсер источника `command` для смены каретки: команда, запущенная
    // расширением, обязана приехать обратно как
    // `TextEditorSelectionChangeKind.Command`, а не «источник неизвестен».
    it("subprocess → host: команда расширения исполняется внутри области command", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            const seen: (string | undefined)[] = [];
            harness.commandRegistry.register("test.hostApply", () => {
                seen.push(currentCursorChangeSource());
                return null;
            });

            await registerAndActivate(harness.host, extensionFixture("test.callsHost", "callsHostCommand.cjs"));
            await settle();

            expect(seen).toEqual(["command"]);
            // Область закрылась вместе с обработчиком.
            expect(currentCursorChangeSource()).toBeUndefined();
        } finally {
            await harness.dispose();
        }
    });

    it("local-first: executeCommand своей команды исполняется в сабпроцессе", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [extensionFixture("test.localFirst", "localFirstCommand.cjs")],
        });
        try {
            await settle();
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(9);
        } finally {
            await harness.dispose();
        }
    });

    it("executeCommand несуществующей команды reject'ится (маркер tabSize=3)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [extensionFixture("test.callsMissing", "callsMissingCommand.cjs")],
        });
        try {
            await settle();
            // Фикстура выставляет tabSize=3 только в ветке reject.
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(3);
        } finally {
            await harness.dispose();
        }
    });
});
