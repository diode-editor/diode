// A test controller in the shape of vitest.explorer: folders and test files come on "Discover Tests", a file's
// `describe`/`it` blocks only when the file is expanded (resolveHandler, a second late, so the spinner shows).
const vscode = require("vscode");

const RESOLVE_DELAY_MS = 1500;
const BLOCK = /^(\s*)(describe|it)\("([^"]+)"/;

exports.activate = (context) => {
    const controller = vscode.tests.createTestController("demo", "Demo Tests");
    context.subscriptions.push(controller);

    controller.resolveHandler = async (item) => {
        if (item === undefined || item.uri === undefined) return;
        await new Promise((resolve) => setTimeout(resolve, RESOLVE_DELAY_MS));
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

    context.subscriptions.push(
        vscode.commands.registerCommand("demoTests.discover", async () => {
            const [folder] = vscode.workspace.workspaceFolders ?? [];
            if (folder === undefined) return;
            const src = controller.createTestItem("src", "src");
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
