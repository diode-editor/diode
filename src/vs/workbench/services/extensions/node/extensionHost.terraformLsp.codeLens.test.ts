import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import {
    type IInstalledTerraform,
    installTerraform,
    TF_LANGUAGE_SERVICE,
} from "../../../../../TestUtils/terraformFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { DEFAULT_CODE_LENS_OPTIONS } from "../../../../editor/contrib/codelens/browser/codeLensController.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { parseGoToLocationsArguments } from "../../../contrib/gotoDefinition/browser/goToLocationsArguments.ts";
import { ExtensionConfigurationContributor } from "../common/extensionConfigurationContributor.ts";

// The stock extension reads `terraform.codelens.referenceCount` once, when the language client starts, and announces
// `experimental.showReferencesCommandId` to terraform-ls. Later changes only offer a reload, in VS Code as well.

const SETTING = "terraform.codelens.referenceCount";

/** `variable "region"` (line 0) is referenced twice. */
const SOURCE = [
    'variable "region" {',
    "  type = string",
    "}",
    "",
    'output "first" {',
    "  value = var.region",
    "}",
    "",
    'output "second" {',
    "  value = var.region",
    "}",
    "",
].join("\n");

let installed: IInstalledTerraform;

async function open(harness: IExtensionHarness): Promise<{ uri: string; frame(): string }> {
    const mainPath = harness.writeFile("main.tf", SOURCE);
    harness.group.openFile(mainPath);
    harness.group.getActiveEditor()?.setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
    await harness.host.activateByEvent("onLanguage:terraform");
    return {
        uri: Uri.file(mainPath).toString(),
        frame: (): string => {
            harness.app.render();
            return harness.app.backend.screenToString();
        },
    };
}

/** The row sits above the first line of the file, at the top of the editor's view. */
function clickTitle(harness: IExtensionHarness, frame: string, title: string): void {
    const row = frame.split("\n").find((line) => line.includes(title)) ?? "";
    const x = row.indexOf(title);
    harness.group
        .getActiveEditor()
        ?.component.view.getChild()
        .dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: x, screenY: 0, localX: x, localY: 0 }),
        );
}

/** The hover over `var.region` knows the declaration: the server has indexed the module and can count references. */
async function serverIndexed(harness: IExtensionHarness, uri: string): Promise<void> {
    await until("the hover over var.region", async () => {
        const hovers = await provideHovers(harness, {
            uri,
            languageId: "terraform",
            versionId: documentVersion(harness, uri),
            line: 5,
            character: 16,
        });
        return hovers
            .flatMap((hover) => hover.contents)
            .join("\n")
            .includes("string")
            ? true
            : null;
    });
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock hashicorp.terraform code lens (terraform-ls)", () => {
    beforeAll(async () => {
        installed = await installTerraform();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "the setting brings the row, its click reaches showReferences with both locations",
        { timeout: 240_000 },
        async () => {
            const harness = await createExtensionTestHarness({
                languageService: TF_LANGUAGE_SERVICE,
                activateEvents: [],
                configuration: { [SETTING]: true },
                extensions: [installed.registration],
            });
            const seen: ReturnType<typeof parseGoToLocationsArguments>[] = [];
            harness.commandRegistry.register(
                "editor.action.showReferences",
                (uri: unknown, position: unknown, locations: unknown) => {
                    seen.push(parseGoToLocationsArguments(uri, position, locations));
                },
            );
            try {
                const { uri, frame } = await open(harness);
                await until("the row", () => Promise.resolve(frame().includes("2 references") ? true : null));
                const rows = frame().split("\n");
                const lensRow = rows.findIndex((row) => row.includes("2 references"));
                expect(rows[lensRow + 1]).toContain('variable "region"');

                clickTitle(harness, frame(), "2 references");
                await until("the command ran", () => Promise.resolve(seen.length > 0 ? true : null));
                expect(seen[0].uri.toString()).toBe(uri);
                expect(seen[0].locations.map((location) => location.range.start.line).sort()).toEqual([5, 9]);
            } finally {
                await harness.dispose();
            }
        },
    );

    it("without the setting there is no row", { timeout: 240_000 }, async () => {
        const harness = await createExtensionTestHarness({
            languageService: TF_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
        });
        try {
            const { uri, frame } = await open(harness);
            await serverIndexed(harness, uri);
            // The server declares the capability either way; without `showReferencesCommandId` it answers with nothing.
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            expect(await editor.getCodeLensPicksAtLine(0)).toEqual([]);
            expect(frame()).not.toContain("reference");
        } finally {
            await harness.dispose();
        }
    });

    it(
        "turning the setting off offers the reload, as the stock extension does in VS Code",
        { timeout: 240_000 },
        async () => {
            const messages: string[] = [];
            // Its own service, to change the setting later: the registry must know the schema of the manifest.
            const registry = new ConfigurationRegistry();
            new ExtensionConfigurationContributor([installed.registration], registry, () => ({})).apply();
            const configuration = new InMemoryConfigurationService(registry, { [SETTING]: true });
            const harness = await createExtensionTestHarness({
                languageService: TF_LANGUAGE_SERVICE,
                activateEvents: [],
                extensionConfigurationService: configuration,
                notificationSink: {
                    showMessage: (request) => {
                        messages.push(request.message);
                        return Promise.resolve(undefined);
                    },
                    cancel: () => undefined,
                },
                extensions: [installed.registration],
            });
            try {
                const { frame } = await open(harness);
                await until("the row", () => Promise.resolve(frame().includes("2 references") ? true : null));
                await configuration.updateValue(SETTING, false);
                await until("the offer", () =>
                    Promise.resolve(messages.some((message) => message.includes("Reload VSCode window")) ? true : null),
                );
            } finally {
                await harness.dispose();
            }
        },
    );

    it("terraform-ls declares no inlay hints: the provider is not registered", { timeout: 240_000 }, async () => {
        const harness = await createExtensionTestHarness({
            languageService: TF_LANGUAGE_SERVICE,
            activateEvents: [],
            configuration: { [SETTING]: true },
            extensions: [installed.registration],
        });
        try {
            const { uri, frame } = await open(harness);
            await until("the row", () => Promise.resolve(frame().includes("2 references") ? true : null));
            const target = { uri: Uri.parse(uri), languageId: "terraform" };
            expect(harness.languageFeatures.codeLensProvider.has(target)).toBe(true);
            expect(harness.languageFeatures.inlayHintsProvider.has(target)).toBe(false);
        } finally {
            await harness.dispose();
        }
    });
});
