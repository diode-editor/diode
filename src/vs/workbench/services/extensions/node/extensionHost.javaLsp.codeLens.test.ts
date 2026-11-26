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
import {
    DEFAULT_CODE_LENS_OPTIONS,
    type ICodeLensPick,
} from "../../../../editor/contrib/codelens/browser/codeLensController.ts";
import { parseGoToLocationsArguments } from "../../../contrib/gotoDefinition/browser/goToLocationsArguments.ts";

// The lenses of the stock redhat.java, seen on the frame. jdt.ls counts references only after its import, seconds after
// the lenses arrive: this suite is what a deadline on the resolve turns into "no commands". One harness, two JVMs.

const ROW = "1 reference | 0 implementations";
const GREET_LINE = 3;

let installed: IInstalledJava | undefined;
let project: IMavenProject | undefined;
let harness: IExtensionHarness | undefined;
const shown: ReturnType<typeof parseGoToLocationsArguments>[] = [];

function frame(): string {
    harness!.app.render();
    return harness!.app.backend.screenToString();
}

/** The lens of `greet` (line 3, 0-based) with this title: what a click on it runs. The real click is in `java-lens-hints`. */
async function lensOfGreet(title: string): Promise<ICodeLensPick> {
    const picks = (await harness!.group.getActiveEditor()?.getCodeLensPicksAtLine(GREET_LINE)) ?? [];
    const pick = picks.find((candidate) => candidate.label === title);
    if (pick === undefined) throw new Error(`no lens "${title}" among ${JSON.stringify(picks.map((p) => p.label))}`);
    return pick;
}

describe.skipIf(MARKETPLACE_OFFLINE || JDK_MISSING)("ExtensionHost — stock redhat.java: code lens", () => {
    beforeAll(async () => {
        installed = await installJava();
        project = createMavenProject();
        harness = await createExtensionTestHarness({
            languageService: JAVA_LANGUAGE_SERVICE,
            workspaceFolders: [project.root],
            activateEvents: [],
            extensions: [installed.registration],
            configuration: { "java.referencesCodeLens.enabled": true, "java.implementationCodeLens": "methods" },
        });
        // The extension's `java.show.references` lands here with what the references view parses.
        harness.commandRegistry.register(
            "editor.action.showReferences",
            (uri: unknown, position: unknown, locations: unknown) => {
                shown.push(parseGoToLocationsArguments(uri, position, locations));
            },
        );
        harness.group.openFile(project.appPath);
        // The harness has no configuration service to read `editor.codeLens` from.
        harness.group.getActiveEditor()?.setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
        await harness.host.activateByEvent(JAVA_ACTIVATION_EVENT);
    }, 400_000);

    afterAll(async () => {
        await harness?.dispose();
        project?.dispose();
        installed?.dispose();
    });

    it(
        "the settings bring the counts over the method, a busy server leaves no 'no commands' behind",
        { timeout: 300_000 },
        async () => {
            await until("the counts", () => Promise.resolve(frame().includes(ROW) ? true : null), 280_000);
            expect(frame()).not.toContain("no commands");
        },
    );

    it("the command of the count reaches the references with the call of `greet`", { timeout: 120_000 }, async () => {
        await until("the counts", () => Promise.resolve(frame().includes(ROW) ? true : null), 60_000);
        await (await lensOfGreet("1 reference")).command.run?.();
        await until("the command ran", () => Promise.resolve(shown.length > 0 ? true : null), 30_000);
        // `String message = greet("world");` is line 8, 0-based.
        expect(shown[0].locations.map((location) => location.range.start.line)).toEqual([8]);
        expect(shown[0].locations[0].uri).toMatch(/App\.java$/);
    });

    it(
        "a zero count runs the extension's command with no locations, what upstream shows silently as nothing",
        { timeout: 120_000 },
        async () => {
            await until("the counts", () => Promise.resolve(frame().includes(ROW) ? true : null), 60_000);
            const before = shown.length;
            await (await lensOfGreet("0 implementations")).command.run?.();
            await until("the command ran", () => Promise.resolve(shown.length > before ? true : null), 30_000);
            expect(shown[before].locations).toEqual([]);
        },
    );
});
