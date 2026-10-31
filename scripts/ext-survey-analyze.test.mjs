import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { analyzeSource, DTS_PATH, extractSurface, loadSurface, toMembers, upstreamDts } from "./ext-survey-analyze.mjs";

const surface = loadSurface();
const members = (source) => toMembers(analyzeSource(source).paths, surface).members;

test("the surface comes from the whole upstream file, dormant members included", () => {
    assert.equal(surface.get("window.showTextDocument").kind, "namespace");
    assert.equal(surface.get("scm.createSourceControl").owner, "scm");
    assert.equal(surface.get("window.createWebviewPanel").kind, "namespace");
    assert.equal(surface.get("TextDocument.getText").kind, "interface");
    assert.equal(surface.get("Uri.file").kind, "class");
    assert.equal(surface.get("Range").kind, "class");
    assert.equal(surface.get("StatusBarAlignment.Left").kind, "enum");
    assert.equal(surface.get("version").kind, "const");
    assert.equal(surface.has("TextDocument"), false, "an interface is not a runtime value");
});

test("overloads collapse into one member", () => {
    const small = extractSurface(`declare module "vscode" {
        export namespace window { export function show(a: string): void; export function show(a: number): void; export let x: number; }
        export interface Thing { a: string; b(): void; }
    }`);
    assert.deepEqual([...small.keys()], ["window.show", "window.x", "Thing.a", "Thing.b"]);
});

test("upstreamDts removes exactly one comment layer", () => {
    const staged = readFileSync(DTS_PATH, "utf8");
    const upstream = upstreamDts(staged);
    assert.match(upstream, /^\s*export namespace scm \{/m);
    assert.throws(() => upstreamDts("no sentinel"), /sentinel/);
    assert.equal(upstreamDts("//@diode:begin-upstream-verbatim x\n// // a\n//\n// b"), "// a\n\nb");
});

test("plain require, property calls", () => {
    assert.deepEqual(members(`const vscode = require("vscode"); vscode.window.createTreeView("a", {}); vscode.languages.registerHoverProvider();`), [
        "languages.registerHoverProvider",
        "window.createTreeView",
    ]);
});

test("minifier aliases of require", () => {
    assert.deepEqual(members(`var a = t("vscode"); var w = a.window; w.showErrorMessage("x");`), ["window.showErrorMessage"]);
});

test("destructuring with renames and nesting", () => {
    assert.deepEqual(members(`const {window: w, commands} = require("vscode"); w.createOutputChannel("a"); commands.registerCommand("a");`), [
        "commands.registerCommand",
        "window.createOutputChannel",
    ]);
    assert.deepEqual(members(`const {window: {showInformationMessage: s}} = require("vscode"); s("a");`), ["window.showInformationMessage"]);
    assert.deepEqual(members(`let w; ({window: w} = require("vscode")); w.createTerminal();`), ["window.createTerminal"]);
});

test("a destructured member counts even when never called", () => {
    assert.deepEqual(members(`const {env: {shell}} = require("vscode");`), ["env.shell"]);
});

test("interop wrappers and .default", () => {
    assert.deepEqual(members(`var v = __toESM(require("vscode"), 1); v.default.workspace.getConfiguration();`), ["workspace.getConfiguration"]);
    assert.deepEqual(members(`const v = tslib.__importStar(require("vscode")); v.workspace.findFiles();`), ["workspace.findFiles"]);
    assert.deepEqual(members(`const v = (0, r.__importStar)(require("vscode")); (0, v.window.createStatusBarItem)();`), ["window.createStatusBarItem"]);
});

test("webpack external module by numeric and string id", () => {
    const bundle = `(()=>{var m={1398:e=>{"use strict";e.exports=require("vscode")}};function n(i){return m[i]}
        const r=n(1398);r.languages.createDiagnosticCollection("a");})();`;
    assert.deepEqual(members(bundle), ["languages.createDiagnosticCollection"]);
    assert.deepEqual(members(`var m={"ext":function(e){e.exports=require("vscode")}};var r=n("ext");r.window.showQuickPick();`), ["window.showQuickPick"]);
    assert.deepEqual(members(`var m=[function(e){e.exports=require("vscode")}];var r=n(0);r.window.showInputBox();`), ["window.showInputBox"]);
});

test("webpack module whose factory is parenthesized", () => {
    const bundle = `var m={398:((module)=>{"use strict";module.exports=require("vscode");})};const vscode=__importStar(__webpack_require__(398));vscode.window.showQuickPick();`;
    assert.deepEqual(members(bundle), ["window.showQuickPick"]);
    assert.deepEqual(members(`var X=P(((e,t)=>{t.exports=require("vscode")}));X().env.openExternal();`), ["env.openExternal"]);
});

test("esbuild lazy commonjs wrapper", () => {
    assert.deepEqual(members(`var X=__commonJS({"ext"(e,t){t.exports=require("vscode")}});var v=__toESM(X());v.tasks.fetchTasks();`), ["tasks.fetchTasks"]);
    assert.deepEqual(members(`var X=P((e,t)=>{t.exports=require("vscode")});X().env.openExternal();`), ["env.openExternal"]);
});

test("use before the assignment in file order: functions hoist over the alias", () => {
    assert.deepEqual(members(`function f(){ v.window.showWarningMessage(); } var v = require("vscode");`), ["window.showWarningMessage"]);
    assert.deepEqual(members(`var w = v.window; var v = require("vscode"); w.showOpenDialog();`), ["window.showOpenDialog"]);
});

test("rollup iife passes the API as a parameter", () => {
    assert.deepEqual(members(`(function(v){ v.window.showSaveDialog(); })(require("vscode"));`), ["window.showSaveDialog"]);
});

test("esm import forms", () => {
    assert.deepEqual(members(`import * as v from "vscode"; v.window.withProgress();`), ["window.withProgress"]);
    assert.deepEqual(members(`import v from "vscode"; v.window.createQuickPick();`), ["window.createQuickPick"]);
    assert.deepEqual(members(`import {window as w, Uri} from "vscode"; w.createInputBox(); Uri.file("a");`), ["Uri.file", "window.createInputBox"]);
    assert.deepEqual(members(`async function f(){ const v = await import("vscode"); v.env.clipboard; }`), ["env.clipboard"]);
});

test("element access with a string", () => {
    assert.deepEqual(members(`const v = require("vscode"); v["window"]["showQuickPick"]();`), ["window.showQuickPick"]);
});

test("a same-named variable in another scope is not the API", () => {
    assert.deepEqual(members(`const e = require("vscode"); function f(e){ return e.env.PATH; } function g(){ const e = process; return e.env.HOME; } e.window.showInputBox();`), [
        "window.showInputBox",
    ]);
});

test("a block-scoped alias stays in its block", () => {
    assert.deepEqual(members(`{ const e = require("vscode"); e.window.showInputBox(); } function f(){ return e.env.machineId; }`), ["window.showInputBox"]);
});

test("an object key named like the alias is not a reference", () => {
    assert.deepEqual(members(`const w = require("vscode").window; const o = { w: 1 }; o.w;`), []);
});

test("longest known prefix: a value chain ends at the namespace member", () => {
    assert.deepEqual(members(`const v = require("vscode"); v.window.activeTextEditor.document.getText();`), ["window.activeTextEditor"]);
    assert.deepEqual(members(`const v = require("vscode"); v.Uri.file("a").toString();`), ["Uri.file"]);
    assert.deepEqual(members(`const v = require("vscode"); new v.Range(0,0,0,0);`), ["Range"]);
    assert.deepEqual(members(`const v = require("vscode"); v.StatusBarAlignment.Left;`), ["StatusBarAlignment.Left"]);
});

test("a path outside the surface under a known owner is reported as unknown, other misses are dropped", () => {
    const { members: known, unknown } = toMembers(analyzeSource(`const v = require("vscode"); v.window.onDidWriteTerminalData(); v.nonsense.a; v.__esModule;`).paths, surface);
    assert.deepEqual(known, []);
    assert.deepEqual(unknown, ["window.onDidWriteTerminalData"]);
});

test("apiFound tells a bundle without the API from one that never uses a member", () => {
    assert.equal(analyzeSource(`console.log("nothing")`).apiFound, false);
    assert.equal(analyzeSource(`console.log("vscode")`).apiFound, false);
    assert.equal(analyzeSource(`require("vscode");`).apiFound, true);
    assert.equal(analyzeSource(`const v = require("vscode");`).apiFound, true);
});
