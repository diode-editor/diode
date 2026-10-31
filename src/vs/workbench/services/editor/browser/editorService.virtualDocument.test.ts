import { describe, expect, it, vi } from "vitest";

import { createAppTestHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";
import { EditorServiceDIToken } from "../common/editorService.ts";
import type { IVirtualDocumentSource } from "../common/iVirtualDocumentSource.ts";
import { NULL_VIRTUAL_DOCUMENT_SOURCE } from "../common/iVirtualDocumentSource.ts";

import { EditorService } from "./editorService.ts";

/**
 * The point: no outcome kills the process. A non-file uri used to reach `TextFileModel.openFile`,
 * which threw; nobody caught the command rejection, and Node took down the whole editor.
 */

const JAVA_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".java") ? "java" : undefined),
    getLanguageDisplayName: () => undefined,
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => undefined,
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return createTestConfigurationService(values);
}

function recordingLogService(sink: string[]): ILogService {
    return {
        ...NULL_LOG_SERVICE,
        createLogger: () => ({
            trace: () => undefined,
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: (message: string) => sink.push(message),
            isEnabled: () => true,
        }),
    };
}

function createEditorService(
    languages: ILanguageService = NULL_LANGUAGE_SERVICE,
    options: { configurationService?: IConfigurationService; logService?: ILogService } = {},
): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        languages,
        options.configurationService ?? createTestConfigurationService(),
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        options.logService ?? NULL_LOG_SERVICE,
    );
}

function makeSource(scheme: string, provide: (uri: Uri) => Promise<string | null>): IVirtualDocumentSource {
    return { canProvide: (s) => s === scheme, provide };
}

/** Exactly as jdt.ls sends it: `Uri` normalization is tested on this, not on a tidied-up string. */
const JDT_URI_RAW =
    "jdt://contents/commons-lang3-3.14.0.jar/org.apache.commons.lang3/StringUtils.java" +
    "?=mvn-proj/%5C/home%5C/vscode%5C/.m2%5C/repository%3D/maven.pomderived=/true";

describe("EditorService.openUri — non-disk resources", () => {
    it("opens a read-only tab with the provider's content and a language and label from the resource", async () => {
        const service = createEditorService(JAVA_LANGUAGE_SERVICE);
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve("public class StringUtils {}\n"));

        await service.openUri(Uri.parse(JDT_URI_RAW));

        const pane = service.getActiveTabPane();
        expect(pane?.uri.toString()).toBe(Uri.parse(JDT_URI_RAW).toString());
        expect(service.getEditors()[0]?.getText()).toBe("public class StringUtils {}\n");
        expect(service.getEditors()[0]?.label).toBe("StringUtils.java");
        expect(service.getEditors()[0]?.readOnly).toBe(true);
        expect(service.getEditors()[0]?.viewState.document.languageId).toBe("java");
        service.dispose();
    });

    it("the language for an unknown resource scheme is plaintext, not a failure", async () => {
        const service = createEditorService(JAVA_LANGUAGE_SERVICE);
        service.virtualDocumentSource = makeSource("demo", () => Promise.resolve("hello\n"));

        await service.openUri(Uri.parse("demo:///scratch"));

        expect(service.getEditors()[0]?.viewState.document.languageId).toBe("plaintext");
        service.dispose();
    });

    it("reopening activates the existing tab SYNCHRONOUSLY and does not call the provider", async () => {
        const service = createEditorService();
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
        service.virtualDocumentSource = makeSource("demo", provide);
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);
        service.openFile("/tmp/other.txt");
        expect(service.editorGroups.activeGroup.editorCount).toBe(2);

        // Go Back opens the resource and moves the cursor right away, with no tick in between.
        void service.openUri(uri);

        expect(service.editorGroups.activeGroup.activeIndex).toBe(0);
        expect(service.editorGroups.activeGroup.editorCount).toBe(2);
        expect(provide).toHaveBeenCalledTimes(1);
        service.dispose();
    });

    it("a tab of the resource in another group is not reused: the new group asks the provider itself", async () => {
        const service = createEditorService();
        const provide = vi
            .fn<(uri: Uri) => Promise<string | null>>()
            .mockResolvedValueOnce("first\n")
            .mockResolvedValueOnce("second\n");
        service.virtualDocumentSource = makeSource("demo", provide);
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);
        const firstGroup = service.editorGroups.activeGroup;

        const secondGroup = service.editorGroups.newGroup("after");
        if (secondGroup === null) throw new Error("no second group");
        await service.openUri(uri, { group: secondGroup });

        expect(provide).toHaveBeenCalledTimes(2);
        expect(secondGroup).not.toBe(firstGroup);
        expect(service.getEditors().map((editor) => editor.getText())).toEqual(["first\n", "second\n"]);
        service.dispose();
    });

    it("no source at all: a message, not a crash", async () => {
        const service = createEditorService();
        const failures: { uri: string; reason: string }[] = [];
        service.onDidFailOpen(({ uri, reason }) => failures.push({ uri: uri.toString(), reason }));

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        expect(failures).toHaveLength(1);
        expect(failures[0].reason).toContain('no content provider is registered for the "jdt:" scheme');
        service.dispose();
    });

    it("a provider exists but not for this scheme: a message naming it", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onDidFailOpen(({ reason }) => failures.push(reason));
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve("x"));

        await service.openUri(Uri.parse("class:///Foo.class"));

        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        expect(failures).toEqual(['no content provider is registered for the "class:" scheme']);
        service.dispose();
    });

    it("the provider fails: the reason reaches the user, the process survives", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onDidFailOpen(({ reason }) => failures.push(reason));
        service.virtualDocumentSource = makeSource("jdt", () =>
            Promise.reject(new Error("java/classFileContents timed out")),
        );

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        expect(failures).toEqual(["java/classFileContents timed out"]);
        service.dispose();
    });

    it("the provider rejects with a non-Error value: the reason is still readable", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onDidFailOpen(({ reason }) => failures.push(reason));
        // A provider is foreign code: it may reject with anything, not only an Error.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        service.virtualDocumentSource = makeSource("jdt", () => Promise.reject("server is shutting down"));

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        expect(failures).toEqual(["server is shutting down"]);
        service.dispose();
    });

    it("the provider declines the resource (null): no tab, a message", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onDidFailOpen(({ reason }) => failures.push(reason));
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve(null));

        await service.openUri(Uri.parse("jdt:///Foo.java"));

        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        expect(failures).toEqual(['the "jdt:" content provider returned no content']);
        service.dispose();
    });

    it("without an onDidFailOpen subscriber a failure still does not throw", async () => {
        const service = createEditorService();

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        service.dispose();
    });

    it("file: opens SYNCHRONOUSLY, the promise can be ignored", () => {
        const service = createEditorService();

        void service.openUri(Uri.file("/tmp/sync.txt"));

        // No await at all: call sites that open a file and immediately move the cursor would break otherwise.
        expect(service.editorGroups.activeGroup.editorCount).toBe(1);
        service.dispose();
    });

    it("the beside group is not created when there is nothing to open", async () => {
        const service = createEditorService();
        service.openFile("/tmp/a.txt");

        await service.openUri(Uri.parse("jdt:///Foo.java"), { group: "beside" });

        // An empty group on the right is the worst outcome: a rearranged screen instead of a message.
        expect(service.editorGroups.groups.length).toBe(1);
        service.dispose();
    });
    it("editor.* settings apply to the tab: it is a full editor, not a preview", async () => {
        const service = createEditorService(NULL_LANGUAGE_SERVICE, {
            configurationService: stubConfigurationService({
                "editor.wordWrap": "bounded",
                "editor.wordWrapColumn": 40,
                "editor.cursorSurroundingLines": 5,
            }),
        });
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve("class Foo {}\n"));

        await service.openUri(Uri.parse("jdt:///Foo.java"));

        const viewState = service.getEditors()[0].viewState;
        expect(viewState.wordWrap).toBe("bounded");
        expect(viewState.wordWrapColumn).toBe(40);
        expect(viewState.cursorSurroundingLines).toBe(5);
        service.dispose();
    });

    it("the failure reason is logged with the full resource", async () => {
        const logged: string[] = [];
        const service = createEditorService(NULL_LANGUAGE_SERVICE, { logService: recordingLogService(logged) });

        await service.openUri(Uri.parse("jdt:///Foo.java"));

        expect(logged).toEqual(['cannot open jdt:/Foo.java: no content provider is registered for the "jdt:" scheme']);
        service.dispose();
    });

    it("beside: a resource already open there is reused, not requested again", async () => {
        const service = createEditorService();
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
        service.virtualDocumentSource = makeSource("demo", provide);
        const uri = Uri.parse("demo:///a");
        service.openFile("/tmp/left.txt");
        await service.openUri(uri, { group: "beside" });
        expect(service.editorGroups.groups.length).toBe(2);
        // Back to the left group: its "right neighbor" is the one where
        // the resource is already open.
        service.editorGroups.focusGroup({ index: 0 });

        await service.openUri(uri, { group: "beside" });

        // The "right neighbor" lookup has no side effects.
        expect(service.editorGroups.groups.length).toBe(2);
        expect(service.editorGroups.groups[1].editorCount).toBe(1);
        expect(provide).toHaveBeenCalledTimes(1);
        service.dispose();
    });

    it("beside looks for the neighbour on the RIGHT: the same resource on the left does not prevent reopening", async () => {
        const service = createEditorService();
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
        service.virtualDocumentSource = makeSource("demo", provide);
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);

        await service.openUri(uri, { group: "beside" });

        // The resource isn't open on the right: open our own tab there, not "already open".
        expect(service.editorGroups.groups.length).toBe(2);
        expect(service.editorGroups.groups[1].editorCount).toBe(1);
        expect(provide).toHaveBeenCalledTimes(2);
        service.dispose();
    });
});

describe("EditorService.canRestore — what history can reopen", () => {
    it("disk and untitled buffer: always", () => {
        const service = createEditorService();

        expect(service.canRestore(Uri.file("/tmp/a.ts"))).toBe(true);
        expect(service.canRestore(Uri.from({ scheme: "untitled", path: "Untitled-1" }))).toBe(true);
        service.dispose();
    });

    it("non-disk: only while a provider serves its scheme", () => {
        const service = createEditorService();
        const jdt = Uri.parse("jdt:///Foo.java");

        expect(service.canRestore(jdt)).toBe(false);

        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve("x"));
        expect(service.canRestore(jdt)).toBe(true);
        // A foreign scheme is not: the pane owner writes Output, the resource doesn't address it.
        expect(service.canRestore(Uri.parse("output:extensions"))).toBe(false);
        service.dispose();
    });

    describe("EditorService.refreshVirtualDocument", () => {
        it("rereads the open tab on the provider's onDidChange", async () => {
            const service = createEditorService();
            let content = "v1\n";
            service.virtualDocumentSource = makeSource("demo", () => Promise.resolve(content));
            const uri = Uri.parse("demo:///a");
            await service.openUri(uri);

            content = "v2\n";
            service.refreshVirtualDocument(uri);
            await Promise.resolve();
            await Promise.resolve();

            expect(service.getEditors()[0]?.getText()).toBe("v2\n");
            service.dispose();
        });

        it("ONLY this resource's tab is refreshed, neighbours are left alone", async () => {
            const errors: string[] = [];
            const service = createEditorService(NULL_LANGUAGE_SERVICE, { logService: recordingLogService(errors) });
            const contents = new Map<string, string>([
                ["demo:/a", "a v1\n"],
                ["demo:/b", "b v1\n"],
            ]);
            service.virtualDocumentSource = makeSource("demo", (uri) =>
                Promise.resolve(contents.get(uri.toString()) ?? null),
            );
            const a = Uri.parse("demo:///a");
            await service.openUri(a);
            await service.openUri(Uri.parse("demo:///b"));
            service.openFile("/tmp/file.txt");

            contents.set("demo:/a", "a v2\n");
            contents.set("demo:/b", "b v2\n");
            service.refreshVirtualDocument(a);
            await Promise.resolve();
            await Promise.resolve();

            expect(service.getEditors()[0]?.getText()).toBe("a v2\n");
            expect(service.getEditors()[1]?.getText()).toBe("b v1\n");
            expect(errors).toEqual([]);
            service.dispose();
        });

        it("a refresh failure logs the resource and the reason", async () => {
            const logged: string[] = [];
            const service = createEditorService(NULL_LANGUAGE_SERVICE, { logService: recordingLogService(logged) });
            let fail = false;
            service.virtualDocumentSource = makeSource("demo", () =>
                fail ? Promise.reject(new Error("gone")) : Promise.resolve("v1\n"),
            );
            const uri = Uri.parse("demo:///a");
            await service.openUri(uri);
            logged.length = 0;

            fail = true;
            service.refreshVirtualDocument(uri);
            await Promise.resolve();
            await Promise.resolve();

            expect(logged).toEqual(["cannot refresh demo:/a: gone"]);
            service.dispose();
        });

        it("resource not open: the provider event does not create a tab", async () => {
            const service = createEditorService();
            const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
            service.virtualDocumentSource = makeSource("demo", provide);

            service.refreshVirtualDocument(Uri.parse("demo:///never-opened"));
            await Promise.resolve();

            expect(service.editorGroups.activeGroup.editorCount).toBe(0);
            expect(provide).not.toHaveBeenCalled();
            service.dispose();
        });

        it("a provider failure on refresh does not throw or wipe the content", async () => {
            const service = createEditorService();
            let fail = false;
            service.virtualDocumentSource = makeSource("demo", () =>
                fail ? Promise.reject(new Error("gone")) : Promise.resolve("v1\n"),
            );
            const uri = Uri.parse("demo:///a");
            await service.openUri(uri);

            fail = true;
            service.refreshVirtualDocument(uri);
            await Promise.resolve();
            await Promise.resolve();

            expect(service.getEditors()[0]?.getText()).toBe("v1\n");
            service.dispose();
        });

        it("the source is removed (extension host died): nothing to refresh, the tab is intact", async () => {
            const service = createEditorService();
            service.virtualDocumentSource = makeSource("demo", () => Promise.resolve("v1\n"));
            const uri = Uri.parse("demo:///a");
            await service.openUri(uri);
            service.virtualDocumentSource = NULL_VIRTUAL_DOCUMENT_SOURCE;

            expect(() => {
                service.refreshVirtualDocument(uri);
            }).not.toThrow();
            await Promise.resolve();
            await Promise.resolve();

            expect(service.getEditors()[0]?.getText()).toBe("v1\n");
            service.dispose();
        });

        it("the provider declines the content (null): the tab is unchanged and this is not an error", async () => {
            const logged: string[] = [];
            const service = createEditorService(NULL_LANGUAGE_SERVICE, { logService: recordingLogService(logged) });
            let content: string | null = "v1\n";
            service.virtualDocumentSource = makeSource("demo", () => Promise.resolve(content));
            const uri = Uri.parse("demo:///a");
            await service.openUri(uri);
            logged.length = 0;

            content = null;
            service.refreshVirtualDocument(uri);
            await Promise.resolve();
            await Promise.resolve();

            expect(service.getEditors()[0]?.getText()).toBe("v1\n");
            // `null` is a regular provider answer, not a failure: nothing goes to the log.
            expect(logged).toEqual([]);
            service.dispose();
        });
    });
});

describe("EditorService.openUri — focus when opening a non-disk resource", () => {
    it("focus: false keeps focus in the current editor", async () => {
        const ws = createTempWorkspace({ prefix: "diode-virtual-focus-" });
        const h = createAppTestHarness({ workspaceFolder: ws.dir });
        try {
            const editors = h.container.get(EditorServiceDIToken);
            editors.virtualDocumentSource = makeSource("demo", () => Promise.resolve("virtual\n"));
            h.workbench.openFile(ws.writeFile("a.ts", "const a = 1;\n"));
            h.workbench.focusEditor();
            expect(h.testApp.focusedElement).not.toBeNull();

            await editors.openUri(Uri.parse("demo:///a"), { focus: false });

            // `showTextDocument`'s `preserveFocus` relies on this: the previous editor left the tree,
            // so "focus not taken" shows up as no focused element.
            expect(editors.editorGroups.activeGroup.editorCount).toBe(2);
            expect(editors.getActiveTabPane()?.uri.scheme).toBe("demo");
            expect(h.testApp.focusedElement).toBeNull();
        } finally {
            h.dispose();
            ws.dispose();
        }
    });

    it("by default focus moves to the opened tab", async () => {
        const ws = createTempWorkspace({ prefix: "diode-virtual-focus-" });
        const h = createAppTestHarness({ workspaceFolder: ws.dir });
        try {
            const editors = h.container.get(EditorServiceDIToken);
            editors.virtualDocumentSource = makeSource("demo", () => Promise.resolve("virtual\n"));
            h.workbench.openFile(ws.writeFile("a.ts", "const a = 1;\n"));
            h.workbench.focusEditor();

            await editors.openUri(Uri.parse("demo:///a"));

            expect(h.testApp.focusedElement).toBe(h.testApp.querySelector("EditorElement"));
            expect(editors.getActiveTabPane()?.uri.scheme).toBe("demo");
        } finally {
            h.dispose();
            ws.dispose();
        }
    });
});
