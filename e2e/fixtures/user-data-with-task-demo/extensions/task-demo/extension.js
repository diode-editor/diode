"use strict";

/**
 * Задачи формой bazel-java — `new Task(def, TaskScope.Workspace, name, source, new ShellExecution(cmd))`,
 * плюс `CustomExecution` на pty расширения.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const item = (priority, text) => {
        const it = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
        it.text = text;
        it.show();
        context.subscriptions.push(it);
        return it;
    };
    const eventItem = item(103, "ev:-");
    const listItem = item(102, "ls:-");

    let own;
    const label = (execution) => `${execution.task === own ? "own" : execution.task.source}/${execution.task.name}`;
    const report = (event) => {
        eventItem.text = `ev:${event}`;
        listItem.text = `ls:${vscode.tasks.taskExecutions.map((e) => e.task.name).join(",")}`;
    };

    const shellTask = (target, command) =>
        new vscode.Task({ type: "demo", target }, vscode.TaskScope.Workspace, target, "demo", new vscode.ShellExecution(command));

    const ptyTask = () =>
        new vscode.Task(
            { type: "demo", target: "pty" },
            vscode.TaskScope.Workspace,
            "pty",
            "demo",
            new vscode.CustomExecution(async (definition) => {
                const write = new vscode.EventEmitter();
                const close = new vscode.EventEmitter();
                return {
                    onDidWrite: write.event,
                    onDidClose: close.event,
                    open: () => {
                        write.fire(`custom pty for ${definition.target}, press a key\r\n`);
                    },
                    close: () => undefined,
                    handleInput: () => {
                        write.fire("custom pty done\r\n");
                        close.fire(0);
                    },
                };
            }),
        );

    context.subscriptions.push(
        vscode.tasks.registerTaskProvider("demo", {
            provideTasks: () => [
                shellTask("ok", "echo demo task ok"),
                shellTask("fail", "echo demo task fail; exit 7"),
                shellTask("long", "sleep 600"),
                ptyTask(),
            ],
            resolveTask: () => undefined,
        }),
        vscode.tasks.onDidStartTask((e) => report(`start:${label(e.execution)}`)),
        vscode.tasks.onDidEndTask((e) => report(`end:${label(e.execution)}`)),
        vscode.tasks.onDidStartTaskProcess((e) => report(`pstart:${e.execution.task.name}`)),
        vscode.tasks.onDidEndTaskProcess((e) => report(`pend:${e.execution.task.name}:${e.exitCode}`)),
        vscode.commands.registerCommand("taskDemo.execute", async () => {
            own = shellTask("own", "echo own task from the extension");
            await vscode.tasks.executeTask(own);
        }),
        vscode.commands.registerCommand("taskDemo.fetch", async () => {
            const tasks = await vscode.tasks.fetchTasks({ type: "demo" });
            report(`fetch:${tasks.map((t) => t.name).join(",")}`);
        }),
        vscode.commands.registerCommand("taskDemo.terminate", () => {
            // Как bazel-java: своя бегущая задача ищется по имени и источнику.
            const running = vscode.tasks.taskExecutions.find((e) => e.task.source === "demo" && e.task.name === "long");
            if (running) running.terminate();
        }),
    );
};
