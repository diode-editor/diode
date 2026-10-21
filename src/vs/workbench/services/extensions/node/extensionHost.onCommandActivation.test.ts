import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

// Настоящий прокси субпроцесс заводит уже после `activate()` — до него команду
// держит заглушка. `activateEvents: []`: единственный повод активации — сама команда.
describe("ExtensionHost — активация по onCommand:<id>", () => {
    it("команда есть в реестре до активации, а её исполнение поднимает расширение", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            initialFile: { name: "a.txt", content: "hello" },
            extensions: [
                {
                    ...extensionFixture("test.oncommand", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                },
            ],
        });
        try {
            expect(harness.host.hasExtension("test.oncommand")).toBe(false);
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);

            await expect(harness.commandRegistry.execute("test.applyTab", 7)).resolves.toBe("applied:7");
            expect(harness.host.hasExtension("test.oncommand")).toBe(true);
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(7);
        } finally {
            await harness.dispose();
        }
    });

    it("повторное исполнение идёт прямо в прокси — второй активации нет", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            initialFile: { name: "a.txt", content: "hello" },
            extensions: [
                {
                    ...extensionFixture("test.twice", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                },
            ],
        });
        try {
            await expect(harness.commandRegistry.execute("test.applyTab", 3)).resolves.toBe("applied:3");
            expect(harness.host.extensionCount).toBe(1);
            await expect(harness.commandRegistry.execute("test.applyTab", 5)).resolves.toBe("applied:5");
            expect(harness.host.extensionCount).toBe(1);
        } finally {
            await harness.dispose();
        }
    });

    it("НЕЯВНОЕ событие: команда из contributes.commands поднимает расширение без onCommand: в манифесте", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            initialFile: { name: "a.txt", content: "hello" },
            extensions: [
                {
                    ...extensionFixture("test.implicit", "registersCommand.cjs"),
                    // Единственное объявленное событие не наступит никогда.
                    activationEvents: ["onLanguage:java"],
                    commandTitles: { "test.applyTab": "Apply Tab Size" },
                },
            ],
        });
        try {
            expect(harness.host.hasExtension("test.implicit")).toBe(false);
            await expect(harness.commandRegistry.execute("test.applyTab", 4)).resolves.toBe("applied:4");
            expect(harness.host.hasExtension("test.implicit")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("заголовок из contributes.commands делает команду видимой в палитре ДО активации", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.title", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                    commandTitles: { "test.applyTab": "Apply Tab Size" },
                },
            ],
        });
        try {
            expect(harness.host.hasExtension("test.title")).toBe(false);
            expect(harness.commandRegistry.listCommands()).toEqual([
                { id: "test.applyTab", title: "Apply Tab Size", enablement: undefined },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("категория из contributes.commands держится и на заглушке, и на живом прокси", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.category", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                    commandTitles: { "test.applyTab": "Apply Tab Size" },
                    commandCategories: { "test.applyTab": "Test" },
                },
            ],
        });
        try {
            // Иначе подпись в палитре «прыгнула» бы после первого запуска.
            expect(harness.host.hasExtension("test.category")).toBe(false);
            expect(harness.commandRegistry.listCommands()).toEqual([
                { id: "test.applyTab", title: "Apply Tab Size", enablement: undefined, category: "Test" },
            ]);

            await harness.commandRegistry.execute("test.applyTab", 4);
            await settle();
            expect(harness.host.hasExtension("test.category")).toBe(true);
            expect(harness.commandRegistry.listCommands()).toEqual([
                { id: "test.applyTab", title: "Apply Tab Size", enablement: undefined, category: "Test" },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("команда без заголовка исполнима, но в палитре не показывается (как `_java.*`)", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.untitled", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                },
            ],
        });
        try {
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
            expect(harness.commandRegistry.listCommands()).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("расширение активировалось, но команду не завело — ответ undefined, без петли", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.forgot", "noopExtension.cjs"),
                    activationEvents: ["onCommand:test.missing"],
                },
            ],
        });
        try {
            await expect(harness.commandRegistry.execute("test.missing")).resolves.toBeUndefined();
            expect(harness.host.hasExtension("test.forgot")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("заглушка не затирает живой прокси активного расширения", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello" },
            extensions: [extensionFixture("test.active", "registersCommand.cjs")],
        });
        try {
            expect(harness.host.hasExtension("test.active")).toBe(true);
            harness.host.registerExtension({
                ...extensionFixture("test.latecomer", "noopExtension.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
            });
            await settle();
            await expect(harness.commandRegistry.execute("test.applyTab", 6)).resolves.toBe("applied:6");
            expect(harness.host.hasExtension("test.latecomer")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("снятие регистрации до активации убирает команду из реестра", async () => {
        const harness = await createExtensionTestHarness({ activateEvents: [] });
        try {
            const disposable = harness.host.registerExtension({
                ...extensionFixture("test.removed", "registersCommand.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
                commandTitles: { "test.applyTab": "Apply Tab Size" },
            });
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
            disposable.dispose();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(false);
            expect(harness.commandRegistry.listCommands()).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("снятие соседа не захлопывает дверь: команду объявляют двое", async () => {
        const harness = await createExtensionTestHarness({ activateEvents: [] });
        try {
            // Посторонний сосед первым — чтобы поиск «кто ещё объявляет эту
            // команду» прошёл мимо непричастной регистрации, а не сразу нашёл.
            harness.host.registerExtension({
                ...extensionFixture("test.zero", "noopExtension.cjs"),
                activationEvents: ["onStartupFinished"],
            });
            const first = harness.host.registerExtension({
                ...extensionFixture("test.one", "registersCommand.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
                commandTitles: { "test.applyTab": "Apply Tab Size" },
            });
            harness.host.registerExtension({
                ...extensionFixture("test.two", "noopExtension.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
            });

            first.dispose();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("непричастный сосед дверь не удерживает: заглушка снимается вместе с хозяином", async () => {
        const harness = await createExtensionTestHarness({ activateEvents: [] });
        try {
            harness.host.registerExtension({
                ...extensionFixture("test.bystander", "noopExtension.cjs"),
                activationEvents: ["onCommand:test.other"],
            });
            const owner = harness.host.registerExtension({
                ...extensionFixture("test.owner", "registersCommand.cjs"),
                activationEvents: ["onCommand:test.applyTab"],
            });
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);

            owner.dispose();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(false);
            expect(harness.commandRegistry.has("test.other")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("dispose хоста снимает заглушки из общего реестра команд", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.disposed", "registersCommand.cjs"),
                    activationEvents: ["onCommand:test.applyTab"],
                },
            ],
        });
        expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
        await harness.dispose();
        expect(harness.commandRegistry.has("test.applyTab")).toBe(false);
    });

    it("activateByEvent('onCommand:<id>') поднимает расширение и напрямую", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.direct", "noopExtension.cjs"),
                    activationEvents: ["onLanguage:java"],
                    commandTitles: { "test.some": "Some" },
                },
            ],
        });
        try {
            await harness.host.activateByEvent("onCommand:test.some");
            await settle();
            expect(harness.host.hasExtension("test.direct")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });
});
