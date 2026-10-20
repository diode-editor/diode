"use strict";

/**
 * Фикстура для extensionHost.fileSystem.test.ts.
 * Регистрирует read-only FileSystemProvider для схемы `demo:` — тот же путь,
 * которым встроенный git отдаёт версию файла из HEAD по схеме `git:`.
 *
 * Содержимое выводится из пути ресурса, чтобы тест мог проверить, что до
 * провайдера доехал именно запрошенный URI. `fire()` через команду позволяет
 * тесту дёрнуть onDidChangeFile из субпроцесса и увидеть его на хосте.
 *
 * Вторая схема, `memo:`, — ПИШУЩИЙ провайдер в памяти (форма провайдера правой
 * стороны предложенного диффа Claude Code): хост пишет в него сохранением,
 * `memo.read` отдаёт тесту записанное.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const emitter = new vscode.EventEmitter();

    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(
            "demo",
            {
                onDidChangeFile: emitter.event,
                watch: function () {
                    return new vscode.Disposable(function () {});
                },
                stat: function () {
                    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 };
                },
                readFile: function (uri) {
                    if (uri.path === "/missing") {
                        throw vscode.FileSystemError.FileNotFound(uri);
                    }
                    return new TextEncoder().encode("содержимое " + uri.path);
                },
            },
            { isReadonly: true },
        ),
    );

    const memo = new Map();
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider("memo", {
            onDidChangeFile: new vscode.EventEmitter().event,
            watch: function () {
                return new vscode.Disposable(function () {});
            },
            stat: function (uri) {
                const entry = memo.get(uri.path);
                if (entry === undefined) throw vscode.FileSystemError.FileNotFound(uri);
                return { type: vscode.FileType.File, ctime: 0, mtime: entry.mtime, size: entry.data.length };
            },
            readFile: function (uri) {
                const entry = memo.get(uri.path);
                if (entry === undefined) throw vscode.FileSystemError.FileNotFound(uri);
                return entry.data;
            },
            writeFile: function (uri, data, options) {
                if (!options.create || !options.overwrite) throw vscode.FileSystemError.NoPermissions(uri);
                memo.set(uri.path, { data: data, mtime: memo.size + 1 });
            },
        }),
        vscode.commands.registerCommand("memo.read", function (path) {
            const entry = memo.get(path);
            return entry === undefined ? null : new TextDecoder().decode(entry.data);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("demo.fireChange", function (path) {
            emitter.fire([{ type: vscode.FileChangeType.Changed, uri: vscode.Uri.parse("demo:" + path) }]);
        }),
    );
};
