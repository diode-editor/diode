import { describe, expect, it, vi } from "vitest";

import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";
import type { IVirtualDocumentSource } from "../common/iVirtualDocumentSource.ts";

import { EditorService } from "./editorService.ts";

/**
 * Недисковые ресурсы в {@link EditorService.openUri}: Go to Definition в
 * библиотеку (`jdt:` у стокового redhat.java), `git:`-ревизия, любая схема с
 * `registerTextDocumentContentProvider`.
 *
 * Главное здесь — то, ради чего всё и делалось: **ни один исход не убивает
 * процесс**. До этого не-file uri доезжал до `TextFileModel.openFile`, тот
 * бросал, отказ команды никто не ловил, и Node клал редактор целиком.
 */

/** Язык по расширению — ровно то, что нужно для `…/StringUtils.java`. */
const JAVA_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".java") ? "java" : undefined),
    getLanguageDisplayName: () => undefined,
    getExtensionForLanguage: () => undefined,
};

function createEditorService(languages: ILanguageService = NULL_LANGUAGE_SERVICE): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        languages,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
}

/** Источник-фейк: одна схема, содержимое по замыканию. */
function makeSource(scheme: string, provide: (uri: Uri) => Promise<string | null>): IVirtualDocumentSource {
    return { canProvide: (s) => s === scheme, provide };
}

/**
 * Настоящая цель jdt.ls: огромный query с процентным кодированием. Записана
 * ровно в том виде, в каком приходит от сервера, — нормализацию `Uri` проверяем
 * на ней, а не на причёсанной строке.
 */
const JDT_URI_RAW =
    "jdt://contents/commons-lang3-3.14.0.jar/org.apache.commons.lang3/StringUtils.java" +
    "?=mvn-proj/%5C/home%5C/vscode%5C/.m2%5C/repository%3D/maven.pomderived=/true";

describe("EditorService.openUri — недисковые ресурсы", () => {
    it("открывает read-only вкладку с содержимым провайдера, языком и меткой из ресурса", async () => {
        const service = createEditorService(JAVA_LANGUAGE_SERVICE);
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve("public class StringUtils {}\n"));

        await service.openUri(Uri.parse(JDT_URI_RAW));

        const pane = service.getActiveTabPane();
        expect(pane?.uri.toString()).toBe(Uri.parse(JDT_URI_RAW).toString());
        expect(service.getEditor(0)?.getText()).toBe("public class StringUtils {}\n");
        // Метка — basename «пути» ресурса: у jdt: он честный, с расширением.
        expect(service.getEditor(0)?.label).toBe("StringUtils.java");
        expect(service.getEditor(0)?.readOnly).toBe(true);
        expect(service.getEditor(0)?.viewState.document.languageId).toBe("java");
        service.dispose();
    });

    it("язык неизвестной схеме ресурса — plaintext, а не отказ", async () => {
        const service = createEditorService(JAVA_LANGUAGE_SERVICE);
        service.virtualDocumentSource = makeSource("demo", () => Promise.resolve("hello\n"));

        await service.openUri(Uri.parse("demo:///scratch"));

        expect(service.getEditor(0)?.viewState.document.languageId).toBe("plaintext");
        service.dispose();
    });

    it("повторное открытие активирует существующую вкладку СИНХРОННО и провайдера не тревожит", async () => {
        const service = createEditorService();
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
        service.virtualDocumentSource = makeSource("demo", provide);
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);
        service.openFile("/tmp/other.txt");
        expect(service.editorCount).toBe(2);

        // Синхронность важна навигации: Go Back открывает ресурс и ТУТ ЖЕ ведёт
        // каретку — между этими двумя шагами тика нет.
        void service.openUri(uri);

        expect(service.activeIndex).toBe(0);
        expect(service.editorCount).toBe(2);
        expect(provide).toHaveBeenCalledTimes(1);
        service.dispose();
    });

    it("нет источника вовсе — сообщение, а не падение", async () => {
        const service = createEditorService();
        const failures: { uri: string; reason: string }[] = [];
        service.onOpenFailed = (uri, reason) => failures.push({ uri: uri.toString(), reason });

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        expect(service.editorCount).toBe(0);
        expect(failures).toHaveLength(1);
        expect(failures[0].reason).toContain('no content provider is registered for the "jdt:" scheme');
        service.dispose();
    });

    it("провайдер есть, но не для этой схемы — сообщение с её именем", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onOpenFailed = (_uri, reason) => failures.push(reason);
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve("x"));

        await service.openUri(Uri.parse("class:///Foo.class"));

        expect(service.editorCount).toBe(0);
        expect(failures).toEqual(['no content provider is registered for the "class:" scheme']);
        service.dispose();
    });

    it("провайдер сломался — причина доходит до человека, процесс живёт", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onOpenFailed = (_uri, reason) => failures.push(reason);
        service.virtualDocumentSource = makeSource("jdt", () =>
            Promise.reject(new Error("java/classFileContents timed out")),
        );

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        expect(service.editorCount).toBe(0);
        expect(failures).toEqual(["java/classFileContents timed out"]);
        service.dispose();
    });

    it("провайдер отклонился не-Error значением — причина всё равно читаемая", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onOpenFailed = (_uri, reason) => failures.push(reason);
        // Провайдер — чужой код: отклониться он может чем угодно, не только Error.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        service.virtualDocumentSource = makeSource("jdt", () => Promise.reject("server is shutting down"));

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        expect(failures).toEqual(["server is shutting down"]);
        service.dispose();
    });

    it("провайдер отказался отдать ресурс (null) — вкладки нет, сообщение есть", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onOpenFailed = (_uri, reason) => failures.push(reason);
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve(null));

        await service.openUri(Uri.parse("jdt:///Foo.java"));

        expect(service.editorCount).toBe(0);
        expect(failures).toEqual(['the "jdt:" content provider returned no content']);
        service.dispose();
    });

    it("без хука onOpenFailed неудача всё равно не бросает", async () => {
        const service = createEditorService();

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        service.dispose();
    });

    it("file: открывается СИНХРОННО — обещание можно игнорировать", () => {
        const service = createEditorService();

        void service.openUri(Uri.file("/tmp/sync.txt"));

        // Ни одного await: вкладка обязана быть уже здесь, иначе сломались бы
        // все сайты, которые открывают файл и сразу двигают каретку.
        expect(service.editorCount).toBe(1);
        service.dispose();
    });

    it("beside-группа не создаётся, когда открывать нечем", async () => {
        const service = createEditorService();
        service.openFile("/tmp/a.txt");

        await service.openUri(Uri.parse("jdt:///Foo.java"), { group: "beside" });

        // Пустая группа справа — худший исход неудачи: человек получил бы
        // перекроенный экран вместо сообщения.
        expect(service.groups.length).toBe(1);
        service.dispose();
    });
});

describe("EditorService.refreshVirtualDocument", () => {
    it("перечитывает открытую вкладку по onDidChange провайдера", async () => {
        const service = createEditorService();
        let content = "v1\n";
        service.virtualDocumentSource = makeSource("demo", () => Promise.resolve(content));
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);

        content = "v2\n";
        service.refreshVirtualDocument(uri);
        await Promise.resolve();
        await Promise.resolve();

        expect(service.getEditor(0)?.getText()).toBe("v2\n");
        service.dispose();
    });

    it("ресурс не открыт — вкладку по событию провайдера не заводим", async () => {
        const service = createEditorService();
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
        service.virtualDocumentSource = makeSource("demo", provide);

        service.refreshVirtualDocument(Uri.parse("demo:///never-opened"));
        await Promise.resolve();

        expect(service.editorCount).toBe(0);
        expect(provide).not.toHaveBeenCalled();
        service.dispose();
    });

    it("отказ провайдера при освежении не бросает и не стирает содержимое", async () => {
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

        expect(service.getEditor(0)?.getText()).toBe("v1\n");
        service.dispose();
    });

    it("источника нет — освежать нечем, молча выходим", async () => {
        const service = createEditorService();
        service.virtualDocumentSource = makeSource("demo", () => Promise.resolve("v1\n"));
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);
        service.virtualDocumentSource = undefined;

        expect(() => {
            service.refreshVirtualDocument(uri);
        }).not.toThrow();
        expect(service.getEditor(0)?.getText()).toBe("v1\n");
        service.dispose();
    });

    it("провайдер отказался отдать содержимое (null) — вкладка остаётся прежней", async () => {
        const service = createEditorService();
        let content: string | null = "v1\n";
        service.virtualDocumentSource = makeSource("demo", () => Promise.resolve(content));
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);

        content = null;
        service.refreshVirtualDocument(uri);
        await Promise.resolve();
        await Promise.resolve();

        expect(service.getEditor(0)?.getText()).toBe("v1\n");
        service.dispose();
    });
});
