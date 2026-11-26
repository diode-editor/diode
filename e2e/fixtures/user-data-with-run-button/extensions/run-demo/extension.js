// Sets its context key from the active file, as jbang-vscode does with `isJBangFile`, and reports each run in
// the status bar so a screenshot shows which item the button ran.
const vscode = require("vscode");

function activate(context) {
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.text = "run-demo: idle";
    status.show();
    let runs = 0;
    const report = (what) => () => {
        runs += 1;
        status.text = `run-demo: ${what} #${String(runs)}`;
    };
    const sync = () => {
        const editor = vscode.window.activeTextEditor;
        void vscode.commands.executeCommand("setContext", "isRunDemoFile", editor?.document.fileName.endsWith(".demo.txt") === true);
    };
    context.subscriptions.push(
        status,
        vscode.commands.registerCommand("runDemo.run", report("Run")),
        vscode.commands.registerCommand("runDemo.debug", report("Debug")),
        vscode.window.onDidChangeActiveTextEditor(sync),
    );
    sync();
}

module.exports = { activate };
