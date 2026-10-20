"use strict";

/**
 * Демо-расширение предложенного диффа: повторяет `openDiff` стокового
 * Anthropic.claude-code в терминальном режиме (сверено с бандлом 2.1.304):
 *
 * - правая сторона кладётся в собственный `FileSystemProvider` расширения
 *   (схема `_demo_fs_right`, провайдер в памяти, как класс `iG` бандла);
 * - `vscode.diff(left, right, title, { preview: false })`, вкладку ждут
 *   опросом `tabGroups.all` (`TabInputTextDiff` с нашим `modified`);
 * - гонка исходов: accept/reject командой (кнопки ✓/↺ в `editor/title`),
 *   закрытие вкладки (= reject), сохранение правой стороны (= FILE_SAVED с
 *   её текстом, только при `files.autoSave === "off"`);
 * - ключ `proposedDiffDemo.viewingProposedDiff` — по `onDidChangeVisibleTextEditors`
 *   (видна ли сторона на нашей схеме);
 * - «закрыть вкладку» (`close_tab` у CLI): сохранить правую сторону и
 *   `tabGroups.close` — без диалога о несохранённом.
 *
 * Исход — пункт статус-бара `diff:<исход>` (у FILE_SAVED — последнее слово
 * первой строки текста: статус-бар узкий) и полный текст в канале Output «Proposed Diff Demo».
 *
 * Используется e2e-сценарием proposedDiff и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <какой-нибудь файл>
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const SCHEME = "_demo_fs_right";

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.text = "diff:-";
    status.show();
    const output = vscode.window.createOutputChannel("Proposed Diff Demo");
    context.subscriptions.push(status, output);

    // Провайдер в памяти — форма класса `iG` бандла.
    const documents = new Map();
    const emitter = new vscode.EventEmitter();
    const provider = {
        onDidChangeFile: emitter.event,
        watch: () => new vscode.Disposable(() => undefined),
        stat: (uri) => find(uri),
        readDirectory: (uri) => {
            throw vscode.FileSystemError.FileNotFound(uri);
        },
        readFile: (uri) => find(uri).data,
        writeFile: (uri, content) => {
            const doc = find(uri);
            doc.data = content;
            doc.mtime = Date.now();
            doc.size = content.length;
            emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        },
        createDirectory: () => {
            throw vscode.FileSystemError.Unavailable();
        },
        delete: () => {
            throw vscode.FileSystemError.Unavailable();
        },
        rename: () => {
            throw vscode.FileSystemError.Unavailable();
        },
    };
    function find(uri) {
        const doc = documents.get(uri.path);
        if (doc === undefined) throw vscode.FileSystemError.FileNotFound(uri);
        return doc;
    }
    function createFile(path, text) {
        const uri = vscode.Uri.from({ scheme: SCHEME, path });
        const data = new TextEncoder().encode(text);
        if (documents.has(path)) provider.writeFile(uri, data);
        else {
            const now = Date.now();
            documents.set(path, { type: vscode.FileType.File, ctime: now, mtime: now, size: data.length, data });
        }
        return uri;
    }
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, provider));

    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors((editors) => {
            const viewing = editors.some((editor) => editor?.document.uri.scheme === SCHEME);
            void vscode.commands.executeCommand("setContext", "proposedDiffDemo.viewingProposedDiff", viewing);
        }),
    );

    const decisions = new vscode.EventEmitter();
    const decide = (accepted) => () => {
        decisions.fire({ accepted, activeTab: vscode.window.tabGroups.activeTabGroup.activeTab });
    };
    context.subscriptions.push(
        vscode.commands.registerCommand("proposedDiffDemo.accept", decide(true)),
        vscode.commands.registerCommand("proposedDiffDemo.reject", decide(false)),
    );

    const allTabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    const poll = (predicate, timeoutMs) =>
        new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (!predicate()) return;
                clearInterval(timer);
                clearTimeout(deadline);
                resolve();
            }, 100);
            const deadline =
                timeoutMs === undefined
                    ? undefined
                    : setTimeout(() => {
                          clearInterval(timer);
                          reject(new Error(`Timeout waiting after ${timeoutMs}ms`));
                      }, timeoutMs);
        });

    let lastTitle = "";

    async function propose() {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined || editor.document.uri.scheme !== "file") {
            status.text = "diff:no-file";
            return;
        }
        const left = editor.document.uri;
        const original = editor.document.getText();
        const [first = "", ...rest] = original.split("\n");
        const proposed = [first.toUpperCase(), ...rest].join("\n");
        const right = createFile(left.path, proposed);
        await vscode.workspace.openTextDocument(right);
        const isOurs = (tab) =>
            tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === right.toString();

        const disposables = [];
        let current = proposed;
        disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.uri.toString() === right.toString()) current = e.document.getText();
            }),
        );
        const saved = new Promise((resolve) => {
            disposables.push(
                vscode.workspace.onWillSaveTextDocument((e) => {
                    if (e.document.uri.toString() === right.toString()) resolve(e.document.getText());
                }),
            );
        });

        lastTitle = `[Proposed] ${left.path.slice(left.path.lastIndexOf("/") + 1)} ⧉`;
        status.text = "diff:open";
        await vscode.commands.executeCommand("vscode.diff", left, right, lastTitle, { preview: false });
        try {
            await poll(() => allTabs().some(isOurs), 1000);
        } catch (error) {
            status.text = "diff:no-tab";
            throw error;
        }

        const decided = new Promise((resolve) => {
            disposables.push(
                decisions.event((decision) => {
                    if (decision.activeTab && isOurs(decision.activeTab)) resolve(decision);
                }),
            );
        }).then((decision) => (decision.accepted ? ["FILE_SAVED", current] : ["DIFF_REJECTED", lastTitle]));
        const closed = poll(() => !allTabs().some(isOurs)).then(() => ["TAB_CLOSED", lastTitle]);
        const race = [decided, closed];
        if (vscode.workspace.getConfiguration("files").get("autoSave") === "off") {
            race.push(saved.then((text) => ["FILE_SAVED", text]));
        }
        const [outcome, text] = await Promise.race(race);
        for (const disposable of disposables) disposable.dispose();
        status.text =
            outcome === "FILE_SAVED" ? `diff:${outcome}:${text.split("\n")[0].split(" ").at(-1)}` : `diff:${outcome}`;
        output.appendLine(`${outcome}\n${text}`);
    }

    // `close_tab` CLI: правая сторона сохраняется, потом вкладка закрывается.
    async function closeTab() {
        for (const tab of allTabs()) {
            if (tab.label !== lastTitle) continue;
            if (tab.input instanceof vscode.TabInputTextDiff) {
                await (await vscode.workspace.openTextDocument(tab.input.modified)).save();
            }
            await vscode.window.tabGroups.close(tab);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("proposedDiffDemo.propose", () => {
            propose().catch((error) => output.appendLine(`propose failed: ${error}`));
        }),
        vscode.commands.registerCommand("proposedDiffDemo.closeTab", closeTab),
    );
};

exports.deactivate = function deactivate() {};
