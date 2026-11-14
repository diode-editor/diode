import { describe, expect, it } from "vitest";

import {
    LanguageModelChatMessage,
    LanguageModelChatMessageRole,
    LanguageModelChatToolMode,
    LanguageModelDataPart,
    LanguageModelError,
    LanguageModelPromptTsxPart,
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResult,
    LanguageModelToolResultPart,
    McpHttpServerDefinition,
    McpStdioServerDefinition,
} from "./lmTypes.ts";
import { Uri } from "./vscodeTypes.ts";

const decode = (data: Uint8Array): string => new TextDecoder().decode(data);

describe("vscode.lm value types — per upstream", () => {
    it("enums", () => {
        expect([LanguageModelChatMessageRole.User, LanguageModelChatMessageRole.Assistant]).toEqual([1, 2]);
        expect([LanguageModelChatToolMode.Auto, LanguageModelChatToolMode.Required]).toEqual([1, 2]);
    });

    it("a tool result carries its parts as given", () => {
        const text = new LanguageModelTextPart("frames: 3");
        const tsx = new LanguageModelPromptTsxPart({ node: 1 });
        const result = new LanguageModelToolResult([text, tsx]);
        expect(result.content).toEqual([{ value: "frames: 3" }, { value: { node: 1 } }]);
        expect(new LanguageModelToolCallPart("c1", "codelldb", { a: 1 })).toEqual({
            callId: "c1",
            name: "codelldb",
            input: { a: 1 },
        });
        expect(new LanguageModelToolResultPart("c1", [text])).toEqual({ callId: "c1", content: [text] });
    });

    it("data parts: image as is, text and json encoded as UTF-8 with default mime types", () => {
        const bytes = new Uint8Array([1, 2]);
        expect(LanguageModelDataPart.image(bytes, "image/png")).toEqual({ data: bytes, mimeType: "image/png" });
        const text = LanguageModelDataPart.text("é");
        expect([decode(text.data), text.mimeType]).toEqual(["é", "text/plain"]);
        const json = LanguageModelDataPart.json({ a: [1] });
        expect([decode(json.data), json.mimeType]).toEqual(['{\n\t"a": [\n\t\t1\n\t]\n}', "text/x-json"]);
        expect(LanguageModelDataPart.text("x", "text/markdown").mimeType).toBe("text/markdown");
        expect(LanguageModelDataPart.json(1, "application/json").mimeType).toBe("application/json");
    });

    it("chat message: a string becomes one text part; User/Assistant set the role", () => {
        const user = LanguageModelChatMessage.User("hi", "me");
        expect(user.role).toBe(LanguageModelChatMessageRole.User);
        expect(user.content).toEqual([new LanguageModelTextPart("hi")]);
        expect(user.content[0]).toBeInstanceOf(LanguageModelTextPart);
        expect(user.name).toBe("me");
        const parts = [new LanguageModelTextPart("a")];
        const assistant = LanguageModelChatMessage.Assistant(parts);
        expect(assistant.role).toBe(LanguageModelChatMessageRole.Assistant);
        expect(assistant.content).toBe(parts);
        expect(assistant.name).toBeUndefined();
        (assistant as { content: unknown }).content = "again";
        expect(assistant.content).toEqual([new LanguageModelTextPart("again")]);
    });

    it("errors: the code names the factory, name is LanguageModelError, the cause is kept", () => {
        const cause = new Error("net");
        const errors = [
            LanguageModelError.NotFound("m"),
            LanguageModelError.NoPermissions("m"),
            LanguageModelError.Blocked("m"),
        ];
        expect(errors.map((e) => e.code)).toEqual(["NotFound", "NoPermissions", "Blocked"]);
        for (const error of errors) {
            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe("LanguageModelError");
            expect(error.message).toBe("m");
        }
        expect(new LanguageModelError().code).toBe("");
        expect(new LanguageModelError("x", { cause }).cause).toBe(cause);
    });

    it("MCP server definitions: empty defaults for args, env and headers", () => {
        const stdio = new McpStdioServerDefinition("srv", "node");
        expect(stdio).toMatchObject({ label: "srv", command: "node", args: [], env: {}, version: undefined });
        const full = new McpStdioServerDefinition("srv", "node", ["a"], { K: 1 }, "2");
        expect(full).toMatchObject({ args: ["a"], env: { K: 1 }, version: "2" });
        const uri = Uri.parse("https://example.com/mcp");
        expect(new McpHttpServerDefinition("web", uri)).toMatchObject({ label: "web", uri, headers: {} });
        expect(new McpHttpServerDefinition("web", uri, { A: "b" }, "1")).toMatchObject({
            headers: { A: "b" },
            version: "1",
        });
    });
});
