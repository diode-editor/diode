import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

const JAVA_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".java") ? "java" : undefined),
};

const FIXTURE = extensionFixture("test.providesTextDocumentContent", "providesTextDocumentContent.cjs");

const TARGET = "jdt://contents/lib.jar/pkg/Generated.java";

describe("ExtensionHost — content providers for non-disk resources (subprocess)", () => {
    it("declares a scheme and serves content through a reverse request", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            expect(harness.host.hasTextContentProvider("jdt")).toBe(true);
            expect(harness.host.hasTextContentProvider("class")).toBe(false);

            const content = await harness.host.provideTextDocumentContent(Uri.parse(TARGET));

            expect(content).toContain("public class Generated {}");
            expect(content).toContain(TARGET);
        } finally {
            await harness.dispose();
        }
    });

    it("core openUri opens a read-only tab with the source and the language by file extension", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            await harness.group.openUri(Uri.parse(TARGET));

            const editor = harness.group.getActiveEditor();
            expect(editor?.uri.toString()).toBe(TARGET);
            expect(editor?.getText()).toContain("public class Generated {}");
            expect(editor?.label).toBe("Generated.java");
            expect(editor?.readOnly).toBe(true);
            expect(editor?.viewState.document.languageId).toBe("java");
        } finally {
            await harness.dispose();
        }
    });

    it("the provider's onDidChange rereads the open tab", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            await harness.group.openUri(Uri.parse(TARGET));
            expect(harness.group.getActiveEditor()?.getText()).toContain("// rev 1");

            await harness.commandRegistry.execute("fixture.bumpContent", TARGET);
            // The provider's notification and the repeated content request are two
            // separate round trips of real IPC; microtasks cannot pump them.
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toContain("// rev 2");
        } finally {
            await harness.dispose();
        }
    });

    it("the provider refuses the resource: no tab, the reason is named", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            const failures: string[] = [];
            harness.group.onDidFailOpen(({ reason }) => failures.push(reason));

            await harness.group.openUri(Uri.parse("jdt:///Missing.java"));

            expect(harness.group.editorGroups.activeGroup.editorCount).toBe(0);
            expect(failures).toEqual(['the "jdt:" content provider returned no content']);
        } finally {
            await harness.dispose();
        }
    });

    it("the provider breaks: the refusal arrives as a reason, not as a process crash", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            const failures: string[] = [];
            harness.group.onDidFailOpen(({ reason }) => failures.push(reason));

            await expect(harness.group.openUri(Uri.parse("jdt:///Broken.java"))).resolves.toBeUndefined();

            expect(harness.group.editorGroups.activeGroup.editorCount).toBe(0);
            expect(failures).toHaveLength(1);
            expect(failures[0]).toContain("java/classFileContents failed");
        } finally {
            await harness.dispose();
        }
    });

    it("an extension's openTextDocument on such a scheme asks the provider, not the disk", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            const text = await harness.commandRegistry.execute("fixture.readThroughOpenTextDocument", TARGET);

            expect(text).toContain("public class Generated {}");
        } finally {
            await harness.dispose();
        }
    });

    it("without providers the core cannot open a non-disk resource, and it says so", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: JAVA_LANGUAGE_SERVICE,
        });
        try {
            const failures: string[] = [];
            harness.group.onDidFailOpen(({ reason }) => failures.push(reason));

            expect(harness.host.hasTextContentProvider("jdt")).toBe(false);
            await harness.group.openUri(Uri.parse(TARGET));

            expect(harness.group.editorGroups.activeGroup.editorCount).toBe(0);
            expect(failures).toEqual(['no content provider is registered for the "jdt:" scheme']);
        } finally {
            await harness.dispose();
        }
    });
});
