import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ILogService, ILogSink } from "../../../platform/log/common/iLogService.ts";
import { LogService } from "../../../platform/log/common/logService.ts";
import { LogLevel } from "../../../platform/log/common/logLevel.ts";
import { RingBufferSink } from "../../../platform/log/common/ringBufferSink.ts";
import { OutputChannelRegistry } from "../../services/output/common/outputChannelRegistry.ts";
import { OutputService } from "../../services/output/common/outputService.ts";

import { ExtensionOutputAdapter } from "./extensionOutputAdapter.ts";

// Мост output-каналов расширений в панель Output: настоящие
// OutputChannelRegistry + LogService + RingBufferSink + OutputService (сетап
// как outputService.test) — связка и есть предмет теста.

function makeAdapter() {
    const logService = new LogService();
    const history = new RingBufferSink();
    logService.addSink(history as ILogSink);
    const registry = new OutputChannelRegistry();
    const outputService = new OutputService(history, logService as ILogService, registry, new ContextKeyService());
    const reveals: number[] = [];
    const adapter = new ExtensionOutputAdapter(registry, logService as ILogService, outputService, () => {
        reveals.push(1);
    });
    return { adapter, registry, history, outputService, reveals };
}

const CH = "extensions.typescript-vexx";
const LABEL = "TypeScript (Vexx)";

describe("ExtensionOutputAdapter", () => {
    it("первая строка лениво регистрирует канал (label = имя), строки доезжают в историю с уровнем", () => {
        const { adapter, registry, history } = makeAdapter();

        adapter.append(CH, LABEL, "info", "language server started");
        adapter.append(CH, LABEL, "error", "asDiagnostics failed");

        expect(registry.getChannels().some((c) => c.id === CH && c.label === LABEL)).toBe(true);
        const entries = history.getEntries(CH);
        expect(entries.map((e) => [e.level, e.message])).toEqual([
            [LogLevel.Info, "language server started"],
            [LogLevel.Error, "asDiagnostics failed"],
        ]);
    });

    it("повторные строки не дублируют регистрацию; label первой записи не перетирается", () => {
        const { adapter, registry } = makeAdapter();
        let registrations = 0;
        registry.onDidRegisterChannel(() => registrations++);

        adapter.append(CH, LABEL, "info", "a");
        adapter.append(CH, "Другой label", "warn", "b");

        expect(registrations).toBe(1);
        expect(registry.getChannel(CH)?.label).toBe(LABEL);
    });

    it("два канала независимы", () => {
        const { adapter, registry, history } = makeAdapter();
        adapter.append(CH, LABEL, "info", "ts line");
        adapter.append("extensions.go", "Go", "warn", "go line");

        expect(registry.getChannel(CH)).toBeDefined();
        expect(registry.getChannel("extensions.go")).toBeDefined();
        expect(history.getEntries(CH)).toHaveLength(1);
        expect(history.getEntries("extensions.go")).toHaveLength(1);
    });

    it("show открывает панель и переключает активный канал; работает и до первой строки", () => {
        const { adapter, registry, outputService, reveals } = makeAdapter();

        // show до первой строки: канал регистрируется лениво прямо здесь.
        adapter.show(CH, LABEL);
        expect(reveals).toHaveLength(1);
        expect(registry.getChannel(CH)?.label).toBe(LABEL);
        expect(outputService.getActiveChannelId()).toBe(CH);

        adapter.append("extensions.go", "Go", "info", "x");
        adapter.show("extensions.go", "Go");
        expect(reveals).toHaveLength(2);
        expect(outputService.getActiveChannelId()).toBe("extensions.go");
    });
});
