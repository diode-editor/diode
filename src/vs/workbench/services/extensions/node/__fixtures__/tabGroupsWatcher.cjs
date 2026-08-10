"use strict";

/**
 * Фикстура window.tabGroups/showTextDocument: записывает снимок tabGroups на
 * активации и события onDidChangeTabs/TabGroups/VisibleTextEditors; команды —
 * `test.tabs.dump` (лог), `test.tabs.snapshot` (текущий tabGroups),
 * `test.tabs.show {uri, viewColumn, preserveFocus}` (показ документа, отдаёт
 * {uri, viewColumn} открытого редактора), `test.tabs.close {label}` (закрыть
 * вкладку по метке), `test.tabs.closeGroup {viewColumn}` (закрыть группу).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const log = [];

    function groupsSnapshot() {
        return vscode.window.tabGroups.all.map(function (group) {
            return {
                viewColumn: group.viewColumn,
                isActive: group.isActive,
                tabs: group.tabs.map(function (tab) {
                    return {
                        label: tab.label,
                        isActive: tab.isActive,
                        isDirty: tab.isDirty,
                        isPinned: tab.isPinned,
                        isPreview: tab.isPreview,
                        inputKind:
                            tab.input instanceof vscode.TabInputTextDiff
                                ? "diff"
                                : tab.input instanceof vscode.TabInputText
                                  ? "text"
                                  : "other",
                        uri: tab.input instanceof vscode.TabInputText ? tab.input.uri.toString() : null,
                    };
                }),
            };
        });
    }

    log.push({ kind: "activate", groups: groupsSnapshot(), visible: vscode.window.visibleTextEditors.length });
    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs(function (e) {
            log.push({
                kind: "tabs",
                opened: e.opened.map(function (t) { return t.label; }),
                closed: e.closed.map(function (t) { return t.label; }),
                changed: e.changed.map(function (t) { return t.label; }),
            });
        }),
    );
    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabGroups(function (e) {
            log.push({
                kind: "groups",
                opened: e.opened.map(function (g) { return g.viewColumn; }),
                closed: e.closed.map(function (g) { return g.viewColumn; }),
                changed: e.changed.map(function (g) { return g.viewColumn; }),
            });
        }),
    );
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(function (editors) {
            log.push({ kind: "visible", count: editors.length });
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.tabs.dump", function () {
            return log;
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.tabs.snapshot", function () {
            return { groups: groupsSnapshot(), visible: vscode.window.visibleTextEditors.length };
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.tabs.close", function (params) {
            var tabs = vscode.window.tabGroups.all
                .reduce(function (all, group) { return all.concat(group.tabs); }, [])
                .filter(function (tab) { return tab.label === params.label; });
            return vscode.window.tabGroups.close(tabs.length === 1 ? tabs[0] : tabs);
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.tabs.closeGroup", function (params) {
            var group = vscode.window.tabGroups.all.find(function (g) {
                return g.viewColumn === params.viewColumn;
            });
            return vscode.window.tabGroups.close(group);
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.tabs.show", function (params) {
            return vscode.window
                .showTextDocument(vscode.Uri.parse(params.uri), {
                    viewColumn: params.viewColumn,
                    preserveFocus: params.preserveFocus,
                })
                .then(function (editor) {
                    return { uri: editor.document.uri.toString(), viewColumn: editor.viewColumn };
                });
        }),
    );
};
