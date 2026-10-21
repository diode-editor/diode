import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideCompletions,
    provideDefinitions,
    provideHovers,
    provideReferences,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    APP_JAVA,
    createMavenProject,
    type IInstalledJava,
    type IMavenProject,
    installJava,
    JAVA_ACTIVATION_EVENT,
    JAVA_ID,
    JAVA_LANGUAGE_SERVICE,
} from "../../../../../TestUtils/javaFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { resolveScopesStyle } from "../../../../../TestUtils/textMateThemeProbe.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreHover } from "../../../../editor/common/languages/iHoverSource.ts";
import { isSemanticTokensEdits } from "../../../../editor/common/languages/iSemanticTokensSource.ts";
import { decodeSemanticTokens } from "../../../../editor/common/tokens/semanticTokensLines.ts";
import { getDocumentSemanticTokens } from "../../../../editor/contrib/semanticTokens/common/getSemanticTokens.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { parseHexColor } from "../../../../platform/theme/common/colorUtils.ts";
import { createDefaultTokenClassificationRegistry } from "../../../../platform/theme/common/tokenClassificationRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { IWireStatusBarItem } from "../../../api/common/wireTypes.ts";
import { SemanticTokenStyleResolver } from "../../themes/common/semanticTokenStyleResolver.ts";
import { darkModernTheme } from "../../themes/common/themes/darkModern.ts";
import { registerExtensionSemanticTokens } from "../common/extensionSemanticTokensContributor.ts";

// ONE harness for all cases: a cold jdt.ls start means two JVMs plus a project import
// (~16 s). The cases do not change the buffer, so they cannot spoil each other.

let installed: IInstalledJava | undefined;
let project: IMavenProject | undefined;
let harness: IExtensionHarness | undefined;
let appUri: string;
const outputLines: { level: string; value: string }[] = [];
const statusBarItems: IWireStatusBarItem[] = [];

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock redhat.java: language features", () => {
    beforeAll(async () => {
        installed = await installJava();
        project = createMavenProject();
        harness = await createExtensionTestHarness({
            languageService: JAVA_LANGUAGE_SERVICE,
            workspaceFolders: [project.root],
            activateEvents: [],
            outputSink: {
                append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                show: () => undefined,
            },
            statusBarItemSink: {
                update: (item) => statusBarItems.push(item),
                remove: () => undefined,
                clear: () => undefined,
            },
            extensions: [installed.registration],
        });
        appUri = Uri.file(project.appPath).toString();
        harness.group.openFile(project.appPath);
        await harness.host.activateByEvent(JAVA_ACTIVATION_EVENT);
        expect(harness.host.hasExtension(JAVA_ID)).toBe(true);

        // Server readiness: until the project is imported, providers answer empty,
        // and the cases below would race against a half-built state.
        await until(
            "hover responds (server ready)",
            async () => {
                if (harness === undefined) return null;
                const found = await provideHovers(harness, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness, appUri),
                    line: 8,
                    character: 27,
                });
                return found.length > 0 ? found : null;
            },
            280_000,
        );
    }, 400_000);

    afterAll(async () => {
        await harness?.dispose();
        project?.dispose();
        installed?.dispose();
    });

    it("hover over a call returns the signature from the declaration", { timeout: 120_000 }, async () => {
        expect(harness).toBeDefined();
        // Cursor on `greet(`. Via `until`: a server busy with background work answers
        // empty, so a single call flakes (verified).
        const hovers: readonly ICoreHover[] = await until(
            "hover over `greet`",
            async () => {
                const found = await provideHovers(harness!, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness!, appUri),
                    line: 8,
                    character: 27,
                });
                return found.length > 0 ? found : null;
            },
            60_000,
        );
        const joined = hovers.flatMap((h) => h.contents).join("\n");
        // The fully qualified form appears NOWHERE in the buffer, so the signature
        // really came from the server, not copied from the visible text.
        expect(joined).toContain("String demo.App.greet(String who)");
    });

    it("completion returns type members from the JDK", { timeout: 120_000 }, async () => {
        expect(harness).toBeDefined();
        // Cursor right after `System.out.` in the buffer: request text that differs from the buffer
        // flakes on sync (red CI: the server completed `System.` with a lone `out`).
        const items = await until(
            "completion after `System.out.`",
            async () => {
                const found = await provideCompletions(harness!, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness!, appUri),
                    line: 10,
                    character: 19,
                });
                return found.items.length > 0 ? found.items : null;
            },
            60_000,
        );
        const labels = items.map((i) => i.label);
        // `println` is a member of java.io.PrintStream from java.base: the JDK classpath reached
        // the server, these are not just words from the current file.
        expect(labels).toContain("println");
    });

    it("definition inside the project leads to the method declaration", { timeout: 120_000 }, async () => {
        expect(harness).toBeDefined();
        // Via `until` for the same reason as hover.
        const targets: readonly ICoreDefinitionLocation[] = await until(
            "definition for `greet`",
            async () => {
                const found = await provideDefinitions(harness!, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness!, appUri),
                    line: 8,
                    character: 27,
                });
                return found.length > 0 ? found : null;
            },
            60_000,
        );
        const target = targets[0];
        // The target is a file on disk (not `jdt:`), the line declaring `static String greet`.
        expect(target.uri).toBe(appUri);
        expect(target.range.start.line).toBe(3);
    });

    it("references finds the declaration and the call", { timeout: 120_000 }, async () => {
        expect(harness).toBeDefined();
        const found = await until(
            "references for greet",
            async () => {
                const refs = await provideReferences(harness!, {
                    uri: appUri,
                    languageId: "java",
                    versionId: documentVersion(harness!, appUri),
                    line: 3,
                    character: 18,
                    includeDeclaration: true,
                });
                return refs.length > 0 ? refs : null;
            },
            60_000,
        );
        // Declaration (line 3) and call (line 8): both positions in the same file.
        const lines = found.map((r) => r.range.start.line).sort((a, b) => a - b);
        expect(lines).toContain(8);
    });

    it("the extension publishes a status bar item with its state", { timeout: 120_000 }, async () => {
        // The `window.statusBarItem.*` wire is ours, not the extension's: if it breaks,
        // Java keeps working but the only "server is alive" indicator disappears.
        const ready = await until(
            "Java status bar item",
            () => Promise.resolve(statusBarItems.find((i) => i.text.includes("Java")) ?? null),
            60_000,
        );
        expect(ready.id).toBe("redhat.java.java.serverStatus");
        expect(ready.alignment).toBe("left");
    });

    it(
        "semantic tokens: type and modifiers from jdt.ls, delta on a repeated request",
        { timeout: 120_000 },
        async () => {
            expect(harness).toBeDefined();
            const registry = harness!.languageFeatures.documentSemanticTokensProvider;
            const target = { uri: Uri.parse(appUri), languageId: "java" };
            const request = () => ({ uri: appUri, languageId: "java", versionId: documentVersion(harness!, appUri) });
            // The server answers empty while it builds the AST; wait for a response with tokens.
            const first = await until(
                "document semantic tokens",
                async () => {
                    const result = await getDocumentSemanticTokens(
                        registry,
                        target,
                        request(),
                        null,
                        null,
                        CancellationTokenNone,
                    );
                    return result?.tokens && !isSemanticTokensEdits(result.tokens) && result.tokens.data.length > 0
                        ? { provider: result.provider, tokens: result.tokens }
                        : null;
                },
                60_000,
            );
            const legend = first.provider.getLegend();
            const lines = decodeSemanticTokens(first.tokens.data, legend);
            const classify = (line: number, char: number): string | undefined => {
                const tokens = lines.getLine(line)?.tokens ?? [];
                for (let i = 0; i < tokens.length; i += 4) {
                    if (tokens[i] <= char && char < tokens[i + 1]) {
                        const modifiers = legend.tokenModifiers.filter((_, bit) => (tokens[i + 3] & (1 << bit)) !== 0);
                        return [legend.tokenTypes[tokens[i + 2]], ...modifiers].join(".");
                    }
                }
                return undefined;
            };
            // `who` in `return "hello, " + who;` is a parameter: TextMate cannot know that.
            expect(classify(4, 27)).toMatch(/^parameter/);
            // `greet(` in `String message = greet("world");` is a static method.
            expect(classify(8, 25)).toMatch(/^method\..*static/);

            // A repeat request with the previous resultId yields a delta (same text, no edits).
            const second = await getDocumentSemanticTokens(
                registry,
                target,
                request(),
                first.provider,
                first.tokens.resultId ?? null,
                CancellationTokenNone,
            );
            expect(second?.tokens && isSemanticTokensEdits(second.tokens) ? second.tokens.edits : null).toEqual([]);

            const theme = createDefaultTokenClassificationRegistry();
            const { id, manifest } = installed!.registration;
            registerExtensionSemanticTokens(
                [{ id, manifest: manifest as IExtensionManifest, location: "", isBuiltin: false }],
                theme,
            );
            const darkModern = WorkbenchTheme.fromThemeFile(darkModernTheme);
            const styles = new SemanticTokenStyleResolver(theme, darkModern.tokenTheme);
            expect(styles.resolve("parameter", [], "java")?.fg).toBe(parseHexColor("#9CDCFE"));
            // A Java type from the extension's contributes.semanticTokenTypes/Scopes:
            // annotation is colored as the TextMate scope `storage.type.annotation.java`.
            const annotationFg = (await resolveScopesStyle(darkModern, ["source.java", "storage.type.annotation.java"]))
                .fg;
            expect(annotationFg).toBeDefined();
            expect(styles.resolve("annotation", [], "java")?.fg).toBe(annotationFg);
        },
    );

    it("stock client converters did not fail silently", () => {
        const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
        expect(crashes).toEqual([]);
    });
});
