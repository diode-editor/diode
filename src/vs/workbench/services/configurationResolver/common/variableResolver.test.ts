import * as paths from "node:path";

import { describe, expect, it } from "vitest";

import { VariableError } from "./configurationResolver.ts";
import { type IVariableResolveContext, resolveVariables } from "./variableResolver.ts";

const SETTINGS: Readonly<Record<string, unknown>> = { "a.str": "s", "a.num": 3, "a.obj": { x: 1 }, "a.null": null };
const FOLDERS: Readonly<Record<string, string>> = { proj: "/ws/proj", other: "/ws/other" };

function context(overrides: Partial<IVariableResolveContext> = {}): IVariableResolveContext {
    return {
        folderPath: "/ws/proj",
        getFolderPath: (name) => FOLDERS[name],
        workspaceFolderCount: 1,
        filePath: "/ws/proj/src/app.test.ts",
        fileFolderPath: "/ws/proj",
        lineNumber: 7,
        columnNumber: 3,
        getSelectedText: () => "sel",
        env: { HOME: "/home/u", EMPTY: "" },
        userHome: "/home/u",
        cwd: "/proc/cwd",
        execPath: "/opt/diode/diode",
        execInstallFolder: "/opt/diode",
        getConfiguration: (key) => SETTINGS[key],
        getExtensionLocation: (id) => (id === "pub.ext" ? "/ext/pub.ext-1.0.0" : undefined),
        ...overrides,
    };
}

const resolve = (value: string, overrides?: Partial<IVariableResolveContext>): string =>
    resolveVariables(value, () => context(overrides));

describe("resolveVariables — values", () => {
    it("workspace folder and its name (with deprecated aliases), a folder by name", () => {
        expect(resolve("${workspaceFolder}|${workspaceRoot}")).toBe("/ws/proj|/ws/proj");
        expect(resolve("${workspaceFolderBasename}|${workspaceRootFolderName}")).toBe("proj|proj");
        expect(resolve("${workspaceFolder:other}|${workspaceFolderBasename:other}")).toBe("/ws/other|other");
        // An empty name is no name (upstream's falsy argument).
        expect(resolve("${workspaceFolder:}")).toBe("/ws/proj");
        expect(resolve("${workspaceFolder:proj}", { folderPath: undefined })).toBe("/ws/proj");
    });

    it("active editor file and its parts", () => {
        expect(resolve("${file}")).toBe("/ws/proj/src/app.test.ts");
        expect(resolve("${fileBasename}")).toBe("app.test.ts");
        expect(resolve("${fileBasenameNoExtension}")).toBe("app.test");
        expect(resolve("${fileExtname}")).toBe(".ts");
        expect(resolve("${fileDirname}")).toBe("/ws/proj/src");
        expect(resolve("${fileDirnameBasename}")).toBe("src");
        expect(resolve("${fileWorkspaceFolder}|${fileWorkspaceFolderBasename}")).toBe("/ws/proj|proj");
        expect(resolve("${relativeFile}")).toBe(paths.join("src", "app.test.ts"));
        expect(resolve("${relativeFileDirname}")).toBe("src");
        expect(resolve("${lineNumber}:${columnNumber}")).toBe("7:3");
        expect(resolve("${selectedText}")).toBe("sel");
    });

    it("relative file: at the folder root '.'; against a named folder; without a folder — absolute paths", () => {
        expect(resolve("${relativeFileDirname}", { filePath: "/ws/proj/x.ts" })).toBe(".");
        expect(resolve("${relativeFile:other}", { folderPath: undefined })).toBe(
            paths.join("..", "proj", "src", "app.test.ts"),
        );
        expect(resolve("${relativeFileDirname:other}")).toBe(paths.join("..", "proj", "src"));
        expect(resolve("${relativeFile}|${relativeFileDirname}", { folderPath: undefined })).toBe(
            "/ws/proj/src/app.test.ts|/ws/proj/src",
        );
    });

    it("env: value, empty — empty, missing variable — empty", () => {
        expect(resolve("${env:HOME}|${env:EMPTY}|${env:NOPE}")).toBe("/home/u||");
    });

    it("config: string as is, number as text", () => {
        expect(resolve("${config:a.str}/${config:a.num}")).toBe("s/3");
    });

    it("cwd: with a folder — the folder (as upstream), without a folder — the process directory", () => {
        expect(resolve("${cwd}")).toBe("/ws/proj");
        expect(resolve("${cwd}", { folderPath: undefined })).toBe("/proc/cwd");
        expect(resolve("${cwd:other}", { folderPath: undefined })).toBe("/ws/other");
    });

    it("home directory, path separator, executable and its folder, extension folder", () => {
        expect(resolve("${userHome}")).toBe("/home/u");
        expect(resolve("${pathSeparator}${/}")).toBe(`${paths.sep}${paths.sep}`);
        expect(resolve("${execPath}|${execInstallFolder}")).toBe("/opt/diode/diode|/opt/diode");
        expect(resolve("${execPath}|${execInstallFolder}", { execPath: undefined, execInstallFolder: undefined })).toBe(
            "${execPath}|${execInstallFolder}",
        );
        expect(resolve("${extensionInstallFolder:pub.ext}")).toBe("/ext/pub.ext-1.0.0");
    });

    it("unknown variable, commands and inputs without values, text without variables — as is", () => {
        expect(resolve("${foo} ${workspaceFolder} $x {y} ${command:a.b} ${input:name} ${unclosed")).toBe(
            "${foo} /ws/proj $x {y} ${command:a.b} ${input:name} ${unclosed",
        );
    });

    it("acquired values come first, keyed by `name:arg`", () => {
        const values = new Map([
            ["input:name", "N"],
            ["command:pick", "42"],
            ["workspaceFolder", "/elsewhere"],
        ]);
        expect(resolveVariables("${input:name} ${command:pick} ${workspaceFolder}", () => context(), values)).toBe(
            "N 42 /elsewhere",
        );
    });

    it("a JSON tree: values at any depth and keys; other values untouched; the original is not changed", () => {
        const config = {
            name: "${env:HOME}",
            list: ["${workspaceFolderBasename}", 1, null, { deep: ["${lineNumber}"] }],
            env: { "${workspaceFolderBasename}_DIR": "${workspaceFolder}/out" },
            flag: true,
        };
        expect(resolveVariables(config, () => context())).toStrictEqual({
            name: "/home/u",
            list: ["proj", 1, null, { deep: ["7"] }],
            env: { proj_DIR: "/ws/proj/out" },
            flag: true,
        });
        expect(config.name).toBe("${env:HOME}");
    });

    it("a substituted value is resolved again, but not the variable that produced it (upstream #77289)", () => {
        const env = { A: "${env:B}!", B: "b", SELF: "x${env:SELF}" };
        expect(resolve("${env:A}|${env:SELF}", { env })).toBe("b!|x${env:SELF}");
    });
});

describe("resolveVariables — refusals (upstream texts)", () => {
    const fails = (value: string, message: string, overrides?: Partial<IVariableResolveContext>): void => {
        expect(() => resolve(value, overrides)).toThrow(new VariableError(message));
    };

    it("no editor — file variables", () => {
        for (const name of [
            "file",
            "fileBasename",
            "fileBasenameNoExtension",
            "fileExtname",
            "fileDirname",
            "fileDirnameBasename",
            "fileWorkspaceFolder",
            "relativeFile",
            "relativeFileDirname",
        ]) {
            fails(`\${${name}}`, `Variable \${${name}} can not be resolved. Please open an editor.`, {
                filePath: undefined,
            });
        }
    });

    it("a file outside the folders — its folder variables", () => {
        for (const name of ["fileWorkspaceFolder", "fileWorkspaceFolderBasename"]) {
            fails(`\${${name}}`, `Variable \${${name}}: can not find workspace folder of 'app.test.ts'.`, {
                fileFolderPath: undefined,
            });
        }
    });

    it("no folder — folder variables; several folders; unknown folder name", () => {
        fails("${workspaceFolder}", "Variable workspaceFolder can not be resolved. Please open a folder.", {
            folderPath: undefined,
        });
        fails(
            "${workspaceFolderBasename}",
            "Variable workspaceFolderBasename can not be resolved. Please open a folder.",
            { folderPath: undefined },
        );
        fails(
            "${workspaceFolder}",
            "Variable workspaceFolder can not be resolved in a multi folder workspace. Scope this variable using ':' and a workspace folder name.",
            { folderPath: undefined, workspaceFolderCount: 2 },
        );
        fails("${workspaceFolder:nope}", "Variable workspaceFolder can not be resolved. No such folder 'nope'.");
        fails("${cwd:x}", "Variable cwd can not be resolved. No such folder 'x'.", { folderPath: undefined });
        fails("${relativeFile:x}", "Variable relativeFile can not be resolved. No such folder 'x'.");
        fails("${relativeFileDirname:x}", "Variable relativeFileDirname can not be resolved. No such folder 'x'.");
    });

    it("env, config and extension without a name; config not found or structured; extension not installed", () => {
        fails("${env}", "Variable ${env} can not be resolved because no environment variable name is given.");
        fails("${env:}", "Variable ${env:} can not be resolved because no environment variable name is given.");
        fails("${config}", "Variable ${config} can not be resolved because no settings name is given.");
        fails("${config:}", "Variable ${config:} can not be resolved because no settings name is given.");
        fails("${config:a.none}", "Variable ${config:a.none} can not be resolved because setting 'a.none' not found.");
        fails("${config:a.null}", "Variable ${config:a.null} can not be resolved because setting 'a.null' not found.");
        fails("${config:a.obj}", "Variable ${config:a.obj} can not be resolved because 'a.obj' is a structured value.");
        fails(
            "${extensionInstallFolder}",
            "Variable ${extensionInstallFolder} can not be resolved because no extension name is given.",
        );
        fails(
            "${extensionInstallFolder:x.y}",
            "Variable ${extensionInstallFolder:x.y} can not be resolved because the extension x.y is not installed.",
        );
    });

    it("no home directory, no cursor, no selection", () => {
        fails("${userHome}", "Variable ${userHome} can not be resolved. UserHome path is not defined", {
            userHome: undefined,
        });
        fails(
            "${lineNumber}",
            "Variable ${lineNumber} can not be resolved. Make sure to have a line selected in the active editor.",
            { lineNumber: undefined },
        );
        fails(
            "${columnNumber}",
            "Variable ${columnNumber} can not be resolved. Make sure to have a column selected in the active editor.",
            { columnNumber: undefined },
        );
        for (const selectedText of [undefined, ""]) {
            fails(
                "${selectedText}",
                "Variable ${selectedText} can not be resolved. Make sure to have some text selected in the active editor.",
                { getSelectedText: () => selectedText },
            );
        }
    });
});
