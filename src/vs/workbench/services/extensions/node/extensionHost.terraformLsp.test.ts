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

// hashicorp.terraform failed on activation (TreeItem, context.extension,
// createTelemetryLogger, authentication).

let installed: IInstalledTerraform;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock hashicorp.terraform (terraform-ls, end-to-end)", () => {
    beforeAll(async () => {
        installed = await installTerraform();
        expect(installed.registration.id).toBe(TERRAFORM_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "activation without errors; diagnostics, hover, F12 and completion from terraform-ls",
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
                // Lazy activation by exactly the event the vsix manifest declares.
                await harness.host.activateByEvent("onLanguage:terraform");
                expect(harness.host.hasExtension(TERRAFORM_ID)).toBe(true);

                // Diagnostics from the REAL terraform-ls signal that the server is ready.
                const unexpected = await until("bogus_attr diagnostic", () => {
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

                // Hover over `var.region`: the variable's type from its declaration.
                const hovers = await provideHovers(harness, at(14, 17));
                expect(hovers.flatMap((hover) => hover.contents).join("\n")).toContain("string");

                // F12 from `var.region` goes to the `variable "region"` block.
                const definitions = await provideDefinitions(harness, at(14, 17));
                expect(definitions).toEqual([expect.objectContaining({ uri: mainUri })]);
                expect(definitions[0]?.range.start.line).toBe(8);

                // Completion in the aws_instance body: attributes from the embedded AWS schema.
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
