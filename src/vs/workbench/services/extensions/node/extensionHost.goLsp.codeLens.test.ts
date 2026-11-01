import * as fs from "node:fs";
import * as path from "node:path";

import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    ensureGopls,
    GO_LANGUAGE_SERVICE,
    goSampleFiles,
    goToolchainMissing,
    type IInstalledGo,
    installGo,
} from "../../../../../TestUtils/goFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { DEFAULT_CODE_LENS_OPTIONS } from "../../../../editor/contrib/codelens/browser/codeLensController.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ExtensionConfigurationContributor } from "../common/extensionConfigurationContributor.ts";

// `go.enableCodeLens` (`runtest: true` by default) on the stock extension: its own provider over `func TestX`,
// the click runs the extension's command, whose `go test` lands in its "Go Tests" output channel.

const skipReason = goToolchainMissing();
if (skipReason !== undefined) console.warn(skipReason);

const LENS_TIMEOUT_MS = 60_000;
const FILE_LENSES = "run package tests | run file tests";
const TEST_LENSES = "run test | debug test";

let installed: IInstalledGo;
let gopls: string;

interface ILensSession {
    readonly harness: IExtensionHarness;
    readonly settings: InMemoryConfigurationService;
    readonly output: string[];
    frame(): string;
    click(title: string): void;
}

async function openTestFile(): Promise<ILensSession> {
    const output: string[] = [];
    const registry = new ConfigurationRegistry();
    new ExtensionConfigurationContributor([installed.registration], registry, () => ({})).apply();
    const settings = new InMemoryConfigurationService(registry, { "go.alternateTools": { gopls } }, {});
    const harness = await createExtensionTestHarness({
        languageService: GO_LANGUAGE_SERVICE,
        activateEvents: [],
        extensionConfigurationService: settings,
        outputSink: {
            append: (channel, _label, _level, value) => output.push(`${channel}: ${value}`),
            show: () => undefined,
        },
        extensions: [installed.registration],
    });
    for (const [name, text] of Object.entries(goSampleFiles())) {
        fs.mkdirSync(path.dirname(path.join(harness.tmpDir, name)), { recursive: true });
        harness.writeFile(name, text);
    }
    harness.group.openFile(path.join(harness.tmpDir, "greet", "greet_test.go"));
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    // The harness has no configuration service to read `editor.codeLens` from.
    editor.setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
    await harness.host.activateByEvent("onLanguage:go");
    const frame = (): string => {
        harness.app.render();
        return harness.app.backend.screenToString();
    };
    return {
        harness,
        settings,
        output,
        frame,
        click: (title) => {
            const rows = frame().split("\n");
            const y = rows.findIndex((row) => row.includes(title));
            if (y < 0) throw new Error(`"${title}" is not on the frame`);
            const x = rows[y].indexOf(title);
            // The frame starts with the tab bar; the editor's own rows start below it.
            const localY = y - 1;
            editor.component.view
                .getChild()
                .dispatchEvent(
                    new TUIMouseEvent("mousedown", { button: "left", screenX: x, screenY: y, localX: x, localY }),
                );
        },
    };
}

describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)("ExtensionHost — code lens of stock golang.go", () => {
    beforeAll(async () => {
        gopls = ensureGopls();
        installed = await installGo();
    }, 600_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "the lenses over func TestHello; the click runs go test into the Go Tests channel",
        { timeout: 300_000 },
        async () => {
            const { harness, output, frame, click } = await openTestFile();
            try {
                await waitUntil(
                    "the file and test lenses",
                    () => frame().includes(FILE_LENSES) && frame().includes(TEST_LENSES),
                    LENS_TIMEOUT_MS,
                );

                click("run test");

                await waitUntil(
                    "go test passing in the channel of the extension",
                    () =>
                        output.some(
                            (line) =>
                                line.startsWith("extensions.golang.go.go-tests: ") &&
                                line.includes("ok") &&
                                line.includes("example.com/hello/greet"),
                        ),
                    LENS_TIMEOUT_MS,
                );
            } finally {
                await harness.dispose();
            }
        },
    );

    it('"go.enableCodeLens": {"runtest": false} takes the lenses off the open file', { timeout: 300_000 }, async () => {
        const { harness, settings, frame } = await openTestFile();
        try {
            await waitUntil("the lenses", () => frame().includes(TEST_LENSES), LENS_TIMEOUT_MS);

            await settings.updateValue("go.enableCodeLens", { runtest: false });

            await waitUntil(
                "no lenses",
                () => !frame().includes(TEST_LENSES) && !frame().includes(FILE_LENSES),
                LENS_TIMEOUT_MS,
            );
        } finally {
            await harness.dispose();
        }
    });
});
