// Diode demo extension: реализует минимальную поддержку .editorconfig.
// Ищет ближайший .editorconfig вверх по дереву от директории открытого файла
// (editor.document.fileName) и применяет indent_style / indent_size / tab_width
// через vscode.window.onDidChangeActiveTextEditor.
//
// CJS-формат (.cjs) используется намеренно: SEA-бинарник Diode загружает
// пользовательские расширения через createRequire(), который работает только
// с CommonJS. ESM dynamic import() в SEA не поддерживает внешние file:// URL.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

function findEditorConfig(startDir) {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, ".editorconfig");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function parseEditorConfig(text) {
    const result = {};
    let inStarSection = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
        if (line.startsWith("[") && line.endsWith("]")) {
            inStarSection = line === "[*]";
            continue;
        }
        if (!inStarSection) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim().toLowerCase();
        const value = line.slice(eq + 1).trim().toLowerCase();
        result[key] = value;
    }
    return result;
}

function applyEditorConfig(editor, out) {
    if (editor === undefined) return;

    const fileName = editor.document.fileName;
    const startDir = path.dirname(fileName);
    const editorConfigPath = findEditorConfig(startDir);
    if (editorConfigPath === null) {
        out.appendLine("[diode-demo.editorconfig] .editorconfig not found from " + startDir);
        return;
    }

    let cfg;
    try {
        cfg = parseEditorConfig(fs.readFileSync(editorConfigPath, "utf-8"));
    } catch (err) {
        out.appendLine("[diode-demo.editorconfig] failed to read " + editorConfigPath + ": " + err);
        return;
    }

    const patch = {};
    const size = cfg.indent_size !== undefined ? cfg.indent_size : cfg.tab_width;
    if (size !== undefined) {
        const n = Number.parseInt(size, 10);
        if (Number.isFinite(n) && n > 0) patch.tabSize = n;
    }
    if (cfg.indent_style === "space") patch.insertSpaces = true;
    else if (cfg.indent_style === "tab") patch.insertSpaces = false;

    if (Object.keys(patch).length === 0) {
        out.appendLine("[diode-demo.editorconfig] no applicable keys in " + editorConfigPath);
        return;
    }

    editor.options = patch;
    out.appendLine("[diode-demo.editorconfig] applied " + JSON.stringify(patch) + " from " + editorConfigPath + " for " + fileName);
}

function activate(context) {
    const out = vscode.window.createOutputChannel("EditorConfig");
    context.subscriptions.push(out);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(function (editor) {
            applyEditorConfig(editor, out);
        }),
    );

    // Применяем к уже открытому редактору (если есть)
    applyEditorConfig(vscode.window.activeTextEditor, out);
}

function deactivate() {
    // nothing to clean up
}

module.exports = { activate, deactivate };
