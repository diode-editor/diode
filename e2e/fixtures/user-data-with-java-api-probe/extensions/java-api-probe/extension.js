"use strict";

/**
 * API surfaces on which the stock `redhat.java` didn't survive to the end of `activate()`; the step results go
 * to Output, where the scenario reads them. Not the real `redhat.java`: it isn't in our marketplace registry, and
 * it needs JDK 21 and half a minute to bring up its server.
 *
 * The step order is deliberate: `workspace.fs` itself plants the trap for `findFiles` and removes it at the end.
 */

exports.activate = async function activate(context) {
    const vscode = require("vscode");
    const out = vscode.window.createOutputChannel("Java API Probe");

    // Marker for the scenario; the status bar is narrow — details go to Output.
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.name = "Java API Probe";
    status.text = "java api: работает";
    status.show();
    context.subscriptions.push(status, out);

    const steps = [];
    const fail = (step, err) => {
        steps.push(step + ": ПРОВАЛ " + String(err && err.message ? err.message : err));
    };

    // 1. env. The first activation failure: `switch (env.uiKind)` → `Cannot read properties of undefined (reading 'Desktop')`.
    try {
        const kind = vscode.env.uiKind === vscode.UIKind.Desktop ? "Desktop" : "Web";
        steps.push(
            "env: uiKind=" +
                kind +
                " telemetry=" +
                (vscode.env.isTelemetryEnabled ? "on" : "off") +
                " remote=" +
                (vscode.env.remoteName === undefined ? "none" : vscode.env.remoteName) +
                " sessionId=" +
                (vscode.env.sessionId.length > 0 ? "есть" : "пусто"),
        );
    } catch (err) {
        fail("env", err);
    }

    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    const join = (...parts) => vscode.Uri.file(parts.join("/"));
    const root = folder ? folder.uri.fsPath : "";

    // 2. workspace.fs — this is how jdt.ls lays out `-configuration`; failed with `fs.createDirectory is not a function`.
    // The trap lives in a VCS directory: it's in the default `files.exclude`. `node_modules` isn't there (upstream too) —
    // only `search.exclude` hides it.
    const decoyParent = root + "/.hg";
    const decoyDir = decoyParent + "/decoy";
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(decoyDir));
        await vscode.workspace.fs.writeFile(join(decoyDir, "pom.tmp"), Buffer.from("<project/>", "utf8"));
        await vscode.workspace.fs.rename(join(decoyDir, "pom.tmp"), join(decoyDir, "pom.xml"));
        await vscode.workspace.fs.copy(join(decoyDir, "pom.xml"), join(decoyDir, "pom.bak"));
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(decoyDir));
        const names = entries.map((e) => e[0]).sort();
        steps.push("fs: createDirectory+writeFile+rename+copy → readDirectory=[" + names.join(", ") + "]");
        steps.push(
            "fs: isWritableFileSystem file=" +
                String(vscode.workspace.fs.isWritableFileSystem("file")) +
                " jdt=" +
                String(vscode.workspace.fs.isWritableFileSystem("jdt")),
        );
    } catch (err) {
        fail("fs", err);
    }

    // 3. findFiles — redhat.java calls it about ten times per activation. `exclude: undefined` must
    // apply `files.exclude`, and only that, as in the upstream contract.
    try {
        const withDefaults = await vscode.workspace.findFiles("**/pom.xml");
        const withoutExcludes = await vscode.workspace.findFiles("**/pom.xml", null);
        const first = await vscode.workspace.findFiles("**/pom.xml", null, 1);
        const rel = (uri) => vscode.workspace.asRelativePath(uri);
        steps.push(
            "findFiles: по умолчанию=[" +
                withDefaults.map(rel).sort().join(", ") +
                "] без исключений=" +
                String(withoutExcludes.length) +
                " maxResults1=" +
                String(first.length),
        );
    } catch (err) {
        fail("findFiles", err);
    }

    // Clean up the trap — this also checks `delete` with recursive.
    try {
        await vscode.workspace.fs.delete(vscode.Uri.file(decoyParent), { recursive: true });
        steps.push("fs: delete(recursive) убрал ловушку");
    } catch (err) {
        fail("fs.delete", err);
    }

    // 4. registerCustomEditorProvider: TUI won't have webviews by design, but registration must not throw.
    try {
        const registration = vscode.window.registerCustomEditorProvider("javaApiProbe.settings", {
            resolveCustomTextEditor: () => Promise.resolve(),
        });
        context.subscriptions.push(registration);
        steps.push("customEditor: регистрация принята (заглушка, вкладки не будет)");
    } catch (err) {
        fail("customEditor", err);
    }

    for (const line of steps) out.appendLine(line);
    out.appendLine("итог: " + (steps.some((s) => s.includes("ПРОВАЛ")) ? "ПРОВАЛ" : "все шаги прошли"));

    status.text = steps.some((s) => s.includes("ПРОВАЛ")) ? "java api: ПРОВАЛ" : "java api: готово";

    context.subscriptions.push(
        vscode.commands.registerCommand("javaApiProbe.showReport", () => {
            out.show();
        }),
    );
};
