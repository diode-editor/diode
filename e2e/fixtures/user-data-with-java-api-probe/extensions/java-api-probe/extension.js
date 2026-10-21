"use strict";

/**
 * Поверхности API, на которых стоковый `redhat.java` не доживал до конца `activate()`; итог шагов —
 * в Output, его читает сценарий. Не настоящий `redhat.java`: его нет в нашем реестре магазина, а
 * сам он требует JDK 21 и полминуты на подъём сервера.
 *
 * Порядок шагов не случаен: `workspace.fs` сам ставит ловушку для `findFiles` и в конце её сносит.
 */

exports.activate = async function activate(context) {
    const vscode = require("vscode");
    const out = vscode.window.createOutputChannel("Java API Probe");

    // Маркер для сценария; полоса узкая — подробности в Output.
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.name = "Java API Probe";
    status.text = "java api: работает";
    status.show();
    context.subscriptions.push(status, out);

    const steps = [];
    const fail = (step, err) => {
        steps.push(step + ": ПРОВАЛ " + String(err && err.message ? err.message : err));
    };

    // 1. env. Первое падение активации: `switch (env.uiKind)` → `Cannot read properties of undefined (reading 'Desktop')`.
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

    // 2. workspace.fs — так jdt.ls раскладывает `-configuration`; падало на `fs.createDirectory is not a function`.
    // Ловушка — в каталоге VCS: он в дефолте `files.exclude`. `node_modules` там нет (и у эталона) —
    // его скрывает только `search.exclude`.
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

    // 3. findFiles — redhat.java зовёт его около десяти раз за активацию. `exclude: undefined` обязан
    // применить `files.exclude`, и только её, как в контракте эталона.
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

    // Ловушку за собой убираем — заодно это проверка `delete` с recursive.
    try {
        await vscode.workspace.fs.delete(vscode.Uri.file(decoyParent), { recursive: true });
        steps.push("fs: delete(recursive) убрал ловушку");
    } catch (err) {
        fail("fs.delete", err);
    }

    // 4. registerCustomEditorProvider: webview в TUI не будет by design, но регистрация обязана не падать.
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
