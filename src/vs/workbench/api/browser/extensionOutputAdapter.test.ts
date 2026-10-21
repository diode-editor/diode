import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ILogService, ILogSink } from "../../../platform/log/common/iLogService.ts";
import { LogLevel } from "../../../platform/log/common/logLevel.ts";
import { LogService } from "../../../platform/log/common/logService.ts";
import { RingBufferSink } from "../../../platform/log/common/ringBufferSink.ts";
import { OutputChannelRegistry } from "../../services/output/common/outputChannelRegistry.ts";
import { OutputService } from "../../services/output/common/outputService.ts";

import { ExtensionOutputAdapter } from "./extensionOutputAdapter.ts";

// Real registry, log and OutputService: the wiring is what is under test.

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

/** Shape of an extension channel id: `extensions.<extension id>.<name slug>`. */
const CH = "extensions.diode.diode-lsp-typescript.typescript-diode";
const LABEL = "TypeScript (Diode)";

describe("ExtensionOutputAdapter", () => {
    it("first line lazily registers the channel (label = name), lines reach the history with their level", () => {
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

    it("repeated lines do not duplicate registration; the first label is not overwritten", () => {
        const { adapter, registry } = makeAdapter();
        let registrations = 0;
        registry.onDidRegisterChannel(() => registrations++);

        adapter.append(CH, LABEL, "info", "a");
        adapter.append(CH, "Other label", "warn", "b");

        expect(registrations).toBe(1);
        expect(registry.getChannel(CH)?.label).toBe(LABEL);
    });

    it("two channels are independent", () => {
        const { adapter, registry, history } = makeAdapter();
        adapter.append(CH, LABEL, "info", "ts line");
        adapter.append("extensions.go", "Go", "warn", "go line");

        expect(registry.getChannel(CH)).toBeDefined();
        expect(registry.getChannel("extensions.go")).toBeDefined();
        expect(history.getEntries(CH)).toHaveLength(1);
        expect(history.getEntries("extensions.go")).toHaveLength(1);
    });

    it("show opens the panel and switches the active channel; works before the first line too", () => {
        const { adapter, registry, outputService, reveals } = makeAdapter();

        // show before the first line: the channel is registered lazily right here.
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
