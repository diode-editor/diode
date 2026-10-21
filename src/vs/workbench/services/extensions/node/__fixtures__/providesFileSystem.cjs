"use strict";

/**
 * Fixture for extensionHost.fileSystem.test.ts.
 * Registers a read-only FileSystemProvider for the `demo:` scheme, the same path
 * the built-in git uses to serve a file's HEAD version under the `git:` scheme.
 *
 * Content is derived from the resource path so the test can check that
 * the provider received exactly the requested URI. `fire()` via a command lets
 * the test trigger onDidChangeFile from the subprocess and observe it on the host.
 *
 * The second scheme, `memo:`, is a WRITABLE in-memory provider (the shape of the provider
 * for the right side of a Claude Code proposed diff): the host writes to it on save,
 * `memo.read` returns what was written to the test.
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
                    return new TextEncoder().encode("contents " + uri.path);
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
