import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideCompletions,
    provideDefinitions,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import {
    type IInstalledTerraform,
    installTerraform,
    MAIN_TF,
    TERRAFORM_ID,
    TF_LANGUAGE_SERVICE,
} from "../../../../../TestUtils/terraformFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// hashicorp.terraform падал на активации (TreeItem, context.extension,
// createTelemetryLogger, authentication).

let installed: IInstalledTerraform;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый hashicorp.terraform (terraform-ls, сквозняк)", () => {
    beforeAll(async () => {
        installed = await installTerraform();
        expect(installed.registration.id).toBe(TERRAFORM_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "активация без ошибок; диагностика, hover, F12 и автодополнение от terraform-ls",
        { timeout: 240_000 },
        async () => {
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: TF_LANGUAGE_SERVICE,
                activateEvents: [],
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [installed.registration],
            });
            try {
                const mainPath = harness.writeFile("main.tf", MAIN_TF);
                const mainUri = Uri.file(mainPath).toString();
                harness.group.openFile(mainPath);
                // Ленивая активация ровно тем событием, которое объявляет манифест vsix.
                await harness.host.activateByEvent("onLanguage:terraform");
                expect(harness.host.hasExtension(TERRAFORM_ID)).toBe(true);

                // Диагностика от НАСТОЯЩЕГО terraform-ls — сигнал готовности сервера.
                const unexpected = await until("диагностика bogus_attr", () => {
                    const markers = published.filter((p) => p.resource === mainUri).at(-1)?.markers ?? [];
                    return Promise.resolve(markers.find((m) => m.message.includes('"bogus_attr"')) ?? null);
                });
                expect(unexpected.range.start.line).toBe(18);

                const at = (line: number, character: number) => ({
                    uri: mainUri,
                    languageId: "terraform",
                    versionId: documentVersion(harness, mainUri),
                    line,
                    character,
                });

                // Hover над `var.region` — тип переменной из её объявления.
                const hovers = await provideHovers(harness, at(14, 17));
                expect(hovers.flatMap((hover) => hover.contents).join("\n")).toContain("string");

                // F12 с `var.region` — на блок `variable "region"`.
                const definitions = await provideDefinitions(harness, at(14, 17));
                expect(definitions).toEqual([expect.objectContaining({ uri: mainUri })]);
                expect(definitions[0]?.range.start.line).toBe(8);

                // Автодополнение в теле aws_instance — атрибуты из вшитой схемы AWS.
                const completions = await provideCompletions(harness, at(19, 2));
                expect(completions.items.map((item) => item.label)).toContain("ami");

                const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                expect(crashes).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
