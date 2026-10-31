/**
 * Static side of the extension survey (docs/extensions/README.md): which members of the pinned
 * `vscode.d.ts` exist, and which of them a piece of extension JavaScript touches. Nothing here runs
 * extension code, and nothing touches the network: the survey and the matrix both build on this.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import ts from "typescript";

const repoRoot = resolve(import.meta.dirname, "..");
export const DTS_PATH = join(repoRoot, "src", "vscode-dts", "vscode.d.ts");

const DORMANT_SENTINEL = "//@diode:begin-upstream-verbatim";

/** The whole upstream file: the dormant part of the staged copy, one comment layer removed. */
export function upstreamDts(staged) {
    const start = staged.indexOf(DORMANT_SENTINEL);
    if (start === -1) throw new Error(`vscode.d.ts: no "${DORMANT_SENTINEL}" sentinel`);
    return staged
        .slice(staged.indexOf("\n", start) + 1)
        .split("\n")
        .map((line) => (line.startsWith("// ") ? line.slice(3) : line === "//" ? "" : line))
        .join("\n");
}

function memberName(node) {
    if (node.name === undefined) return undefined;
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
    return undefined;
}

/**
 * Member paths as in `vscode.d.ts`, overloads collapsed: `window.showTextDocument` for a namespace
 * member, `TextDocument.getText` for a type member, `Range` for a class or an enum as a whole
 * (a runtime value an extension can reference; an interface is not one).
 *
 * @returns {Map<string, { kind: "namespace" | "class" | "enum" | "interface" | "const", owner: string }>}
 */
export function extractSurface(dtsSource) {
    const file = ts.createSourceFile("vscode.d.ts", dtsSource, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const surface = new Map();
    const add = (path, kind, owner) => {
        if (!surface.has(path)) surface.set(path, { kind, owner });
    };
    const moduleBlock = file.statements.find((s) => ts.isModuleDeclaration(s) && s.name.text === "vscode")?.body;
    if (moduleBlock === undefined) throw new Error('vscode.d.ts: no `declare module "vscode"`');
    for (const statement of moduleBlock.statements) {
        if (ts.isModuleDeclaration(statement) && statement.body !== undefined) {
            const ns = statement.name.text;
            for (const inner of statement.body.statements) {
                if (ts.isFunctionDeclaration(inner) && inner.name !== undefined) add(`${ns}.${inner.name.text}`, "namespace", ns);
                else if (ts.isVariableStatement(inner)) {
                    for (const d of inner.declarationList.declarations) add(`${ns}.${d.name.getText(file)}`, "namespace", ns);
                }
            }
        } else if (ts.isVariableStatement(statement)) {
            for (const d of statement.declarationList.declarations) add(d.name.getText(file), "const", "types");
        } else if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement)) {
            const type = statement.name?.text;
            if (type === undefined) continue;
            const kind = ts.isClassDeclaration(statement) ? "class" : ts.isEnumDeclaration(statement) ? "enum" : "interface";
            if (kind !== "interface") add(type, kind, "types");
            for (const member of statement.members) {
                const name = memberName(member);
                if (name !== undefined) add(`${type}.${name}`, kind, "types");
            }
        }
    }
    return surface;
}

export function loadSurface() {
    return extractSurface(upstreamDts(readFileSync(DTS_PATH, "utf8")));
}

class Scope {
    bindings = new Map();

    constructor(parent, isFunction) {
        this.parent = parent;
        this.isFunction = isFunction;
    }

    declare(name) {
        if (!this.bindings.has(name)) this.bindings.set(name, { path: null });
    }

    lookup(name) {
        for (let scope = this; scope !== null; scope = scope.parent) {
            const binding = scope.bindings.get(name);
            if (binding !== undefined) return binding;
        }
        return undefined;
    }

    get functionScope() {
        let scope = this;
        while (!scope.isFunction) scope = scope.parent;
        return scope;
    }
}

function joinPath(base, property) {
    if (base === "" && property === "default") return "";
    return base === "" ? property : `${base}.${property}`;
}

const isVscodeLiteral = (node) => ts.isStringLiteralLike(node) && (node.text === "vscode" || node.text === "node:vscode");

/**
 * Scope-aware walk over one parsed file: minifiers reuse a name in every function, so `e.env` in one
 * scope says nothing about `e` being the API in another.
 */
class ApiUsageWalker {
    scopes = new Map();
    webpackModuleIds = new Set();
    found = new Set();
    changed = false;
    collecting = false;
    current = null;

    constructor(file) {
        this.file = file;
    }

    run() {
        this.declare(this.file, null);
        for (let pass = 0; pass < 5; pass++) {
            this.changed = false;
            this.flow(this.file);
            if (!this.changed) break;
        }
        this.collecting = true;
        this.flow(this.file);
        return { apiFound: this.apiFound === true, paths: this.found };
    }

    declarePattern(name, scope) {
        if (ts.isIdentifier(name)) scope.declare(name.text);
        else {
            for (const element of name.elements) {
                if (ts.isBindingElement(element)) this.declarePattern(element.name, scope);
            }
        }
    }

    declare(node, parentScope) {
        let scope = parentScope;
        if (ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node) || ts.isModuleBlock(node)) {
            scope = new Scope(parentScope, true);
            this.scopes.set(node, scope);
            if (ts.isFunctionLike(node)) {
                if (node.name !== undefined && ts.isFunctionExpression(node)) scope.declare(node.name.text);
                for (const p of node.parameters) this.declarePattern(p.name, scope);
            }
        } else if (ts.isBlock(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isCaseBlock(node) || ts.isCatchClause(node)) {
            scope = new Scope(parentScope, false);
            this.scopes.set(node, scope);
            if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
                this.declarePattern(node.variableDeclaration.name, scope);
            }
        }
        if (ts.isVariableDeclarationList(node)) {
            const target = node.flags & ts.NodeFlags.BlockScoped ? scope : scope.functionScope;
            for (const d of node.declarations) this.declarePattern(d.name, target);
        } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) {
            parentScope.declare(node.name.text);
        } else if (ts.isImportDeclaration(node) && node.importClause !== undefined) {
            const clause = node.importClause;
            if (clause.name !== undefined) scope.declare(clause.name.text);
            if (clause.namedBindings !== undefined) {
                if (ts.isNamespaceImport(clause.namedBindings)) scope.declare(clause.namedBindings.name.text);
                else for (const e of clause.namedBindings.elements) scope.declare(e.name.text);
            }
        }
        ts.forEachChild(node, (child) => {
            this.declare(child, scope);
        });
    }

    set(binding, path) {
        if (binding === undefined || path === null || binding.path !== null) return;
        binding.path = path;
        this.changed = true;
        this.apiFound = true;
    }

    /** The API path an expression evaluates to, `""` for the API object, `null` when unrelated. */
    resolve(node) {
        if (ts.isIdentifier(node)) return this.current.lookup(node.text)?.path ?? null;
        if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)) return this.resolve(node.expression);
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) return this.resolve(node.right);
        if (ts.isPropertyAccessExpression(node)) {
            const base = this.resolve(node.expression);
            return base === null ? null : joinPath(base, node.name.text);
        }
        if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
            const base = this.resolve(node.expression);
            return base === null ? null : joinPath(base, node.argumentExpression.text);
        }
        if (ts.isCallExpression(node)) return this.resolveCall(node);
        return null;
    }

    resolveCall(node) {
        const [first] = node.arguments;
        // require("vscode"), a minifier's a("vscode"), import("vscode").
        if (first !== undefined && isVscodeLiteral(first) && (ts.isIdentifier(node.expression) || node.expression.kind === ts.SyntaxKind.ImportKeyword)) return "";
        if (first === undefined) {
            // An esbuild lazy module, webpack's `n.n(x)` getter: calling the alias gives the API back.
            return this.resolve(node.expression) === "" ? "" : null;
        }
        if (node.arguments.length === 1 && (ts.isNumericLiteral(first) || ts.isStringLiteralLike(first))) {
            return this.webpackModuleIds.has(first.text) ? "" : null;
        }
        // __toESM(x, 1), __importStar(x), an interop wrapper: the result is the same API object.
        return this.resolve(first) === "" && this.resolve(node.expression) === null ? "" : null;
    }

    bindPattern(name, path) {
        if (ts.isIdentifier(name)) {
            this.set(this.current.lookup(name.text), path);
            return;
        }
        if (!ts.isObjectBindingPattern(name) || path === null) return;
        for (const element of name.elements) {
            if (element.dotDotDotToken !== undefined) continue;
            const key = element.propertyName ?? element.name;
            if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key)) continue;
            const inner = joinPath(path, key.text);
            this.record(inner);
            this.bindPattern(element.name, inner);
        }
    }

    bindAssignmentPattern(target, path) {
        if (ts.isIdentifier(target)) {
            this.set(this.current.lookup(target.text), path);
            return;
        }
        if (!ts.isObjectLiteralExpression(target) || path === null) return;
        for (const property of target.properties) {
            if (ts.isShorthandPropertyAssignment(property)) {
                const inner = joinPath(path, property.name.text);
                this.record(inner);
                this.set(this.current.lookup(property.name.text), inner);
            } else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) {
                const inner = joinPath(path, property.name.text);
                this.record(inner);
                this.bindAssignmentPattern(property.initializer, inner);
            }
        }
    }

    record(path) {
        if (this.collecting) this.found.add(path);
    }

    /** `module.exports = require("vscode")` inside a bundled module: the module's own id is the API now. */
    registerModule(assignment) {
        let fn = assignment.parent;
        while (fn !== undefined && !ts.isFunctionLike(fn)) fn = fn.parent;
        if (fn === undefined) return;
        let value = fn;
        while (ts.isParenthesizedExpression(value.parent)) value = value.parent;
        const holder = ts.isPropertyAssignment(value.parent) ? value.parent : value;
        const key = holder.name;
        if (key !== undefined && (ts.isNumericLiteral(key) || ts.isStringLiteralLike(key)) && !this.webpackModuleIds.has(key.text)) {
            this.webpackModuleIds.add(key.text);
            this.changed = true;
            this.apiFound = true;
        }
        const list = holder.parent;
        if (ts.isArrayLiteralExpression(list)) {
            const index = String(list.elements.indexOf(holder));
            if (!this.webpackModuleIds.has(index)) {
                this.webpackModuleIds.add(index);
                this.changed = true;
                this.apiFound = true;
            }
        }
        // var X = __commonJS((e, t) => { t.exports = require("vscode") }): X() is the API.
        let call = holder.parent;
        if (ts.isObjectLiteralExpression(call)) call = call.parent;
        if (ts.isCallExpression(call) && ts.isVariableDeclaration(call.parent) && ts.isIdentifier(call.parent.name)) {
            const saved = this.current;
            this.current = this.scopeOf(call.parent);
            this.set(this.current.lookup(call.parent.name.text), "");
            this.current = saved;
        }
    }

    scopeOf(node) {
        for (let n = node; n !== undefined; n = n.parent) {
            const scope = this.scopes.get(n);
            if (scope !== undefined) return scope;
        }
        throw new Error("no scope");
    }

    flow(node) {
        const scope = this.scopes.get(node);
        const saved = this.current;
        if (scope !== undefined) this.current = scope;

        if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
            this.bindPattern(node.name, this.resolve(node.initializer));
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const value = this.resolve(node.right);
            if (value === "" && ts.isPropertyAccessExpression(node.left) && node.left.name.text === "exports") {
                this.registerModule(node);
            }
            this.bindAssignmentPattern(ts.isParenthesizedExpression(node.left) ? node.left.expression : node.left, value);
        } else if (ts.isImportDeclaration(node) && isVscodeLiteral(node.moduleSpecifier) && node.importClause !== undefined) {
            this.bindImport(node.importClause);
        } else if (ts.isCallExpression(node)) {
            this.bindIife(node);
            if (this.resolveCall(node) === "") this.apiFound = true;
        }
        if (this.collecting && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
            const parent = node.parent;
            const extended = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
            if (!extended) {
                const path = this.resolve(node);
                if (path !== null && path !== "") this.record(path);
            }
        }
        if (this.collecting && ts.isIdentifier(node) && !this.isDeclarationName(node)) {
            const path = this.current.lookup(node.text)?.path;
            if (path !== undefined && path !== null && path !== "") this.record(path);
        }
        ts.forEachChild(node, (child) => {
            this.flow(child);
        });
        this.current = saved;
    }

    /** Neither a property name nor a declaration is a use; the head of a chain is counted with the chain. */
    isDeclarationName(node) {
        const parent = node.parent;
        if (ts.isPropertyAccessExpression(parent)) return true;
        if (ts.isElementAccessExpression(parent) && parent.expression === node) return true;
        if (ts.isPropertyAssignment(parent) || ts.isBindingElement(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent)) return parent.name === node || parent.propertyName === node;
        return ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent);
    }

    bindImport(clause) {
        if (clause.name !== undefined) this.set(this.current.lookup(clause.name.text), "");
        const named = clause.namedBindings;
        if (named === undefined) return;
        if (ts.isNamespaceImport(named)) {
            this.set(this.current.lookup(named.name.text), "");
            return;
        }
        for (const e of named.elements) {
            this.set(this.current.lookup(e.name.text), (e.propertyName ?? e.name).text);
        }
    }

    /** `(function (v) { … })(require("vscode"))`: a rollup iife passes the API as a parameter. */
    bindIife(call) {
        let callee = call.expression;
        while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
        if (!ts.isFunctionExpression(callee) && !ts.isArrowFunction(callee)) return;
        const inner = this.scopes.get(callee);
        callee.parameters.forEach((parameter, index) => {
            const argument = call.arguments[index];
            if (argument === undefined || !ts.isIdentifier(parameter.name)) return;
            this.set(inner.bindings.get(parameter.name.text), this.resolve(argument));
        });
    }
}

/**
 * Members one JavaScript file touches. False positives are allowed, an absent member means "not
 * found", not "not used": a member reached through a value (`editor.document.getText()`) has no
 * syntactic link to the API, so instance members of interfaces stay unseen.
 *
 * @returns {{ apiFound: boolean, paths: Set<string> }}
 */
export function analyzeSource(source, fileName = "bundle.js") {
    if (!source.includes("vscode")) return { apiFound: false, paths: new Set() };
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    return new ApiUsageWalker(file).run();
}

/**
 * Maps raw paths to the surface: the longest known prefix wins (`window.activeTextEditor.document`
 * is `window.activeTextEditor`). A path under a namespace or a class that the surface does not know
 * (proposed API, a typo) is reported apart; anything else is a false hit on a same-named property.
 *
 * @param {Iterable<string>} paths
 * @param {Map<string, unknown>} surface
 */
export function toMembers(paths, surface) {
    const owners = new Set();
    for (const path of surface.keys()) owners.add(path.split(".")[0]);
    const members = new Set();
    const unknown = new Set();
    for (const path of paths) {
        const parts = path.split(".");
        let hit = null;
        for (let length = parts.length; length > 0 && hit === null; length--) {
            const prefix = parts.slice(0, length).join(".");
            if (surface.has(prefix)) hit = prefix;
        }
        if (hit !== null) members.add(hit);
        else if (parts.length > 1 && owners.has(parts[0])) unknown.add(parts.slice(0, 2).join("."));
    }
    return { members: [...members].sort(), unknown: [...unknown].sort() };
}
