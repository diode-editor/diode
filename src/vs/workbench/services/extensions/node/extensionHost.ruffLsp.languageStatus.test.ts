import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff, LINT_PY, RUFF_ID } from "../../../../../TestUtils/ruffFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ExtensionLanguageStatusAdapter } from "../../../api/browser/extensionLanguageStatusAdapter.ts";
import { LanguageStatusService } from "../../languageStatus/common/languageStatusService.ts";

let installed: IInstalledRuff;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock ruff.vsix language status", () => {
    beforeAll(async () => {
        installed = await installRuff();
        expect(installed.registration.id).toBe(RUFF_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("Ruff's language status item reaches the service for a .py file only", { timeout: 240_000 }, async () => {
        const service = new LanguageStatusService();
        const shown: string[] = [];
        const harness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            languageStatusSink: new ExtensionLanguageStatusAdapter(service),
            outputSink: { append: () => undefined, show: (_channel, label) => shown.push(label) },
            extensions: [installed.registration],
        });
        try {
            const lintPath = harness.writeFile("lint.py", LINT_PY);
            harness.group.openFile(lintPath);
            await harness.host.activateByEvent("onLanguage:python");

            const status = await until("Ruff language status for lint.py", () =>
                Promise.resolve(service.getLanguageStatus(Uri.file(lintPath), "python")[0] ?? null),
            );
            // What the quick pick shows: the item's text, and its command as the hint.
            expect(status).toMatchObject({
                id: `${RUFF_ID}/ruff`,
                source: RUFF_ID,
                name: "Ruff",
                label: "Ruff",
                command: { id: "ruff.showLogs", title: "Open logs" },
            });
            expect(service.getLanguageStatus(Uri.file(lintPath.replace(/\.py$/u, ".txt")), "plaintext")).toEqual([]);

            // Choosing the item runs the extension's own command: it reveals Ruff's log channel.
            const command = status.command;
            await harness.commandRegistry.execute(command?.id ?? "", ...(command?.arguments ?? []));
            expect(shown).toContainEqual(expect.stringMatching(/Ruff/u));
        } finally {
            await harness.dispose();
        }
    });
});
