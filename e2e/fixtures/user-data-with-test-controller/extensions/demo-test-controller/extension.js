// A test controller in the shape of vitest.explorer: folders and test files come on "Discover Tests", a file's
// `describe`/`it` blocks only when the file is expanded (resolveHandler, a second late, so the spinner shows).
// Its Run profile steps through the tests: a name with "fails" fails, "throws" errors, "skip" is skipped, the rest
// pass; each takes a while so the run can be seen, cancellation stops it.
const vscode = require("vscode");

const RESOLVE_DELAY_MS = 1500;
const STEP_MS = 700;
const BLOCK = /^(\s*)(describe|it)\("([^"]+)"/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.activate = (context) => {
    const controller = vscode.tests.createTestController("demo", "Demo Tests");
    context.subscriptions.push(controller);

    const resolveFile = async (item) => {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(item.uri));
        const suites = [item];
        text.split("\n").forEach((line, index) => {
            const match = BLOCK.exec(line);
            if (match === null) return;
            const [, indent, kind, label] = match;
            const depth = indent.length / 4;
            const parent = suites[depth];
            const test = controller.createTestItem(`${parent.id}/${label}`, label, item.uri);
            test.range = new vscode.Range(index, indent.length, index, line.length);
            if (kind === "it" && label.includes("slow")) test.description = "~2s";
            parent.children.add(test);
            suites[depth + 1] = test;
        });
    };

    controller.resolveHandler = async (item) => {
        if (item === undefined || item.uri === undefined) return;
        await sleep(RESOLVE_DELAY_MS);
        await resolveFile(item);
    };

    /** The leaves under the request's tests (the whole tree without `include`), files resolved on the way. */
    const collect = async (items, excluded, out) => {
        for (const item of items) {
            if (excluded.has(item)) continue;
            if (item.uri !== undefined && item.canResolveChildren && item.children.size === 0) await resolveFile(item);
            const children = [];
            item.children.forEach((child) => children.push(child));
            if (children.length === 0) out.push(item);
            else await collect(children, excluded, out);
        }
        return out;
    };

    controller.createRunProfile(
        "Run",
        vscode.TestRunProfileKind.Run,
        async (request, token) => {
            const roots = [];
            if (request.include === undefined) controller.items.forEach((item) => roots.push(item));
            else roots.push(...request.include);
            const tests = await collect(roots, new Set(request.exclude ?? []), []);
            const run = controller.createTestRun(request);
            // The run's own output and each test's, in ANSI colors: the TEST RESULTS panel shows them.
            run.appendOutput(`\x1b[1;36m RUN \x1b[0m demo tests\r\n`);
            for (const test of tests) run.enqueued(test);
            for (const [index, test] of tests.entries()) {
                if (token.isCancellationRequested) break;
                run.started(test);
                run.appendOutput(`\x1b[33mrunning\x1b[0m ${test.label}\r\n`, undefined, test);
                await sleep(STEP_MS);
                if (token.isCancellationRequested) break;
                const duration = 10 * (index + 1);
                if (test.label.includes("fails")) {
                    run.appendOutput(`\x1b[31mFAIL\x1b[0m ${test.label}\r\n`, undefined, test);
                    run.failed(test, vscode.TestMessage.diff("expected 2 to equal 3", "3", "2"), duration);
                } else if (test.label.includes("throws")) {
                    run.errored(test, new vscode.TestMessage("TypeError: boom"), duration);
                } else if (test.label.includes("skip")) {
                    run.skipped(test);
                } else {
                    run.passed(test, duration);
                }
            }
            run.appendOutput(`\x1b[2m done \x1b[0m\r\n`);
            run.end();
        },
        true,
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("demoTests.discover", async () => {
            const [folder] = vscode.workspace.workspaceFolders ?? [];
            if (folder === undefined) return;
            // A folder has its uri, as vitest's do: opening a file resolves the tests over it (upstream `testsInFile`).
            const src = controller.createTestItem("src", "src", vscode.Uri.joinPath(folder.uri, "src"));
            const files = await vscode.workspace.findFiles("src/*.test.js");
            for (const uri of files) {
                const name = uri.path.slice(uri.path.lastIndexOf("/") + 1);
                const file = controller.createTestItem(name, name, uri);
                file.canResolveChildren = true;
                src.children.add(file);
            }
            controller.items.replace([src]);
        }),
        // A row's menu item gets the extension's own TestItem.
        vscode.commands.registerCommand("demoTests.updateSnapshot", (test) => {
            void vscode.window.showInformationMessage(`Update Snapshot: ${test?.label ?? "no test"}`);
        }),
    );
};
