import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    ensureGopls,
    GO_LANGUAGE_SERVICE,
    goSampleFiles,
    goToolchainMissing,
    type IInstalledGo,
    installGo,
} from "../../../../../TestUtils/goFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { DEFAULT_INLAY_HINTS_OPTIONS } from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ExtensionConfigurationContributor } from "../common/extensionConfigurationContributor.ts";

// `go.inlayHints.*` on the stock extension. gopls reads them from `initializationOptions`, and after a change from
// `workspace/configuration`, where the extension's middleware adds them only if the `gopls` key reads as an object.
// gopls never sends `workspace/inlayHint/refresh`: as in VS Code, a change shows on the next request (here, an edit).

const skipReason = goToolchainMissing();
if (skipReason !== undefined) console.warn(skipReason);

const HINT_TIMEOUT_MS = 60_000;

let installed: IInstalledGo;
let gopls: string;

describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)(
    "ExtensionHost — inlay hints of stock golang.go",
    () => {
        beforeAll(async () => {
            gopls = ensureGopls();
            installed = await installGo();
        }, 600_000);

        afterAll(() => {
            installed.dispose();
        });

        it(
            "parameterNames and assignVariableTypes on the frame; a change applies with the next request",
            { timeout: 300_000 },
            async () => {
                const registry = new ConfigurationRegistry();
                new ExtensionConfigurationContributor([installed.registration], registry, () => ({})).apply();
                const settings = new InMemoryConfigurationService(
                    registry,
                    {
                        "go.alternateTools": { gopls },
                        "go.inlayHints": { parameterNames: true, assignVariableTypes: true },
                    },
                    {},
                );
                const harness = await createExtensionTestHarness({
                    languageService: GO_LANGUAGE_SERVICE,
                    activateEvents: [],
                    extensionConfigurationService: settings,
                    extensions: [installed.registration],
                });
                const onFrame = (text: string): boolean => {
                    harness.app.render();
                    return harness.app.backend.screenToString().includes(text);
                };
                try {
                    for (const [name, text] of Object.entries(goSampleFiles())) {
                        fs.mkdirSync(path.dirname(path.join(harness.tmpDir, name)), { recursive: true });
                        harness.writeFile(name, text);
                    }
                    harness.group.openFile(path.join(harness.tmpDir, "main.go"));
                    const editor = harness.group.getActiveEditor();
                    if (editor === null) throw new Error("no active editor");
                    editor.setInlayHints(DEFAULT_INLAY_HINTS_OPTIONS);
                    await harness.host.activateByEvent("onLanguage:go");
                    await waitUntil(
                        "both hints",
                        () => onFrame('msg string := greet.Hello(name: "world")'),
                        HINT_TIMEOUT_MS,
                    );

                    await settings.updateValue("go.inlayHints", { parameterNames: true, assignVariableTypes: false });
                    // gopls's pull of the new value is not observable here: edit, slower than a request, until the answer
                    // changes. An edit cancels the request in flight, so a faster loop would never get an answer.
                    const deadline = Date.now() + HINT_TIMEOUT_MS;
                    while (!onFrame('msg := greet.Hello(name: "world")')) {
                        if (Date.now() > deadline)
                            throw new Error(`no change on the frame:\n${harness.app.backend.screenToString()}`);
                        editor.viewState.applyEdits([{ range: createRange(0, 0, 0, 0), text: " " }], "test");
                        await settle(1000);
                    }
                } finally {
                    await harness.dispose();
                }
            },
        );
    },
);
