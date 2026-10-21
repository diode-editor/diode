import { describe, expect, it } from "vitest";

import {
    hasWorkspaceFileExtension,
    type IWorkspaceFileReader,
    loadWorkspaceFile,
    parseWorkspaceFile,
    WorkspaceFileError,
    workspaceFileLabel,
} from "./workspaceFile.ts";

const FILE = "/repo/web.code-workspace";

function parse(content: unknown): ReturnType<typeof parseWorkspaceFile> {
    return parseWorkspaceFile(typeof content === "string" ? content : JSON.stringify(content), FILE);
}

function failure(content: unknown): string {
    try {
        parse(content);
    } catch (err) {
        expect(err).toBeInstanceOf(WorkspaceFileError);
        return (err as Error).message;
    }
    throw new Error("parse did not fail");
}

describe("parseWorkspaceFile", () => {
    // The main scenario: workspace files sit at the monorepo root and point at it,
    // so `"."` resolves against the FILE's directory, not the process cwd.
    it("a relative path is resolved against the file's directory", () => {
        expect(parse({ folders: [{ path: "." }] }).folder).toBe("/repo");
        expect(parse({ folders: [{ path: "packages/web" }] }).folder).toBe("/repo/packages/web");
        expect(parse({ folders: [{ path: "../other" }] }).folder).toBe("/other");
    });

    it("an absolute path is taken as is (normalized)", () => {
        expect(parse({ folders: [{ path: "/abs/dir/" }] }).folder).toBe("/abs/dir");
    });

    it("a folder can be given as a file uri, as upstream allows", () => {
        expect(parse({ folders: [{ uri: "file:///abs/my%20dir" }] }).folder).toBe("/abs/my dir");
    });

    it("a folder's name is its display name; empty or non-string means no name", () => {
        expect(parse({ folders: [{ path: ".", name: "Web" }] }).folderName).toBe("Web");
        expect(parse({ folders: [{ path: "." }] }).folderName).toBeUndefined();
        expect(parse({ folders: [{ path: ".", name: "" }] }).folderName).toBeUndefined();
        expect(parse({ folders: [{ path: ".", name: 1 }] }).folderName).toBeUndefined();
    });

    it("JSONC: comments and a trailing comma", () => {
        const text = `{
            // monorepo folder
            "folders": [{ "path": "." },],
            "settings": { "editor.tabSize": 2, },
        }`;
        expect(parse(text).folder).toBe("/repo");
    });

    it("broken JSON is rejected with the file path and error location", () => {
        expect(failure('{ "folders": [ }')).toMatch(
            /^Invalid workspace file \/repo\/web\.code-workspace: \w+ at offset \d+$/,
        );
    });

    it("no folders is rejected", () => {
        const expected = "Workspace file /repo/web.code-workspace has no folders";
        expect(failure({})).toBe(expected);
        expect(failure({ folders: [] })).toBe(expected);
        expect(failure({ folders: "." })).toBe(expected);
        expect(failure("[]")).toBe(expected);
        expect(failure("null")).toBe(expected);
        expect(failure("1")).toBe(expected);
    });

    // No multi-root: silently taking the first folder would open something other than
    // what the user expects, so refuse with an explanation.
    it("more than one folder is rejected as unsupported multi-root", () => {
        expect(failure({ folders: [{ path: "a" }, { path: "b" }] })).toBe(
            "Workspace file /repo/web.code-workspace lists 2 folders: multi-root workspaces are not supported yet, a workspace file must have exactly one folder",
        );
    });

    it("a folder entry without path or file uri is rejected", () => {
        const expected = 'Workspace file /repo/web.code-workspace: a folder entry must have a "path" or a file "uri"';
        expect(failure({ folders: [{}] })).toBe(expected);
        expect(failure({ folders: [{ path: "" }] })).toBe(expected);
        expect(failure({ folders: [{ uri: "vscode-remote://host/dir" }] })).toBe(expected);
        expect(failure({ folders: [{ uri: 1 }] })).toBe(expected);
        expect(failure({ folders: ["."] })).toBe(expected);
        expect(failure({ folders: [null] })).toBe(expected);
    });
});

describe("loadWorkspaceFile", () => {
    function reader(files: Record<string, string>, dirs: readonly string[]): IWorkspaceFileReader {
        return {
            readText: (filePath) =>
                filePath in files ? Promise.resolve(files[filePath]) : Promise.reject(new Error("ENOENT")),
            isDirectory: (filePath) => Promise.resolve(dirs.includes(filePath)),
        };
    }

    it("reads, parses and checks that the folder exists", async () => {
        const contents = await loadWorkspaceFile(
            FILE,
            reader({ [FILE]: '{ "folders": [{ "path": "." }] }' }, ["/repo"]),
        );
        expect(contents).toEqual({ folder: "/repo", folderName: undefined });
    });

    it("missing file is rejected with its path", async () => {
        await expect(loadWorkspaceFile(FILE, reader({}, []))).rejects.toThrow(
            new WorkspaceFileError("Workspace file does not exist or cannot be read: /repo/web.code-workspace"),
        );
    });

    it("a folder from the file missing on disk is rejected with both paths", async () => {
        const files = { [FILE]: '{ "folders": [{ "path": "gone" }] }' };
        await expect(loadWorkspaceFile(FILE, reader(files, ["/repo"]))).rejects.toThrow(
            new WorkspaceFileError("Workspace folder does not exist: /repo/gone (from /repo/web.code-workspace)"),
        );
    });

    it("a parse failure is passed through as is", async () => {
        await expect(loadWorkspaceFile(FILE, reader({ [FILE]: "{}" }, ["/repo"]))).rejects.toBeInstanceOf(
            WorkspaceFileError,
        );
    });
});

describe("hasWorkspaceFileExtension", () => {
    it("recognizes a workspace file by its extension", () => {
        expect(hasWorkspaceFileExtension("/repo/web.code-workspace")).toBe(true);
        expect(hasWorkspaceFileExtension("web.code-workspace")).toBe(true);
        expect(hasWorkspaceFileExtension("/repo/web.json")).toBe(false);
        expect(hasWorkspaceFileExtension("/repo/code-workspace")).toBe(false);
        expect(hasWorkspaceFileExtension("/repo/web.code-workspace.bak")).toBe(false);
    });
});

describe("workspaceFileLabel", () => {
    it("base name without the extension", () => {
        expect(workspaceFileLabel("/repo/web.code-workspace")).toBe("web");
        expect(workspaceFileLabel("/repo/my.app.code-workspace")).toBe("my.app");
    });
});
