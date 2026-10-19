"use strict";

/**
 * Фикстура для extensionHost.quickPickSubprocess.test.ts — объектный пикер
 * (`window.createQuickPick`) через НАСТОЯЩИЙ субпроцесс.
 *
 * Команды возвращают то, что расширение получило от человека, вместе с журналом
 * событий пикера — значение команды и есть сигнал наружу (конвенция фикстур).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    /** Пикер, показанный командой test.showForHide. */
    let shown;

    const SOURCE = [
        { description: "Alpha module", value: "example.com/alpha" },
        { description: "Beta module", value: "example.com/beta" },
        { description: "Gamma", value: "Gamma" },
    ];

    context.subscriptions.push(
        // Форма `pickLazyEnum` golang.go: пикер открывается пустым, предметы
        // приезжают асинхронно на каждое изменение запроса, Enter принимает,
        // расширение само прячет и освобождает пикер.
        vscode.commands.registerCommand("test.lazyPick", function () {
            return new Promise(function (resolve) {
                const log = [];
                const quickPick = vscode.window.createQuickPick();
                quickPick.title = "Lazy enum";
                quickPick.placeholder = "Type to search modules";
                quickPick.matchOnDescription = true;
                let resolved = false;
                const search = function (query) {
                    quickPick.busy = true;
                    setTimeout(function () {
                        quickPick.items = SOURCE.filter(function (entry) {
                            return entry.value.toLowerCase().includes(query.toLowerCase());
                        }).map(function (entry) {
                            return {
                                label: entry.description,
                                detail: entry.value !== entry.description ? entry.value : undefined,
                                value: entry.value,
                            };
                        });
                        quickPick.busy = false;
                        // Видимый признак «ответ на этот запрос пришёл» — тесту.
                        quickPick.prompt = query === "" ? undefined : "results for " + query;
                    }, 0);
                };
                quickPick.onDidChangeValue(function (value) {
                    log.push("value:" + value);
                    search(value);
                });
                quickPick.onDidChangeSelection(function (items) {
                    log.push(
                        "selection:" +
                            items
                                .map(function (item) {
                                    return item.label;
                                })
                                .join(","),
                    );
                });
                quickPick.onDidAccept(function () {
                    const selection = quickPick.selectedItems[0];
                    resolved = true;
                    log.push("accept");
                    resolve({ value: selection ? selection.value : undefined, log: log });
                    quickPick.hide();
                });
                quickPick.onDidHide(function () {
                    log.push("hide");
                    if (!resolved) resolve({ value: undefined, log: log });
                    quickPick.dispose();
                });
                quickPick.show();
                search("");
            });
        }),
        // Множественный выбор с предотметкой, разделителем и шагами мастера.
        vscode.commands.registerCommand("test.pickManyObject", function () {
            return new Promise(function (resolve) {
                const quickPick = vscode.window.createQuickPick();
                const items = [
                    { label: "one" },
                    { label: "Group", kind: vscode.QuickPickItemKind.Separator },
                    { label: "two" },
                    { label: "three" },
                ];
                quickPick.title = "Pick numbers";
                quickPick.step = 1;
                quickPick.totalSteps = 2;
                quickPick.canSelectMany = true;
                quickPick.items = items;
                quickPick.selectedItems = [items[2]];
                quickPick.onDidAccept(function () {
                    const picked = quickPick.selectedItems.map(function (item) {
                        return item.label;
                    });
                    // Объекты — те самые, что расширение отдало: сравнение по ссылке.
                    const same = quickPick.selectedItems.every(function (item) {
                        return items.includes(item);
                    });
                    quickPick.dispose();
                    resolve({ picked: picked, same: same });
                });
                quickPick.show();
            });
        }),
        // Показ и скрытие самим расширением: onDidHide ровно один раз.
        // Показ и скрытие самим расширением: onDidHide ровно один раз. Две
        // команды, а не таймер: тест сам решает, когда пикер уже на экране.
        vscode.commands.registerCommand("test.showForHide", function () {
            const quickPick = vscode.window.createQuickPick();
            shown = { quickPick: quickPick, hides: 0 };
            quickPick.onDidHide(function () {
                shown.hides++;
            });
            quickPick.items = [{ label: "x" }];
            quickPick.show();
            return null;
        }),
        vscode.commands.registerCommand("test.hideShown", function () {
            const current = shown;
            return new Promise(function (resolve) {
                const subscription = current.quickPick.onDidHide(function () {
                    subscription.dispose();
                    // dispose после скрытия второго onDidHide давать не должен.
                    current.quickPick.dispose();
                    resolve({ hides: current.hides });
                });
                current.quickPick.hide();
            });
        }),
    );
};
