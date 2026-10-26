import { describe, expect, it } from "vitest";

import {
    configFileBaseName,
    configFileFromProjectInfo,
    inferredProjectConfigText,
    isImplicitProjectConfigFile,
    JS_TS_LANGUAGE_IDS,
    projectTypeForLanguage,
    workspaceRootForFile,
} from "./projectConfig.ts";

describe("diode-lsp-typescript — project config", () => {
    it("the project type follows the language: React flavours included, anything else has none", () => {
        expect(JS_TS_LANGUAGE_IDS).toEqual(["javascript", "javascriptreact", "typescript", "typescriptreact"]);
        expect(JS_TS_LANGUAGE_IDS.map(projectTypeForLanguage)).toEqual([
            "javascript",
            "javascript",
            "typescript",
            "typescript",
        ]);
        expect(projectTypeForLanguage("json")).toBeUndefined();
        expect(projectTypeForLanguage("jsonc")).toBeUndefined();
        expect(projectTypeForLanguage("constructor")).toBeUndefined();
    });

    it("an inferred project is the one tsserver names under /dev/null/", () => {
        expect(isImplicitProjectConfigFile("/dev/null/inferredProject1*")).toBe(true);
        expect(isImplicitProjectConfigFile("/proj/jsconfig.json")).toBe(false);
        expect(isImplicitProjectConfigFile("/proj/dev/null/tsconfig.json")).toBe(false);
    });

    it("the config file is jsconfig.json for JavaScript, tsconfig.json for TypeScript", () => {
        expect(configFileBaseName("javascript")).toBe("jsconfig.json");
        expect(configFileBaseName("typescript")).toBe("tsconfig.json");
    });

    it("the jsconfig template is upstream's snippet at default settings, without the tab stop", () => {
        expect(inferredProjectConfigText("javascript")).toBe(`{
\t"compilerOptions": {
\t\t"module": "ESNext",
\t\t"moduleResolution": "Bundler",
\t\t"target": "ES2024",
\t\t"jsx": "react-jsx",
\t\t"allowImportingTsExtensions": true,
\t\t"checkJs": false,
\t\t"experimentalDecorators": false,
\t\t"strictNullChecks": true,
\t\t"strictFunctionTypes": true,
\t\t"strict": true
\t},
\t"exclude": [
\t\t"node_modules",
\t\t"**/node_modules/*"
\t]
}`);
    });

    it("the tsconfig template has no allowImportingTsExtensions and adds sourceMap", () => {
        expect(inferredProjectConfigText("typescript")).toBe(`{
\t"compilerOptions": {
\t\t"module": "ESNext",
\t\t"moduleResolution": "Bundler",
\t\t"target": "ES2024",
\t\t"jsx": "react-jsx",
\t\t"checkJs": false,
\t\t"experimentalDecorators": false,
\t\t"strictNullChecks": true,
\t\t"strictFunctionTypes": true,
\t\t"strict": true,
\t\t"sourceMap": true
\t},
\t"exclude": [
\t\t"node_modules",
\t\t"**/node_modules/*"
\t]
}`);
    });

    it("projectInfo's config file comes from tsserver's raw response body", () => {
        expect(
            configFileFromProjectInfo({
                seq: 0,
                type: "response",
                command: "projectInfo",
                success: true,
                body: { configFileName: "/proj/jsconfig.json", languageServiceDisabled: false },
            }),
        ).toBe("/proj/jsconfig.json");
    });

    it.each([
        ["no answer", undefined],
        ["null", null],
        ["a string", "response"],
        ["an event", { type: "event", body: { configFileName: "/proj/jsconfig.json" } }],
        ["an error response", { type: "response", success: false, message: "No Project." }],
        ["a null body", { type: "response", body: null }],
        ["a body that is not an object", { type: "response", body: "/proj/jsconfig.json" }],
        ["a body without a config file", { type: "response", body: { languageServiceDisabled: false } }],
        ["a config file that is not a string", { type: "response", body: { configFileName: 1 } }],
    ])("projectInfo gives no config file for %s", (_what, response) => {
        expect(configFileFromProjectInfo(response)).toBeUndefined();
    });

    it("the workspace root of a file is the highest folder that contains it", () => {
        const roots = ["/proj/packages/app", "/proj", "/other"];
        expect(workspaceRootForFile(roots, "/proj/packages/app/src/a.js")).toBe("/proj");
        expect(workspaceRootForFile(["/proj/packages/app"], "/proj/packages/app/src/a.js")).toBe("/proj/packages/app");
        expect(workspaceRootForFile(roots, "/other/a.js")).toBe("/other");
        expect(roots).toEqual(["/proj/packages/app", "/proj", "/other"]);
    });

    it("a folder is a root only for files inside it, not for a sibling with the same prefix", () => {
        expect(workspaceRootForFile(["/proj"], "/project/a.js")).toBeUndefined();
        expect(workspaceRootForFile(["/proj"], "/proj")).toBeUndefined();
        expect(workspaceRootForFile([], "/proj/a.js")).toBeUndefined();
    });

    it("a root given with a trailing separator still contains its files", () => {
        expect(workspaceRootForFile(["/"], "/a.js")).toBe("/");
        expect(workspaceRootForFile(["/proj/"], "/proj/a.js")).toBe("/proj/");
    });
});
