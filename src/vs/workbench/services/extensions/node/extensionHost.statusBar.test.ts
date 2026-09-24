import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { CommandServiceAdapter } from "../../../api/browser/commandServiceAdapter.ts";
import { ExtensionStatusBarAdapter } from "../../../api/browser/extensionStatusBarAdapter.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

// Полный круг `window.createStatusBarItem` через НАСТОЯЩИЙ субпроцесс: пункт,
// созданный расширением при активации, доезжает до StatusBarService, клик по
// его записи исполняет команду расширения, а её правка текста возвращается в
// полосу. Герметичный аналог сценариев 1–7 постановки.

/**
 * Харнесс с настоящим мостом полосы. Адаптер собирается ДО харнесса —
 * расширение ставит пункт уже в `activate()`, и сток обязан быть живым к этому
 * моменту. Реестр команд харнесса ещё не существует, поэтому он резолвится
 * лениво, в момент клика.
 */
async function makeHarness(withBridge = true) {
    const bar = new StatusBarService(NULL_STATE_SERVICE);
    let registry: CommandRegistry | null = null;
    const commands: ICommandService = {
        execute: (id, args) => new CommandServiceAdapter(assertRegistry(registry)).execute(id, args),
        registerProxy: (id, invoke, title) =>
            new CommandServiceAdapter(assertRegistry(registry)).registerProxy(id, invoke, title),
    };
    const adapter = new ExtensionStatusBarAdapter(bar, commands);
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "x\n" },
        ...(withBridge ? { statusBarItemSink: adapter } : {}),
        extensions: [extensionFixture("test.statusBar", "createsStatusBarItem.cjs")],
    });
    registry = harness.commandRegistry;
    return { bar, harness };
}

function assertRegistry(registry: CommandRegistry | null): CommandRegistry {
    /* v8 ignore next -- защитный гард: к моменту клика харнесс уже собран */
    if (registry === null) throw new Error("харнесс ещё не собран");
    return registry;
}

/** Тексты записей полосы в порядке отрисовки. */
function texts(bar: StatusBarService): string[] {
    return bar.entries().map((entry) => entry.text);
}

describe("ExtensionHost — пункт статус-бара расширения (subprocess)", () => {
    it("пункт, созданный при активации, виден в полосе; клик исполняет команду расширения", async () => {
        const { bar, harness } = await makeHarness();
        try {
            await settle();
            const entry = bar.entries().at(0);
            expect(entry).toMatchObject({
                id: "extensions.status-bar-demo",
                text: "Demo",
                alignment: "right",
                priority: 100,
                name: "Status Bar Demo",
            });

            // Клик по записи полосы → команда расширения → правка текста пункта
            // → обратно в полосу. Ровно то, чего ядро само сделать не может.
            entry?.onClick?.();
            await settle();
            expect(texts(bar)).toEqual(["Demo · clicked 1"]);

            bar.entries().at(0)?.onClick?.();
            await settle();
            expect(texts(bar)).toEqual(["Demo · clicked 2"]);
        } finally {
            await harness.dispose();
        }
    });

    it("hide/show/dispose расширения отражаются в полосе немедленно", async () => {
        const { bar, harness } = await makeHarness();
        try {
            await settle();
            expect(texts(bar)).toEqual(["Demo"]);

            await harness.commandRegistry.execute("test.statusBar.hide");
            await settle();
            expect(texts(bar)).toEqual([]);

            await harness.commandRegistry.execute("test.statusBar.show");
            await settle();
            expect(texts(bar)).toEqual(["Demo"]);

            await harness.commandRegistry.execute("test.statusBar.dispose");
            await settle();
            expect(texts(bar)).toEqual([]);

            // Правка выброшенного пункта ничего не возвращает и ничего не роняет.
            await harness.commandRegistry.execute("test.statusBar.setText", "Demo 42");
            await settle();
            expect(texts(bar)).toEqual([]);

            // Остальные команды расширения живы.
            await harness.commandRegistry.execute("test.statusBar.createLeft");
            await settle();
            expect(texts(bar)).toEqual(["L-high"]);
        } finally {
            await harness.dispose();
        }
    });

    it("смерть субпроцесса убирает пункты расширения; следующая активация возвращает их", async () => {
        const { bar, harness } = await makeHarness();
        try {
            await settle();
            bar.addEntry({ id: "status.editor.encoding", text: "UTF-8", alignment: "right", priority: 30 });
            expect(texts(bar)).toEqual(["Demo", "UTF-8"]);

            // Расширение роняет свой процесс: его `dispose` не придёт никогда,
            // и снять пункт может только хост.
            await harness.commandRegistry.execute("test.statusBar.kill");
            await settle(500);
            expect(texts(bar)).toEqual(["UTF-8"]);

            // Следующее событие активации — ЛЮБОЕ, не только «своё» — поднимает
            // субпроцесс заново: `*` у пережившего смерть расширения давно
            // отгорел и второй раз не наступит (в приложении это открытие файла,
            // то есть `onLanguage:<язык>`).
            await harness.host.activateByEvent("onLanguage:markdown");
            await settle();
            expect(texts(bar)).toEqual(["Demo", "UTF-8"]);
        } finally {
            await harness.dispose();
        }
    });

    it("без стока пункты просто отбрасываются — host и расширение живы", async () => {
        const { bar, harness } = await makeHarness(false);
        try {
            await settle();
            await expect(harness.commandRegistry.execute("test.statusBar.click")).resolves.toBe(1);
            expect(texts(bar)).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
