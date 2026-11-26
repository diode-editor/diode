"use strict";

/** The received value is printed as a message — it shows whether the input REACHED the extension. */

/** How the answer is printed: cancellation and an empty string are distinct outcomes. */
function describe(value) {
    if (value === undefined) return "cancelled";
    if (value === "") return "«»";
    return value;
}

const SLOW_MS = 1000;
const DELAY_MS = 3000;

function delay(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

exports.activate = function activate(context) {
    const vscode = require("vscode");

    // The answer also goes to Output: `showInformationMessage` has no on-screen surface in Diode yet.
    // The panel opens once on activation, so it does not steal focus mid-scenario.
    const channel = vscode.window.createOutputChannel("Diode Probe");
    context.subscriptions.push(channel);
    channel.show(true);

    const show = function (text) {
        vscode.window.showInformationMessage(text);
        channel.appendLine(text);
    };

    const register = function (id, run) {
        context.subscriptions.push(vscode.commands.registerCommand(id, run));
    };


    register("diodeProbe.askName", async function () {
        const value = await vscode.window.showInputBox({
            title: "Your name",
            prompt: "How should we address you",
            placeHolder: "name",
        });
        show("Ask Name: " + describe(value));
    });

    register("diodeProbe.askNamePrefilled", async function () {
        const value = await vscode.window.showInputBox({
            title: "Your name",
            prompt: "How should we address you",
            placeHolder: "name",
            value: "Ada Lovelace",
        });
        show("Ask Name: " + describe(value));
    });

    // The overlay shows up after 3 seconds — enough time to open Quick Open
    // and check that the extension takes over the widget, and text typed in
    // the other session does not leak into its field.
    register("diodeProbe.askNameDelayed", async function () {
        await delay(DELAY_MS);
        const value = await vscode.window.showInputBox({
            title: "Your name",
            prompt: "How should we address you",
            placeHolder: "name",
        });
        show("Ask Name: " + describe(value));
    });

    // Print the LENGTH: no need to reveal the secret, and the length shows all characters arrived.
    register("diodeProbe.askSecret", async function () {
        const value = await vscode.window.showInputBox({
            title: "Secret",
            prompt: "Typed text is masked",
            placeHolder: "password",
            password: true,
        });
        show("Secret length: " + (value === undefined ? "cancelled" : String(value.length)));
    });

    // An error blocks Enter, a warning does not.
    register("diodeProbe.askPort", async function () {
        const value = await vscode.window.showInputBox({
            title: "Port",
            prompt: "Server port",
            placeHolder: "8080",
            validateInput: function (text) {
                if (text === "") return null;
                if (!/^\d+$/.test(text)) return "Digits only";
                if (Number(text) < 1024) {
                    return {
                        message: "Port < 1024 requires root",
                        severity: vscode.InputBoxValidationSeverity.Warning,
                    };
                }
                return null;
            },
        });
        show("Port: " + describe(value));
    });

    // The validator responds with a delay: checks that the message under the field
    // is about the CURRENT text, not one of the intermediate ones.
    register("diodeProbe.askSlowValidate", async function () {
        const value = await vscode.window.showInputBox({
            title: "Slow validate",
            prompt: "Validation answers after a second",
            validateInput: async function (text) {
                await delay(SLOW_MS);
                if (text === "") return null;
                return {
                    message: "Checked: " + text,
                    severity: vscode.InputBoxValidationSeverity.Info,
                };
            },
        });
        show("Slow: " + describe(value));
    });

    // The extension closes its own overlay with a cancellation token.
    register("diodeProbe.askWithTimeout", async function () {
        const source = new vscode.CancellationTokenSource();
        const timer = setTimeout(function () {
            source.cancel();
        }, DELAY_MS);
        try {
            const value = await vscode.window.showInputBox(
                { title: "Ask With Timeout", prompt: "Closes by itself in 3 seconds" },
                source.token,
            );
            show("Ask With Timeout: " + (value === undefined ? "cancelled by token" : describe(value)));
        } finally {
            clearTimeout(timer);
            source.dispose();
        }
    });


    register("diodeProbe.pickFruit", async function () {
        const value = await vscode.window.showQuickPick(["apple", "banana", "cherry"], {
            placeHolder: "Pick a fruit",
        });
        show("Fruit: " + describe(value));
    });

    register("diodeProbe.pickFileKind", async function () {
        const picked = await vscode.window.showQuickPick(
            [
                { label: "TypeScript", description: ".ts, .tsx" },
                { label: "JavaScript", description: ".js, .jsx" },
                { label: "Python", description: ".py" },
            ],
            { placeHolder: "Pick a language" },
        );
        show("Kind: " + (picked === undefined ? "cancelled" : picked.label));
    });

    /** Checked items as a string; an empty set differs from cancellation. */
    function describePicked(picked) {
        if (picked === undefined) return "cancelled";
        if (picked.length === 0) return "(empty)";
        return picked.join(", ");
    }

    register("diodeProbe.pickMany", async function () {
        const picked = await vscode.window.showQuickPick(["alpha", "beta", "gamma"], {
            placeHolder: "Check with Space",
            canPickMany: true,
        });
        show("Picked: " + describePicked(picked));
    });

    register("diodeProbe.pickManyPreselected", async function () {
        const picked = await vscode.window.showQuickPick(
            [{ label: "alpha" }, { label: "beta", picked: true }, { label: "gamma" }],
            { placeHolder: "Check with Space", canPickMany: true },
        );
        show(
            "Picked: " +
                describePicked(
                    picked === undefined
                        ? undefined
                        : picked.map(function (item) {
                              return item.label;
                          }),
                ),
        );
    });

    register("diodeProbe.pickMany100", async function () {
        const items = [];
        for (let i = 1; i <= 100; i++) items.push("item-" + String(i).padStart(3, "0"));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "Check with Space",
            canPickMany: true,
        });
        show("Picked: " + describePicked(picked));
    });

    // The list arrives as a promise: nothing changes on screen until it resolves.
    register("diodeProbe.pickAsync", async function () {
        const items = delay(SLOW_MS).then(function () {
            return ["loaded-1", "loaded-2", "loaded-3"];
        });
        const value = await vscode.window.showQuickPick(items, { placeHolder: "Loading the list…" });
        show("Async: " + describe(value));
    });

    register("diodeProbe.pickEmpty", async function () {
        const value = await vscode.window.showQuickPick([], { placeHolder: "The list is empty" });
        show("Empty: " + describe(value));
    });


    register("diodeProbe.askThenPick", async function () {
        const name = await vscode.window.showInputBox({ title: "Step 1", prompt: "Name" });
        const fruit = await vscode.window.showQuickPick(["apple", "banana", "cherry"], {
            placeHolder: "Step 2: fruit",
        });
        show("Both: " + describe(name) + " / " + describe(fruit));
    });

    // Shape of golang.go's `pickLazyEnum` (`Go: Maintain gopls`): the picker opens empty, items
    // arrive with a delay per query, like a server response; Enter accepts, the extension hides the picker.

    const MODULES = [
        { name: "Alpha module", path: "example.com/alpha" },
        { name: "Beta module", path: "example.com/beta" },
        { name: "Gamma tools", path: "example.com/gamma" },
    ];

    /** One step of a wizard: a live input box with Back, as multi-step extensions build them. */
    function askStep(prompt, value, validate) {
        return new Promise(function (resolve) {
            const box = vscode.window.createInputBox();
            box.title = "New Project";
            box.step = prompt === "Name" ? 1 : 2;
            box.totalSteps = 2;
            box.prompt = prompt;
            box.value = value;
            if (box.step > 1) box.buttons = [vscode.QuickInputButtons.Back];
            box.onDidChangeValue(function (text) {
                box.validationMessage = validate(text);
            });
            box.onDidTriggerButton(function (button) {
                if (button === vscode.QuickInputButtons.Back) {
                    resolve({ back: true });
                    box.dispose();
                }
            });
            box.onDidAccept(function () {
                if (box.validationMessage) return;
                // Resolve first: dispose fires onDidHide on a visible box, as upstream.
                resolve({ value: box.value });
                box.dispose();
            });
            box.onDidHide(function () {
                resolve({ cancelled: true });
                box.dispose();
            });
            box.show();
        });
    }

    register("diodeProbe.wizard", async function () {
        const answers = { name: "demo", group: "com.example" };
        const lowercase = function (text) {
            return /^[a-z.]*$/.test(text) ? undefined : "Lowercase only";
        };
        let step = 1;
        while (step <= 2) {
            const prompt = step === 1 ? "Name" : "Group";
            const key = step === 1 ? "name" : "group";
            const answer = await askStep(prompt, answers[key], lowercase);
            if (answer.cancelled) {
                show("Wizard: cancelled");
                return;
            }
            if (answer.back) {
                step--;
                continue;
            }
            answers[key] = answer.value;
            step++;
        }
        show("Wizard: " + answers.group + ":" + answers.name);
    });

    register("diodeProbe.lazyPick", function () {
        return new Promise(function (resolve) {
            const quickPick = vscode.window.createQuickPick();
            quickPick.title = "Lazy enum";
            quickPick.placeholder = "Type to search modules";
            quickPick.matchOnDescription = true;
            let timer;
            let accepted = false;
            const search = function (query) {
                quickPick.busy = true;
                clearTimeout(timer);
                timer = setTimeout(function () {
                    quickPick.items = MODULES.filter(function (m) {
                        return m.path.includes(query.toLowerCase());
                    }).map(function (m) {
                        return { label: "$(package) " + m.name, detail: m.path, path: m.path };
                    });
                    quickPick.prompt = query === "" ? "All modules" : "Matches for \"" + query + "\"";
                    quickPick.busy = false;
                }, 300);
            };
            quickPick.onDidChangeValue(search);
            quickPick.onDidAccept(function () {
                const selection = quickPick.selectedItems[0];
                accepted = true;
                show("Lazy: " + (selection ? selection.path : "(none)"));
                quickPick.hide();
            });
            quickPick.onDidHide(function () {
                if (!accepted) show("Lazy: cancelled");
                quickPick.dispose();
                resolve();
            });
            quickPick.show();
            search("");
        });
    });

    // Shape of golang.go's "Go: Choose Go Environment → Choose from file browser".
    register("diodeProbe.openDialog", async function () {
        const folders = vscode.workspace.workspaceFolders;
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: folders ? folders[0].uri : undefined,
            title: "Pick a file",
        });
        show("Opened: " + (picked && picked.length === 1 ? picked[0].fsPath : "(cancelled)"));
    });
};

exports.deactivate = function deactivate() {};
