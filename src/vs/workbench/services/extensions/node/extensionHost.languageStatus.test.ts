import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ExtensionLanguageStatusAdapter } from "../../../api/browser/extensionLanguageStatusAdapter.ts";
import { LanguageStatusService } from "../../languageStatus/common/languageStatusService.ts";

const TEXT_FILE = Uri.file("/work/notes.txt");

async function makeHarness() {
    const service = new LanguageStatusService();
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "x\n" },
        languageStatusSink: new ExtensionLanguageStatusAdapter(service),
        extensions: [extensionFixture("test.languageStatus", "createsLanguageStatusItem.cjs")],
    });
    return { service, harness };
}

describe("ExtensionHost — language status item (subprocess)", () => {
    it("an item created on activation reaches the service; its command runs in the extension and updates it", async () => {
        const { service, harness } = await makeHarness();
        try {
            await settle();
            expect(service.getLanguageStatus(TEXT_FILE, "typescript")).toEqual([]);
            const [status] = service.getLanguageStatus(TEXT_FILE, "plaintext");
            expect(status).toMatchObject({
                id: "test.languageStatus/demo",
                source: "test.languageStatus",
                name: "Language Status Demo",
                label: "$(check) Demo Server",
                detail: "ready",
                severity: 0,
                busy: false,
                command: { id: "test.languageStatus.restart", title: "Restart", arguments: ["now"] },
            });

            const command = status.command;
            await harness.commandRegistry.execute(command?.id ?? "", ...(command?.arguments ?? []));
            await settle();
            expect(service.getLanguageStatus(TEXT_FILE, "plaintext")[0]?.detail).toBe("restarted 1 (now)");

            await harness.commandRegistry.execute("test.languageStatus.warn");
            await harness.commandRegistry.execute("test.languageStatus.busy", true);
            await settle();
            expect(service.getLanguageStatus(TEXT_FILE, "plaintext")[0]).toMatchObject({ severity: 1, busy: true });

            await harness.commandRegistry.execute("test.languageStatus.dispose");
            await settle();
            expect(service.getLanguageStatus(TEXT_FILE, "plaintext")).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("subprocess death removes the extension's items; the next activation brings them back", async () => {
        const { service, harness } = await makeHarness();
        try {
            await settle();
            expect(service.getLanguageStatus(TEXT_FILE, "plaintext")).toHaveLength(1);

            await harness.commandRegistry.execute("test.languageStatus.kill");
            await settle(500);
            expect(service.getLanguageStatus(TEXT_FILE, "plaintext")).toEqual([]);

            await harness.host.activateByEvent("onLanguage:markdown");
            await settle();
            expect(service.getLanguageStatus(TEXT_FILE, "plaintext")).toHaveLength(1);
        } finally {
            await harness.dispose();
        }
    });
});
