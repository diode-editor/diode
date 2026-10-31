/**
 * Entry point of the test extension, the part of the harness that lives inside the editor.
 *
 * The runner asks for one suite per session (`current.json`) and starts it with `_apiConformance.run`
 * once the editor is ready. Results go to a file line by line, so a session that hangs or dies still
 * leaves everything that finished before it.
 */

const fs = require("node:fs");
const path = require("node:path");

const vscode = require("vscode");

// Replaced at build time: the directory of this run.
const workDir = __API_CONFORMANCE_WORK_DIR__;
const testTimeoutMs = __API_CONFORMANCE_TEST_TIMEOUT_MS__;

/**
 * Upstream's `_workbench.revertAllDirty` calls `editorService.revertAll`, which Diode has no command
 * for. The same end state through the public API: a file document gets its disk text back and is
 * saved (the disk does not change), an untitled one is emptied, which is the text it was created with.
 */
async function revertAllDirty() {
    for (const document of vscode.workspace.textDocuments) {
        if (!document.isDirty) continue;
        const isFile = document.uri.scheme !== "untitled";
        const text = isFile ? Buffer.from(await vscode.workspace.fs.readFile(document.uri)).toString("utf8") : "";
        const edit = new vscode.WorkspaceEdit();
        const whole = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        edit.replace(document.uri, whole, text);
        await vscode.workspace.applyEdit(edit);
        if (isFile) await document.save();
    }
}

function runSuite(suite) {
    const write = (record) => fs.appendFileSync(path.join(workDir, "results", `${suite}.jsonl`), `${JSON.stringify(record)}\n`);
    const Mocha = require("mocha");

    function Reporter(runner) {
        runner.on("pass", (test) => write({ kind: "pass", title: test.fullTitle(), ms: test.duration }));
        runner.on("fail", (test, error) => write({ kind: "fail", title: test.fullTitle(), error: String(error?.message).slice(0, 400), hook: test.type === "hook" }));
        runner.on("pending", (test) => write({ kind: "skip", title: test.fullTitle() }));
        runner.on("end", () => write({ kind: "end" }));
    }

    try {
        const mocha = new Mocha({ ui: "tdd", timeout: testTimeoutMs, color: false, reporter: Reporter });
        mocha.addFile(path.join(__dirname, "tests", `${suite}.js`));
        // Loaded here to announce the plan, so tests that never finish are known by name.
        mocha.loadFiles();
        mocha.lazyLoadFiles(true);
        const planned = [];
        mocha.suite.eachTest((test) => planned.push(test.fullTitle()));
        write({ kind: "plan", titles: planned });
        mocha.run();
    } catch (error) {
        write({ kind: "load-error", error: String(error?.stack).slice(0, 800) });
        write({ kind: "end" });
    }
}

exports.activate = function activate(context) {
    require("./upstreamExtension.js").activate(context);
    const register = (id, handler) => context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    register("_extensionTests.getLogLevel", () => "info");
    register("_extensionTests.setLogLevel", () => undefined);
    register("_workbench.revertAllDirty", revertAllDirty);
    register("_apiConformance.run", () => {
        const { suite, hang } = JSON.parse(fs.readFileSync(path.join(workDir, "current.json"), "utf8"));
        // `--hang`: lets a human see that a stuck session only costs its own suite.
        // eslint-disable-next-line no-empty
        if (hang) for (;;) {}
        runSuite(suite);
    });
};
