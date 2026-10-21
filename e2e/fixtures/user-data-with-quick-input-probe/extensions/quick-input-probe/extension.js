"use strict";

/** Полученное печатается сообщением — по нему видно, ДОЕХАЛО ли введённое до расширения. */

/** Как печатаем ответ: отмена — отдельный исход, пустая строка — свой. */
function describe(value) {
    if (value === undefined) return "отменено";
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

    // Ответ печатаем ещё и в Output: у `showInformationMessage` в Diode пока нет экранной
    // поверхности. Панель открывается один раз при активации — фокус посреди сценария не перехватывает.
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
            prompt: "Как к вам обращаться",
            placeHolder: "имя",
        });
        show("Ask Name: " + describe(value));
    });

    register("diodeProbe.askNamePrefilled", async function () {
        const value = await vscode.window.showInputBox({
            title: "Your name",
            prompt: "Как к вам обращаться",
            placeHolder: "имя",
            value: "Ада Лавлейс",
        });
        show("Ask Name: " + describe(value));
    });

    // Оверлей поднимается через 3 секунды — за это время успеваем открыть
    // Quick Open и убедиться, что расширение перехватывает виджет, а набранное
    // в чужой сессии в его поле не протекает.
    register("diodeProbe.askNameDelayed", async function () {
        await delay(DELAY_MS);
        const value = await vscode.window.showInputBox({
            title: "Your name",
            prompt: "Как к вам обращаться",
            placeHolder: "имя",
        });
        show("Ask Name: " + describe(value));
    });

    // Печатаем ДЛИНУ: секрет незачем выводить, а по длине видно, что доехали все символы.
    register("diodeProbe.askSecret", async function () {
        const value = await vscode.window.showInputBox({
            title: "Secret",
            prompt: "Набранное закрыто маской",
            placeHolder: "пароль",
            password: true,
        });
        show("Secret length: " + (value === undefined ? "отменено" : String(value.length)));
    });

    // Ошибка блокирует Enter, предупреждение — нет.
    register("diodeProbe.askPort", async function () {
        const value = await vscode.window.showInputBox({
            title: "Port",
            prompt: "Порт сервера",
            placeHolder: "8080",
            validateInput: function (text) {
                if (text === "") return null;
                if (!/^\d+$/.test(text)) return "Только цифры";
                if (Number(text) < 1024) {
                    return {
                        message: "Порт < 1024 требует прав root",
                        severity: vscode.InputBoxValidationSeverity.Warning,
                    };
                }
                return null;
            },
        });
        show("Port: " + describe(value));
    });

    // Валидатор отвечает с задержкой: проверяем, что под полем оказывается
    // сообщение о ТЕКУЩЕМ тексте, а не об одном из промежуточных.
    register("diodeProbe.askSlowValidate", async function () {
        const value = await vscode.window.showInputBox({
            title: "Slow validate",
            prompt: "Валидация отвечает через секунду",
            validateInput: async function (text) {
                await delay(SLOW_MS);
                if (text === "") return null;
                return {
                    message: "Проверено: " + text,
                    severity: vscode.InputBoxValidationSeverity.Info,
                };
            },
        });
        show("Slow: " + describe(value));
    });

    // Расширение закрывает свой же оверлей токеном отмены.
    register("diodeProbe.askWithTimeout", async function () {
        const source = new vscode.CancellationTokenSource();
        const timer = setTimeout(function () {
            source.cancel();
        }, DELAY_MS);
        try {
            const value = await vscode.window.showInputBox(
                { title: "Ask With Timeout", prompt: "Закроется само через 3 секунды" },
                source.token,
            );
            show("Ask With Timeout: " + (value === undefined ? "отменено по токену" : describe(value)));
        } finally {
            clearTimeout(timer);
            source.dispose();
        }
    });


    register("diodeProbe.pickFruit", async function () {
        const value = await vscode.window.showQuickPick(["apple", "banana", "cherry"], {
            placeHolder: "Выберите фрукт",
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
            { placeHolder: "Выберите язык" },
        );
        show("Kind: " + (picked === undefined ? "отменено" : picked.label));
    });

    /** Отмеченное — в строку; пустой набор отличается от отмены. */
    function describePicked(picked) {
        if (picked === undefined) return "отменено";
        if (picked.length === 0) return "(пусто)";
        return picked.join(", ");
    }

    register("diodeProbe.pickMany", async function () {
        const picked = await vscode.window.showQuickPick(["alpha", "beta", "gamma"], {
            placeHolder: "Отметьте пробелом",
            canPickMany: true,
        });
        show("Picked: " + describePicked(picked));
    });

    register("diodeProbe.pickManyPreselected", async function () {
        const picked = await vscode.window.showQuickPick(
            [{ label: "alpha" }, { label: "beta", picked: true }, { label: "gamma" }],
            { placeHolder: "Отметьте пробелом", canPickMany: true },
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
            placeHolder: "Отметьте пробелом",
            canPickMany: true,
        });
        show("Picked: " + describePicked(picked));
    });

    // Список приходит промисом: до его готовности на экране ничего не меняется.
    register("diodeProbe.pickAsync", async function () {
        const items = delay(SLOW_MS).then(function () {
            return ["считано-1", "считано-2", "считано-3"];
        });
        const value = await vscode.window.showQuickPick(items, { placeHolder: "Считаем список…" });
        show("Async: " + describe(value));
    });

    register("diodeProbe.pickEmpty", async function () {
        const value = await vscode.window.showQuickPick([], { placeHolder: "Список пуст" });
        show("Empty: " + describe(value));
    });


    register("diodeProbe.askThenPick", async function () {
        const name = await vscode.window.showInputBox({ title: "Step 1", prompt: "Имя" });
        const fruit = await vscode.window.showQuickPick(["apple", "banana", "cherry"], {
            placeHolder: "Шаг 2: фрукт",
        });
        show("Both: " + describe(name) + " / " + describe(fruit));
    });

    // Форма `pickLazyEnum` golang.go (`Go: Maintain gopls`): пикер открывается пустым, предметы
    // приезжают с задержкой на каждый запрос, как ответ сервера; Enter принимает, прячет пикер расширение.

    const MODULES = [
        { name: "Alpha module", path: "example.com/alpha" },
        { name: "Beta module", path: "example.com/beta" },
        { name: "Gamma tools", path: "example.com/gamma" },
    ];

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
                    quickPick.prompt = query === "" ? "Все модули" : "Найдено по «" + query + "»";
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

    // Форма «Go: Choose Go Environment → Choose from file browser» golang.go.
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
