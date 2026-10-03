import type { IDisposable } from "@tuidom/core/common/disposable";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import type { IOpenEditorsSource } from "./openEditorsQuickAccessProvider.ts";
import { OpenEditorsQuickAccessProvider } from "./openEditorsQuickAccessProvider.ts";

const ROOT = "/repo";

/** Минимальная вкладка: пикеру нужны ресурс, метка и маркер правок. */
function makePane(
    uriPath: string,
    { modified = false, label }: { modified?: boolean; label?: string } = {},
): IEditorPane {
    return {
        uri: Uri.file(uriPath),
        label: label ?? uriPath.split("/").pop() ?? uriPath,
        view: {} as TUIElement,
        isModified: modified,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState: (): IDisposable => ({ dispose: () => undefined }),
        focusEditor: () => undefined,
        dispose: () => undefined,
    };
}

/** Безымянный буфер: схема не `file`, пути на диске нет. */
function makeUntitledPane(name: string): IEditorPane {
    return { ...makePane(`/${name}`), uri: Uri.parse(`untitled:${name}`), label: name };
}

interface Harness {
    provider: OpenEditorsQuickAccessProvider;
    revealed: IEditorPane[];
}

function createProvider(panes: IEditorPane[], root: string | null = ROOT): Harness {
    const revealed: IEditorPane[] = [];
    const editors: IOpenEditorsSource = {
        getOpenEditorsMru: () => panes,
        displayName: (editor) => editor.label,
        revealPane: (editor) => revealed.push(editor),
    };
    // Настоящий WorkspaceContextService: пикер спрашивает у него папку по uri
    // вкладки, и заглушка проверяла бы свой префикс-матч, а не его.
    const workspace = new WorkspaceContextService();
    if (root !== null) workspace.setWorkspaceFolder(root);
    return { provider: new OpenEditorsQuickAccessProvider(editors, workspace), revealed };
}

/** Запрос целиком, как его отдаёт реестр: провайдер сам срезает префикс. */
function query(filter: string): string {
    return OpenEditorsQuickAccessProvider.PREFIX + filter;
}

describe("OpenEditorsQuickAccessProvider — список и порядок", () => {
    it("префикс — «edt » с пробелом, как у vscode", () => {
        expect(OpenEditorsQuickAccessProvider.PREFIX).toBe("edt ");
    });

    it("плейсхолдер — заголовок пикера открытых редакторов", () => {
        const { provider } = createProvider([]);
        expect(provider.getPlaceholder()).toBe("Show All Opened Editors");
    });

    it("пустой запрос отдаёт все вкладки в MRU-порядке источника", () => {
        const { provider } = createProvider([
            makePane(`${ROOT}/src/index.ts`),
            makePane(`${ROOT}/readme.md`),
            makePane(`${ROOT}/src/vs/editor/core.ts`),
        ]);

        const items = provider.getItems(query(""));

        expect(items.map((item) => item.label)).toEqual(["index.ts", "readme.md", "core.ts"]);
    });

    it("описание — путь относительно корня воркспейса; у файла в корне пусто", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/vs/editor/core.ts`), makePane(`${ROOT}/readme.md`)]);

        expect(provider.getItems(query("")).map((item) => item.description)).toEqual(["src/vs/editor", ""]);
    });

    it("файл вне корня показан абсолютным путём, а не цепочкой «..»", () => {
        const { provider } = createProvider([makePane("/etc/hosts")]);

        expect(provider.getItems(query(""))[0].description).toBe("/etc");
    });

    it("без корня воркспейса описание — абсолютный путь", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/index.ts`)], null);

        expect(provider.getItems(query(""))[0].description).toBe("/repo/src");
    });

    it("у безымянного буфера описания нет (пути на диске тоже)", () => {
        const { provider } = createProvider([makeUntitledPane("Untitled-1")]);

        const [item] = provider.getItems(query(""));
        expect(item.label).toBe("Untitled-1");
        expect(item.description).toBe("");
    });

    it("нет открытых вкладок — одна информационная строка, принимать нечего", () => {
        const { provider } = createProvider([]);

        const items = provider.getItems(query(""));

        expect(items).toHaveLength(1);
        expect(items[0].label).toBe("No opened editors");
        expect(items[0].accept).toBeUndefined();
    });

    it("у каждой строки иконка своего типа файла — список читается как таб-строка", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/index.ts`), makePane(`${ROOT}/readme.md`)]);

        expect(provider.getItems(query("")).map((item) => item.icon)).toEqual([
            getFileIcon("index.ts").icon,
            getFileIcon("readme.md").icon,
        ]);
    });
});

describe("OpenEditorsQuickAccessProvider — фильтрация", () => {
    function threeFiles(): Harness {
        return createProvider([
            makePane(`${ROOT}/src/index.ts`),
            makePane(`${ROOT}/readme.md`),
            makePane(`${ROOT}/src/vs/editor/core.ts`),
        ]);
    }

    it("fuzzy по имени файла оставляет только совпавшие", () => {
        const { provider } = threeFiles();

        expect(provider.getItems(query("cor")).map((item) => item.label)).toEqual(["core.ts"]);
    });

    it("fuzzy по каталогу находит вкладку, имя которой запросу не подходит", () => {
        const { provider } = threeFiles();

        expect(provider.getItems(query("editor")).map((item) => item.label)).toEqual(["core.ts"]);
    });

    it("совпадение в имени бьёт совпадение только в пути", () => {
        const { provider } = createProvider([
            // `src` есть в пути обоих, но именем совпадает только второй.
            makePane(`${ROOT}/src/index.ts`),
            makePane(`${ROOT}/src/srv.ts`),
        ]);

        expect(provider.getItems(query("sr")).map((item) => item.label)).toEqual(["srv.ts", "index.ts"]);
    });

    it("ничего не совпало — пустой список", () => {
        const { provider } = threeFiles();

        expect(provider.getItems(query("zzz"))).toEqual([]);
    });

    it("совпавшие буквы имени подсвечены в лейбле, а не в описании", () => {
        const { provider } = threeFiles();

        const [item] = provider.getItems(query("cor"));
        expect(item.labelMatchRanges).toEqual([[0, 3]]);
        expect(item.descriptionMatchRanges).toEqual([]);
    });

    it("совпадение в каталоге подсвечено в описании локальными оффсетами", () => {
        const { provider } = threeFiles();

        const [item] = provider.getItems(query("editor"));
        expect(item.description).toBe("src/vs/editor");
        expect(item.descriptionMatchRanges).toEqual([[7, 13]]);
        expect(item.labelMatchRanges).toEqual([]);
    });

    it("у файла в корне пути нет — запрос со слэшем его не находит", () => {
        const { provider } = threeFiles();

        // readme.md лежит в корне: в его строке поиска нет ни каталога, ни слэша,
        // иначе «/» находил бы вообще всё открытое.
        expect(provider.getItems(query("/")).map((item) => item.label)).toEqual(["index.ts", "core.ts"]);
    });

    it("лишние пробелы вокруг запроса не попадают в fuzzy", () => {
        const { provider } = threeFiles();

        expect(provider.getItems(`${OpenEditorsQuickAccessProvider.PREFIX}  cor  `).map((i) => i.label)).toEqual([
            "core.ts",
        ]);
    });
});

describe("OpenEditorsQuickAccessProvider — запрос из нескольких термов", () => {
    it("`edt ` остаётся рабочим префиксом: он срезается ДО разбора по пробелам", () => {
        // Разбор целого запроса оставил бы `edt` отдельным термом, и ни одна
        // вкладка его бы не прошла.
        const { provider } = createProvider([makePane(`${ROOT}/src/index.ts`)]);

        expect(provider.getItems(query("")).map((item) => item.label)).toEqual(["index.ts"]);
    });

    it("термы матчатся по каталогу и по имени разом", () => {
        const { provider } = createProvider([
            makePane(`${ROOT}/src/editor/core.ts`),
            makePane(`${ROOT}/lib/editor/core.ts`),
            makePane(`${ROOT}/src/main.ts`),
        ]);

        expect(provider.getItems(query("src core")).map((item) => item.label)).toEqual(["core.ts"]);
    });

    it("найтись обязаны все термы", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/core.ts`)]);

        expect(provider.getItems(query("src zebra"))).toEqual([]);
    });

    it("несколько пробелов подряд и хвостовой пробел не меняют выдачу", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/core.ts`), makePane(`${ROOT}/lib/main.ts`)]);

        for (const filter of ["src core", "src  core", "src core "]) {
            expect(
                provider.getItems(query(filter)).map((item) => item.label),
                filter,
            ).toEqual(["core.ts"]);
        }
    });

    it("подсветка разносится по обеим половинам строки, кусок на терм", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/core.ts`)]);

        const [item] = provider.getItems(query("src core"));
        expect(item.description).toBe("src");
        expect(item.descriptionMatchRanges).toEqual([[0, 3]]);
        expect(item.labelMatchRanges).toEqual([[0, 4]]);
    });
});

describe("OpenEditorsQuickAccessProvider — строка и принятие", () => {
    it("несохранённая вкладка помечена точкой, сохранённая — нет", () => {
        const { provider } = createProvider([makePane(`${ROOT}/a.ts`, { modified: true }), makePane(`${ROOT}/b.ts`)]);

        expect(provider.getItems(query("")).map((item) => item.hint)).toEqual(["●", undefined]);
    });

    it("принятие строки показывает её вкладку", () => {
        const panes = [makePane(`${ROOT}/a.ts`), makePane(`${ROOT}/b.ts`)];
        const { provider, revealed } = createProvider(panes);

        provider.getItems(query("b"))[0].accept?.();

        expect(revealed).toEqual([panes[1]]);
    });
});
