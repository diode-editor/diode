import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideCodeActions,
    provideDefinitions,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    ensureGopls,
    GO_ID,
    GO_LANGUAGE_SERVICE,
    goSampleFiles,
    goToolchainMissing,
    type IInstalledGo,
    installGo,
} from "../../../../../TestUtils/goFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createLoggerSpy } from "../../../../../TestUtils/themeExtensionFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageConfiguration } from "../../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// golang.go aborted `activate()` on the missing `vscode.debug` (and then
// `vscode.tests`, …): gopls ran, but ~60 `go.*` commands were never registered.

const skipReason = goToolchainMissing();
if (skipReason !== undefined) console.warn(skipReason);

let installed: IInstalledGo;
let gopls: string;

describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)(
    "ExtensionHost — стоковый golang.go (gopls, сквозняк)",
    () => {
        beforeAll(async () => {
            gopls = ensureGopls();
            installed = await installGo();
            expect(installed.registration.id).toBe(GO_ID);
        }, 600_000);

        afterAll(() => {
            installed.dispose();
        });

        it(
            "активация доходит до конца; диагностика, hover, F12 и save с organize imports + gofmt",
            { timeout: 300_000 },
            async () => {
                const published: { resource: string; markers: readonly WireMarker[] }[] = [];
                const outputLines: { level: string; value: string }[] = [];
                const layers: { languageId: string; configuration: ILanguageConfiguration }[] = [];
                const logger = createLoggerSpy();
                const harness: IExtensionHarness = await createExtensionTestHarness({
                    languageService: GO_LANGUAGE_SERVICE,
                    activateEvents: [],
                    logger,
                    // The fixture's gopls comes via the extension's user setting, as for a user whose gopls is not in GOBIN.
                    configuration: { go: { alternateTools: { gopls } } },
                    // Core save settings: in the app they come from the extension's `[go]` configurationDefaults (e2e).
                    configurationService: createTestConfigurationService({
                        "editor.formatOnSave": true,
                        "editor.codeActionsOnSave": { "source.organizeImports": "explicit" },
                    }),
                    diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                    outputSink: {
                        append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                        show: () => undefined,
                    },
                    languageConfigurations: {
                        register: (languageId, configuration) => {
                            layers.push({ languageId, configuration });
                            return { dispose: () => undefined };
                        },
                    },
                    extensions: [installed.registration],
                });
                try {
                    for (const [name, text] of Object.entries(goSampleFiles())) {
                        fs.mkdirSync(path.dirname(path.join(harness.tmpDir, name)), { recursive: true });
                        harness.writeFile(name, text);
                    }
                    const mainPath = path.join(harness.tmpDir, "main.go");
                    const mainUri = Uri.file(mainPath).toString();
                    harness.group.openFile(mainPath);
                    await harness.host.activateByEvent("onLanguage:go");

                    expect(vi.mocked(logger.error).mock.calls.map(([line]) => String(line))).not.toContainEqual(
                        expect.stringContaining("failed to activate"),
                    );
                    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
                        `activated extension "${GO_ID}" (onLanguage:go)`,
                    );
                    // setLanguageConfiguration is the last step of activate().
                    expect(layers.map((layer) => layer.languageId)).toContain("go");
                    const warnings = outputLines.filter((line) => line.level === "warn").map((line) => line.value);
                    expect(warnings).toContainEqual(expect.stringContaining('отладка "go"'));
                    expect(warnings).toContainEqual(expect.stringContaining('тесты "go"'));

                    // Diagnostics from the REAL gopls signal that the server is ready.
                    const unusedImport = await until("диагностика лишнего импорта os", () => {
                        const markers = published.filter((p) => p.resource === mainUri).at(-1)?.markers ?? [];
                        return Promise.resolve(
                            markers.find((m) => m.message.includes('"os" imported and not used')) ?? null,
                        );
                    });
                    expect(unusedImport.range.start.line).toBe(4);

                    const at = (line: number, character: number) => ({
                        uri: mainUri,
                        languageId: "go",
                        versionId: documentVersion(harness, mainUri),
                        line,
                        character,
                    });

                    // Hover over `Hello` in `greet.Hello("world")`: a doc comment from another package.
                    const hovers = await provideHovers(harness, at(10, 15));
                    expect(hovers.flatMap((hover) => hover.contents).join("\n")).toContain("Hello returns a greeting");

                    // F12 goes to the declaration in greet/greet.go.
                    const definitions = await provideDefinitions(harness, at(10, 15));
                    expect(definitions).toEqual([
                        expect.objectContaining({
                            uri: Uri.file(path.join(harness.tmpDir, "greet", "greet.go")).toString(),
                        }),
                    ]);
                    expect(definitions[0]?.range.start.line).toBe(5);

                    // Save warm-up: the client registers organize imports after the server starts.
                    await until("source.organizeImports от gopls", async () => {
                        const actions = await provideCodeActions(harness, {
                            uri: mainUri,
                            languageId: "go",
                            versionId: documentVersion(harness, mainUri),
                            range: createRange(0, 0, 14, 0),
                            only: "source.organizeImports",
                        });
                        return actions.length > 0 ? actions : null;
                    });

                    const outcome = await harness.group.getActiveEditor()!.save();

                    expect(outcome).toBe("saved");
                    const buffer = harness.group.getActiveEditor()?.getText() ?? "";
                    expect(buffer).not.toContain('"os"');
                    expect(buffer).toContain("fmt.Println(msg, broken)");
                    expect(fs.readFileSync(mainPath, "utf-8")).toBe(buffer);

                    const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                    expect(crashes).toEqual([]);
                } finally {
                    await harness.dispose();
                }
            },
        );
    },
);
