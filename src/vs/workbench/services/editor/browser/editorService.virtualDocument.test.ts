import { describe, expect, it, vi } from "vitest";

import { createAppTestHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";
import type { IVirtualDocumentSource } from "../common/iVirtualDocumentSource.ts";
import { NULL_VIRTUAL_DOCUMENT_SOURCE } from "../common/iVirtualDocumentSource.ts";

import { EditorService, EditorServiceDIToken } from "./editorService.ts";

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
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

/** Конфиг-стаб: точечные ключи из карты, остальное — как у NULL-сервиса. */
function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, defaultValue?: T): T | undefined {
            return key in values ? (values[key] as T) : defaultValue;
        },
    };
}

/** Лог-сервис, копящий `error`-строки: по ним проверяется, что причина названа. */
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
        options.configurationService ?? NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        options.logService ?? NULL_LOG_SERVICE,
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
        expect(service.getEditors()[0]?.getText()).toBe("public class StringUtils {}\n");
        // Метка — basename «пути» ресурса: у jdt: он честный, с расширением.
        expect(service.getEditors()[0]?.label).toBe("StringUtils.java");
        expect(service.getEditors()[0]?.readOnly).toBe(true);
        expect(service.getEditors()[0]?.viewState.document.languageId).toBe("java");
        service.dispose();
    });

    it("язык неизвестной схеме ресурса — plaintext, а не отказ", async () => {
        const service = createEditorService(JAVA_LANGUAGE_SERVICE);
        service.virtualDocumentSource = makeSource("demo", () => Promise.resolve("hello\n"));

        await service.openUri(Uri.parse("demo:///scratch"));

        expect(service.getEditors()[0]?.viewState.document.languageId).toBe("plaintext");
        service.dispose();
    });

    it("повторное открытие активирует существующую вкладку СИНХРОННО и провайдера не тревожит", async () => {
        const service = createEditorService();
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
        service.virtualDocumentSource = makeSource("demo", provide);
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);
        service.openFile("/tmp/other.txt");
        expect(service.activeGroup.editorCount).toBe(2);

        // Синхронность важна навигации: Go Back открывает ресурс и ТУТ ЖЕ ведёт
        // каретку — между этими двумя шагами тика нет.
        void service.openUri(uri);

        expect(service.activeGroup.activeIndex).toBe(0);
        expect(service.activeGroup.editorCount).toBe(2);
        expect(provide).toHaveBeenCalledTimes(1);
        service.dispose();
    });

    it("нет источника вовсе — сообщение, а не падение", async () => {
        const service = createEditorService();
        const failures: { uri: string; reason: string }[] = [];
        service.onDidFailOpen(({ uri, reason }) => failures.push({ uri: uri.toString(), reason }));

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        expect(service.activeGroup.editorCount).toBe(0);
        expect(failures).toHaveLength(1);
        expect(failures[0].reason).toContain('no content provider is registered for the "jdt:" scheme');
        service.dispose();
    });

    it("провайдер есть, но не для этой схемы — сообщение с её именем", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onDidFailOpen(({ reason }) => failures.push(reason));
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve("x"));

        await service.openUri(Uri.parse("class:///Foo.class"));

        expect(service.activeGroup.editorCount).toBe(0);
        expect(failures).toEqual(['no content provider is registered for the "class:" scheme']);
        service.dispose();
    });

    it("провайдер сломался — причина доходит до человека, процесс живёт", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onDidFailOpen(({ reason }) => failures.push(reason));
        service.virtualDocumentSource = makeSource("jdt", () =>
            Promise.reject(new Error("java/classFileContents timed out")),
        );

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        expect(service.activeGroup.editorCount).toBe(0);
        expect(failures).toEqual(["java/classFileContents timed out"]);
        service.dispose();
    });

    it("провайдер отклонился не-Error значением — причина всё равно читаемая", async () => {
        const service = createEditorService();
        const failures: string[] = [];
        service.onDidFailOpen(({ reason }) => failures.push(reason));
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
        service.onDidFailOpen(({ reason }) => failures.push(reason));
        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve(null));

        await service.openUri(Uri.parse("jdt:///Foo.java"));

        expect(service.activeGroup.editorCount).toBe(0);
        expect(failures).toEqual(['the "jdt:" content provider returned no content']);
        service.dispose();
    });

    it("без подписчика onDidFailOpen неудача всё равно не бросает", async () => {
        const service = createEditorService();

        await expect(service.openUri(Uri.parse("jdt:///Foo.java"))).resolves.toBeUndefined();

        service.dispose();
    });

    it("file: открывается СИНХРОННО — обещание можно игнорировать", () => {
        const service = createEditorService();

        void service.openUri(Uri.file("/tmp/sync.txt"));

        // Ни одного await: вкладка обязана быть уже здесь, иначе сломались бы
        // все сайты, которые открывают файл и сразу двигают каретку.
        expect(service.activeGroup.editorCount).toBe(1);
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
    it("к вкладке применяются editor.*-настройки — она полноценный редактор, а не превью", async () => {
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

    it("причина отказа уходит в лог с ресурсом целиком", async () => {
        const logged: string[] = [];
        const service = createEditorService(NULL_LANGUAGE_SERVICE, { logService: recordingLogService(logged) });

        await service.openUri(Uri.parse("jdt:///Foo.java"));

        expect(logged).toEqual(['cannot open jdt:/Foo.java: no content provider is registered for the "jdt:" scheme']);
        service.dispose();
    });

    it("beside: уже открытый там ресурс переиспользуется, а не запрашивается заново", async () => {
        const service = createEditorService();
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
        service.virtualDocumentSource = makeSource("demo", provide);
        const uri = Uri.parse("demo:///a");
        service.openFile("/tmp/left.txt");
        await service.openUri(uri, { group: "beside" });
        expect(service.groups.length).toBe(2);
        // Возвращаемся в левую группу: «соседняя справа» для неё — та, где
        // ресурс уже открыт.
        service.focusGroup({ index: 0 });

        await service.openUri(uri, { group: "beside" });

        // Третьей группы нет, вкладка одна, провайдера дёрнули ровно раз:
        // «соседняя справа» ищется без побочных эффектов.
        expect(service.groups.length).toBe(2);
        expect(service.groups[1].editorCount).toBe(1);
        expect(provide).toHaveBeenCalledTimes(1);
        service.dispose();
    });

    it("beside ищет соседа СПРАВА: тот же ресурс слева повторного открытия не отменяет", async () => {
        const service = createEditorService();
        const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
        service.virtualDocumentSource = makeSource("demo", provide);
        const uri = Uri.parse("demo:///a");
        await service.openUri(uri);

        await service.openUri(uri, { group: "beside" });

        // Ресурс открыт в ЛЕВОЙ группе; справа его нет — значит открываем там свою
        // вкладку, а не «уже открыто, ничего не делаем».
        expect(service.groups.length).toBe(2);
        expect(service.groups[1].editorCount).toBe(1);
        expect(provide).toHaveBeenCalledTimes(2);
        service.dispose();
    });
});

describe("EditorService.canRestore — что история умеет открыть заново", () => {
    it("диск и безымянный буфер — всегда", () => {
        const service = createEditorService();

        expect(service.canRestore(Uri.file("/tmp/a.ts"))).toBe(true);
        expect(service.canRestore(Uri.from({ scheme: "untitled", path: "Untitled-1" }))).toBe(true);
        service.dispose();
    });

    it("недисковый — только пока его схему обслуживает провайдер", () => {
        const service = createEditorService();
        const jdt = Uri.parse("jdt:///Foo.java");

        // Источника нет вовсе.
        expect(service.canRestore(jdt)).toBe(false);

        service.virtualDocumentSource = makeSource("jdt", () => Promise.resolve("x"));
        expect(service.canRestore(jdt)).toBe(true);
        // Чужая схема — нет: Output пишет владелец панели, ресурс его не адресует.
        expect(service.canRestore(Uri.parse("output:extensions"))).toBe(false);
        service.dispose();
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

            expect(service.getEditors()[0]?.getText()).toBe("v2\n");
            service.dispose();
        });

        it("освежается ТОЛЬКО вкладка этого ресурса — соседние не трогаем", async () => {
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
            // Файловая вкладка рядом — не цель освежения, и освежение не споткнулось о неё.
            expect(errors).toEqual([]);
            service.dispose();
        });

        it("отказ освежения называет ресурс и причину в логе", async () => {
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

        it("ресурс не открыт — вкладку по событию провайдера не заводим", async () => {
            const service = createEditorService();
            const provide = vi.fn<(uri: Uri) => Promise<string | null>>().mockResolvedValue("x\n");
            service.virtualDocumentSource = makeSource("demo", provide);

            service.refreshVirtualDocument(Uri.parse("demo:///never-opened"));
            await Promise.resolve();

            expect(service.activeGroup.editorCount).toBe(0);
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

            expect(service.getEditors()[0]?.getText()).toBe("v1\n");
            service.dispose();
        });

        it("источник сняли (умер extension host) — освежать нечем, вкладка цела", async () => {
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

        it("провайдер отказался отдать содержимое (null) — вкладка прежняя, и это не ошибка", async () => {
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
            // «Нечего освежать» — штатный ответ провайдера, а не сбой: в лог
            // ничего не уходит (иначе `null` доехал бы до заливки текста).
            expect(logged).toEqual([]);
            service.dispose();
        });
    });
});

describe("EditorService.openUri — фокус при открытии недискового ресурса", () => {
    it("focus: false не уводит фокус из текущего редактора", async () => {
        const ws = createTempWorkspace({ prefix: "diode-virtual-focus-" });
        const h = createAppTestHarness({ workspaceFolder: ws.dir });
        try {
            const editors = h.container.get(EditorServiceDIToken);
            editors.virtualDocumentSource = makeSource("demo", () => Promise.resolve("virtual\n"));
            h.workbench.openFile(ws.writeFile("a.ts", "const a = 1;\n"));
            h.workbench.focusEditor();
            expect(h.testApp.focusedElement).not.toBeNull();

            await editors.openUri(Uri.parse("demo:///a"), { focus: false });

            // Вкладка открыта и активна, но фокус в неё НЕ уехал — на этом
            // держится `preserveFocus` у `showTextDocument`. Прежний редактор
            // при смене вкладки уходит из дерева, поэтому «фокус не взяли»
            // видно как отсутствие сфокусированного элемента вовсе.
            expect(editors.activeGroup.editorCount).toBe(2);
            expect(editors.getActiveTabPane()?.uri.scheme).toBe("demo");
            expect(h.testApp.focusedElement).toBeNull();
        } finally {
            h.dispose();
            ws.dispose();
        }
    });

    it("по умолчанию фокус уходит в открытую вкладку", async () => {
        const ws = createTempWorkspace({ prefix: "diode-virtual-focus-" });
        const h = createAppTestHarness({ workspaceFolder: ws.dir });
        try {
            const editors = h.container.get(EditorServiceDIToken);
            editors.virtualDocumentSource = makeSource("demo", () => Promise.resolve("virtual\n"));
            h.workbench.openFile(ws.writeFile("a.ts", "const a = 1;\n"));
            h.workbench.focusEditor();

            await editors.openUri(Uri.parse("demo:///a"));

            // Фокус в новой вкладке — это её собственный EditorElement
            // (у прежней он из дерева уже ушёл).
            expect(h.testApp.focusedElement).toBe(h.testApp.querySelector("EditorElement"));
            expect(editors.getActiveTabPane()?.uri.scheme).toBe("demo");
        } finally {
            h.dispose();
            ws.dispose();
        }
    });
});
