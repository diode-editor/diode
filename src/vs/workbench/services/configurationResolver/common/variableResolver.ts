// Upstream's `AbstractVariableResolverService.evaluateSingleVariable`, synchronous: our editor, workspace and
// extension lookups are. An unknown `${foo}` stays as is; so do `${command:…}` and `${input:…}` without an
// acquired value (they need interaction, `ConfigurationResolverService.resolveWithInteraction`).

import * as paths from "node:path";

import { VariableError } from "./configurationResolver.ts";
import { ConfigurationResolverExpression, type IReplacement } from "./configurationResolverExpression.ts";

/** A snapshot of what the variables refer to, taken for one resolution. */
export interface IVariableResolveContext {
    /** The folder of the configuration being resolved (upstream's `folderUri`). */
    readonly folderPath: string | undefined;
    /** `${workspaceFolder:name}`. */
    getFolderPath(name: string): string | undefined;
    readonly workspaceFolderCount: number;
    /** The active editor's file. */
    readonly filePath: string | undefined;
    /** The workspace folder of {@link filePath}. */
    readonly fileFolderPath: string | undefined;
    /** 1-based. */
    readonly lineNumber: number | undefined;
    /** 1-based. */
    readonly columnNumber: number | undefined;
    /** Of the primary selection; empty — none. Read only for `${selectedText}`: a selection may be huge. */
    getSelectedText(): string | undefined;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly userHome: string | undefined;
    readonly cwd: string;
    readonly execPath: string | undefined;
    /** Upstream's application root, `${execInstallFolder}`. */
    readonly execInstallFolder: string | undefined;
    getConfiguration(key: string): unknown;
    getExtensionLocation(id: string): string | undefined;
}

/**
 * Resolves the variables of a copy of `config` (a string or a JSON tree); `values` (keyed `name:arg`) come first:
 * the commands and inputs acquired with interaction. The context is taken once, on the first variable `values`
 * does not have.
 */
export function resolveVariables<T>(
    config: T,
    context: () => IVariableResolveContext,
    values: ReadonlyMap<string, string> = new Map(),
): T {
    const expression = ConfigurationResolverExpression.parse(config);
    let snapshot: IVariableResolveContext | undefined;
    for (const replacement of expression.unresolved()) {
        const value = values.get(replacement.inner) ?? evaluateVariable(replacement, (snapshot ??= context()));
        expression.resolve(replacement, value);
    }
    return expression.toObject();
}

/** The variable's value; for one it does not know, its own text. */
export function evaluateVariable(replacement: IReplacement, context: IVariableResolveContext): string {
    const { id, name, arg } = replacement;
    const argument = arg === "" ? undefined : arg;

    const filePath = (): string => {
        if (context.filePath !== undefined) return context.filePath;
        throw new VariableError(`Variable ${id} can not be resolved. Please open an editor.`);
    };
    const fileFolderPath = (): string => {
        const file = filePath();
        if (context.fileFolderPath !== undefined) return context.fileFolderPath;
        throw new VariableError(`Variable ${id}: can not find workspace folder of '${paths.basename(file)}'.`);
    };
    const folderPath = (kind: string): string => {
        if (argument !== undefined) {
            const folder = context.getFolderPath(argument);
            if (folder !== undefined) return folder;
            throw new VariableError(`Variable ${kind} can not be resolved. No such folder '${argument}'.`);
        }
        if (context.folderPath !== undefined) return context.folderPath;
        if (context.workspaceFolderCount > 1) {
            throw new VariableError(
                `Variable ${kind} can not be resolved in a multi folder workspace. Scope this variable using ':' and a workspace folder name.`,
            );
        }
        throw new VariableError(`Variable ${kind} can not be resolved. Please open a folder.`);
    };
    const scoped = context.folderPath !== undefined || argument !== undefined;

    switch (name) {
        case "env":
            if (argument === undefined) {
                throw new VariableError(
                    `Variable ${id} can not be resolved because no environment variable name is given.`,
                );
            }
            return context.env[argument] ?? "";
        case "config":
            return configValue(id, argument, context);
        case "extensionInstallFolder": {
            if (argument === undefined) {
                throw new VariableError(`Variable ${id} can not be resolved because no extension name is given.`);
            }
            const location = context.getExtensionLocation(argument);
            if (location !== undefined) return location;
            throw new VariableError(
                `Variable ${id} can not be resolved because the extension ${argument} is not installed.`,
            );
        }
        case "workspaceRoot":
        case "workspaceFolder":
            return folderPath("workspaceFolder");
        case "workspaceRootFolderName":
        case "workspaceFolderBasename":
            return paths.basename(folderPath("workspaceFolderBasename"));
        case "cwd":
            return scoped ? folderPath("cwd") : context.cwd;
        case "userHome":
            if (context.userHome !== undefined) return context.userHome;
            throw new VariableError(`Variable ${id} can not be resolved. UserHome path is not defined`);
        case "lineNumber":
            if (context.lineNumber !== undefined) return String(context.lineNumber);
            throw new VariableError(
                `Variable ${id} can not be resolved. Make sure to have a line selected in the active editor.`,
            );
        case "columnNumber":
            if (context.columnNumber !== undefined) return String(context.columnNumber);
            throw new VariableError(
                `Variable ${id} can not be resolved. Make sure to have a column selected in the active editor.`,
            );
        case "selectedText": {
            const selectedText = context.getSelectedText();
            if (selectedText) return selectedText;
            throw new VariableError(
                `Variable ${id} can not be resolved. Make sure to have some text selected in the active editor.`,
            );
        }
        case "file":
            return filePath();
        case "fileWorkspaceFolder":
            return fileFolderPath();
        case "fileWorkspaceFolderBasename":
            return paths.basename(fileFolderPath());
        case "relativeFile":
            return scoped ? paths.relative(folderPath("relativeFile"), filePath()) : filePath();
        case "relativeFileDirname": {
            const dirname = paths.dirname(filePath());
            if (!scoped) return dirname;
            const relative = paths.relative(folderPath("relativeFileDirname"), dirname);
            return relative.length === 0 ? "." : relative;
        }
        case "fileDirname":
            return paths.dirname(filePath());
        case "fileExtname":
            return paths.extname(filePath());
        case "fileBasename":
            return paths.basename(filePath());
        case "fileBasenameNoExtension": {
            const basename = paths.basename(filePath());
            return basename.slice(0, basename.length - paths.extname(basename).length);
        }
        case "fileDirnameBasename":
            return paths.basename(paths.dirname(filePath()));
        case "execPath":
            return context.execPath ?? id;
        case "execInstallFolder":
            return context.execInstallFolder ?? id;
        case "pathSeparator":
        case "/":
            return paths.sep;
        default:
            return id;
    }
}

function configValue(id: string, key: string | undefined, context: IVariableResolveContext): string {
    if (key === undefined) {
        throw new VariableError(`Variable ${id} can not be resolved because no settings name is given.`);
    }
    const value = context.getConfiguration(key);
    if (value === undefined || value === null) {
        throw new VariableError(`Variable ${id} can not be resolved because setting '${key}' not found.`);
    }
    if (typeof value === "object") {
        throw new VariableError(`Variable ${id} can not be resolved because '${key}' is a structured value.`);
    }
    return typeof value === "string" ? value : JSON.stringify(value);
}
