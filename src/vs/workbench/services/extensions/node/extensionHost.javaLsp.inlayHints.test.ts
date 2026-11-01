import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    createMavenProject,
    type IInstalledJava,
    type IMavenProject,
    installJava,
    JAVA_ACTIVATION_EVENT,
    JAVA_LANGUAGE_SERVICE,
    JDK_MISSING,
} from "../../../../../TestUtils/javaFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { DEFAULT_INLAY_HINTS_OPTIONS } from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ExtensionConfigurationContributor } from "../common/extensionConfigurationContributor.ts";

// Parameter name hints of the stock redhat.java, seen on the frame. One harness: a cold jdt.ls costs two JVMs.

const SETTING = "java.inlayHints.parameterNames.enabled";
const WITH_HINT = 'greet(who: "world")';
const WITHOUT_HINT = 'greet("world")';

let installed: IInstalledJava | undefined;
let project: IMavenProject | undefined;
let harness: IExtensionHarness | undefined;
let configuration: InMemoryConfigurationService;

function frame(): string {
    harness!.app.render();
    return harness!.app.backend.screenToString();
}

async function untilOnFrame(what: string, text: string, timeoutMs: number): Promise<void> {
    await until(what, () => Promise.resolve(frame().includes(text) ? true : null), timeoutMs);
}

describe.skipIf(MARKETPLACE_OFFLINE || JDK_MISSING)("ExtensionHost — stock redhat.java: inlay hints", () => {
    beforeAll(async () => {
        installed = await installJava();
        project = createMavenProject();
        // The manifest's defaults: the extension registers its provider only when it reads `literals` from here.
        const registry = new ConfigurationRegistry();
        new ExtensionConfigurationContributor([installed.registration], registry, () => ({})).apply();
        // The curated default the app injects: lombok breaks the compilation (docs/arch/StockExtensions.md).
        configuration = new InMemoryConfigurationService(registry, { "java.jdt.ls.lombokSupport.enabled": false }, {});
        harness = await createExtensionTestHarness({
            languageService: JAVA_LANGUAGE_SERVICE,
            workspaceFolders: [project.root],
            activateEvents: [],
            extensions: [installed.registration],
            extensionConfigurationService: configuration,
        });
        harness.group.openFile(project.appPath);
        // The harness has no configuration service to read `editor.inlayHints.enabled` from.
        harness.group.getActiveEditor()?.setInlayHints(DEFAULT_INLAY_HINTS_OPTIONS);
        await harness.host.activateByEvent(JAVA_ACTIVATION_EVENT);
    }, 400_000);

    afterAll(async () => {
        await harness?.dispose();
        project?.dispose();
        installed?.dispose();
    });

    it(
        "by default (`literals`) the literal argument has its parameter name on the frame",
        { timeout: 300_000 },
        async () => {
            await untilOnFrame("the hint before the literal", WITH_HINT, 280_000);
            // Only the literal: the next line passes a variable to `println`, which `literals` leaves bare.
            expect(frame()).toContain("System.out.println(broken);");
        },
    );

    it("`none` takes the hint away on the fly, `literals` brings it back", { timeout: 120_000 }, async () => {
        await untilOnFrame("the hint before the literal", WITH_HINT, 60_000);
        await configuration.updateValue(SETTING, "none", "workspace");
        await untilOnFrame("no hint", WITHOUT_HINT, 50_000);
        await configuration.updateValue(SETTING, "literals", "workspace");
        await untilOnFrame("the hint again", WITH_HINT, 50_000);
    });
});
