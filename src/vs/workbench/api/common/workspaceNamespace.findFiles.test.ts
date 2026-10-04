import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { RelativePattern, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

/**
 * Проводка `workspace.findFiles`: разбор `GlobPattern`, три значения `exclude`,
 * `maxResults` поверх нескольких папок, токен отмены и сборка результата в
 * абсолютные `file:`-Uri. Сам обход дерева тестируется на карте в памяти в
 * `findFiles.test.ts` — здесь шов с неймспейсом на НАСТОЯЩЕЙ ФС.
 */

let tmpRoot: string;

beforeEach(() => {
    tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-find-")));
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Раскладывает дерево: ключ — относительный путь файла, значение — содержимое. */
function layout(root: string, files: Record<string, string>): string {
    for (const [rel, content] of Object.entries(files)) {
        const target = path.join(root, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
}

/**
 * Поднимает неймспейс на указанных папках. `configuration` — снапшот настроек
 * в той же форме, в которой его присылает хост: ВЛОЖЕННОЕ дерево (`getValue()`),
 * а не плоские dotted-ключи. Возвращает ещё и `setConfiguration` — правку
 * настроек на живом неймспейсе (notif `workspace.configurationChanged`).
 */
function makeWorkspace(
    folders: readonly string[],
    configuration: Record<string, unknown> = {},
): typeof vscode.workspace & { setConfiguration(next: Record<string, unknown>): void } {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    const workspace = createWorkspaceNamespace(ctx);
    stub.fire("workspace.initialize", {
        configuration: { defaults: {}, user: configuration },
        workspaceFolders: folders.map((folder, index) => ({
            uri: Uri.file(folder).toString(),
            name: path.basename(folder),
            index,
        })),
    });
    return Object.assign(workspace, {
        setConfiguration: (next: Record<string, unknown>): void => {
            stub.fire("workspace.configurationChanged", {
                configuration: { defaults: {}, user: next },
                affectedKeys: [],
            });
        },
    });
}

/** Снапшот с дефолтами `files.exclude` — в форме дерева, как у хоста. */
const FILES_EXCLUDE_SNAPSHOT = { files: { exclude: { "**/.git": true, "**/node_modules": true } } };

/** Пути результата относительно корня — читаемее абсолютных в ассертах. */
function relative(root: string, uris: readonly vscode.Uri[]): string[] {
    return uris.map((uri) => path.relative(root, (uri as unknown as Uri).fsPath)).toSorted();
}

describe("workspace.findFiles — разбор GlobPattern", () => {
    it("строковый шаблон ищет во ВСЕХ папках воркспейса", async () => {
        const a = layout(path.join(tmpRoot, "a"), { "pom.xml": "", "src/App.java": "" });
        const b = layout(path.join(tmpRoot, "b"), { "pom.xml": "" });
        const workspace = makeWorkspace([a, b]);

        const found = await workspace.findFiles("**/pom.xml");

        expect(relative(tmpRoot, found)).toEqual([path.join("a", "pom.xml"), path.join("b", "pom.xml")]);
    });

    it("RelativePattern сужает поиск до своей базы", async () => {
        const a = layout(path.join(tmpRoot, "a"), { "pom.xml": "" });
        const b = layout(path.join(tmpRoot, "b"), { "pom.xml": "" });
        const workspace = makeWorkspace([a, b]);

        const found = await workspace.findFiles(new RelativePattern(Uri.file(b) as never, "*.xml") as never);

        expect(relative(tmpRoot, found)).toEqual([path.join("b", "pom.xml")]);
    });

    it("результат — абсолютные file:-Uri", async () => {
        const root = layout(tmpRoot, { "pom.xml": "" });
        const workspace = makeWorkspace([root]);

        const found = await workspace.findFiles("**/pom.xml");

        expect(found).toHaveLength(1);
        expect((found[0] as unknown as Uri).scheme).toBe("file");
        expect((found[0] as unknown as Uri).fsPath).toBe(path.join(root, "pom.xml"));
    });

    it("без открытых папок — пустой результат, как в контракте", async () => {
        const workspace = makeWorkspace([]);
        await expect(workspace.findFiles("**/pom.xml")).resolves.toEqual([]);
    });

    it("мусорный шаблон не роняет вызов", async () => {
        const workspace = makeWorkspace([layout(tmpRoot, { "pom.xml": "" })]);
        await expect(workspace.findFiles({ nonsense: true } as never)).resolves.toEqual([]);
    });
});

describe("workspace.findFiles — exclude", () => {
    const tree = { "pom.xml": "", "node_modules/dep/pom.xml": "", ".git/pom.xml": "", "web/pom.xml": "" };

    it("undefined — шаблоны настройки files.exclude", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);

        const found = await workspace.findFiles("**/pom.xml");

        expect(relative(root, found)).toEqual(["pom.xml", path.join("web", "pom.xml")]);
    });

    it("undefined при пустой настройке — исключений нет", async () => {
        // Дефолты живут в настройке, а не в коде обхода: снапшот без
        // `files.exclude` значит «ничего не исключать», а не «взять что-то своё».
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root]);

        const found = await workspace.findFiles("**/pom.xml");

        expect(relative(root, found)).toContain(path.join("node_modules", "dep", "pom.xml"));
    });

    it("search.exclude в дефолты НЕ входит — так в контракте", async () => {
        // «default file-excludes (e.g. the `files.exclude`-setting but not
        // `search.exclude`)»: расширение ищет файл, чтобы с ним работать.
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], { search: { exclude: { "**/web": true } } });

        const found = await workspace.findFiles("**/pom.xml");

        expect(relative(root, found)).toContain(path.join("web", "pom.xml"));
    });

    it("правка настройки применяется к следующему же вызову", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);
        expect(relative(root, await workspace.findFiles("**/pom.xml"))).not.toContain(
            path.join("node_modules", "dep", "pom.xml"),
        );

        workspace.setConfiguration({ files: { exclude: { "**/.git": true, "**/node_modules": false } } });

        expect(relative(root, await workspace.findFiles("**/pom.xml"))).toContain(
            path.join("node_modules", "dep", "pom.xml"),
        );
    });

    it("null — не исключает ничего", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);

        const found = await workspace.findFiles("**/pom.xml", null);

        expect(relative(root, found)).toContain(path.join("node_modules", "dep", "pom.xml"));
    });

    it("явный шаблон ЗАМЕНЯЕТ дефолты, а не добавляется к ним", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);

        const found = await workspace.findFiles("**/pom.xml", "**/web/**");

        // `web` вырезан заданным шаблоном, а `node_modules` — уже нет: дефолт снят.
        expect(relative(root, found)).toEqual([
            path.join(".git", "pom.xml"),
            path.join("node_modules", "dep", "pom.xml"),
            "pom.xml",
        ]);
    });

    it("мусорный exclude — ничего не исключаем, а не падаем", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root], FILES_EXCLUDE_SNAPSHOT);

        // Объект без `pattern` разобрать нечем. Трактуем как «исключений нет»:
        // отбросить результат целиком было бы хуже молчаливого отсутствия фильтра.
        const found = await workspace.findFiles("**/pom.xml", { nonsense: true } as never);

        expect(relative(root, found)).toContain(path.join("node_modules", "dep", "pom.xml"));
    });

    it("RelativePattern в exclude берётся своим шаблоном", async () => {
        const root = layout(tmpRoot, tree);
        const workspace = makeWorkspace([root]);

        const found = await workspace.findFiles(
            "**/pom.xml",
            new RelativePattern(Uri.file(root) as never, "**/web/**") as never,
        );

        expect(relative(root, found)).not.toContain(path.join("web", "pom.xml"));
    });
});

describe("workspace.findFiles — maxResults и отмена", () => {
    it("maxResults считается по всем папкам вместе", async () => {
        const a = layout(path.join(tmpRoot, "a"), { "pom.xml": "" });
        const b = layout(path.join(tmpRoot, "b"), { "pom.xml": "" });
        const workspace = makeWorkspace([a, b]);

        const found = await workspace.findFiles("**/pom.xml", null, 1);

        expect(relative(tmpRoot, found)).toEqual([path.join("a", "pom.xml")]);
    });

    it("maxResults: 1 — типовой запрос redhat.java «есть ли хоть один билд-файл»", async () => {
        const root = layout(tmpRoot, { "web/pom.xml": "", "core/pom.xml": "" });
        const workspace = makeWorkspace([root]);

        await expect(workspace.findFiles("**/pom.xml", null, 1)).resolves.toHaveLength(1);
    });

    it("уже отменённый токен — пустой результат", async () => {
        const root = layout(tmpRoot, { "pom.xml": "" });
        const workspace = makeWorkspace([root]);
        const source = new CancellationTokenSource();
        source.cancel();

        const found = await workspace.findFiles("**/pom.xml", null, undefined, source.token as never);

        expect(found).toEqual([]);
    });

    it("живой токен поиску не мешает", async () => {
        const root = layout(tmpRoot, { "pom.xml": "" });
        const workspace = makeWorkspace([root]);
        const source = new CancellationTokenSource();

        const found = await workspace.findFiles("**/pom.xml", null, undefined, source.token as never);

        expect(found).toHaveLength(1);
    });
});
