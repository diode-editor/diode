import type * as vscode from "vscode";

/**
 * There are no language models in Diode, but extensions build these values themselves (a tool
 * returns `new LanguageModelToolResult([new LanguageModelTextPart(...)])`, an MCP provider returns
 * `new McpStdioServerDefinition(...)`). Shapes follow upstream `extHostTypes.ts`; the `toJSON`
 * marshalling there serves the main-thread RPC, which Diode does not have for these values.
 */

export enum LanguageModelChatMessageRole {
    User = 1,
    Assistant = 2,
}

export enum LanguageModelChatToolMode {
    Auto = 1,
    Required = 2,
}

export class LanguageModelTextPart implements vscode.LanguageModelTextPart {
    public constructor(public value: string) {}
}

export class LanguageModelPromptTsxPart implements vscode.LanguageModelPromptTsxPart {
    public constructor(public value: unknown) {}
}

export class LanguageModelDataPart implements vscode.LanguageModelDataPart {
    public static image(data: Uint8Array, mimeType: string): LanguageModelDataPart {
        return new LanguageModelDataPart(data, mimeType);
    }

    public static json(value: unknown, mime = "text/x-json"): LanguageModelDataPart {
        return LanguageModelDataPart.text(JSON.stringify(value, undefined, "\t"), mime);
    }

    public static text(value: string, mime = "text/plain"): LanguageModelDataPart {
        return new LanguageModelDataPart(new TextEncoder().encode(value), mime);
    }

    public constructor(
        public data: Uint8Array,
        public mimeType: string,
    ) {}
}

export class LanguageModelToolCallPart implements vscode.LanguageModelToolCallPart {
    public constructor(
        public callId: string,
        public name: string,
        public input: object,
    ) {}
}

export class LanguageModelToolResultPart implements vscode.LanguageModelToolResultPart {
    public constructor(
        public callId: string,
        public content: unknown[],
    ) {}
}

export class LanguageModelToolResult implements vscode.LanguageModelToolResult {
    public constructor(public content: unknown[]) {}
}

export class LanguageModelChatMessage implements vscode.LanguageModelChatMessage {
    public static User(content: string | vscode.LanguageModelInputPart[], name?: string): LanguageModelChatMessage {
        return new LanguageModelChatMessage(LanguageModelChatMessageRole.User, content, name);
    }

    public static Assistant(
        content: string | vscode.LanguageModelInputPart[],
        name?: string,
    ): LanguageModelChatMessage {
        return new LanguageModelChatMessage(LanguageModelChatMessageRole.Assistant, content, name);
    }

    private parts: vscode.LanguageModelInputPart[];
    public name: string | undefined;

    public constructor(
        public role: vscode.LanguageModelChatMessageRole,
        content: string | vscode.LanguageModelInputPart[],
        name?: string,
    ) {
        this.parts = toParts(content);
        this.name = name;
    }

    // Upstream keeps accepting a string here: the property used to be `string`.
    public set content(value: string | vscode.LanguageModelInputPart[]) {
        this.parts = toParts(value);
    }

    public get content(): vscode.LanguageModelInputPart[] {
        return this.parts;
    }
}

function toParts(content: string | vscode.LanguageModelInputPart[]): vscode.LanguageModelInputPart[] {
    return typeof content === "string" ? [new LanguageModelTextPart(content)] : content;
}

export class LanguageModelError extends Error implements vscode.LanguageModelError {
    public static NotFound(message?: string): LanguageModelError {
        return new LanguageModelError(message, undefined, "NotFound");
    }

    public static NoPermissions(message?: string): LanguageModelError {
        return new LanguageModelError(message, undefined, "NoPermissions");
    }

    public static Blocked(message?: string): LanguageModelError {
        return new LanguageModelError(message, undefined, "Blocked");
    }

    public readonly code: string;

    // `Error`'s signature, as `vscode.d.ts` declares it; upstream passes the code positionally instead.
    public constructor(message?: string, options?: ErrorOptions, code?: string) {
        super(message, options);
        this.name = "LanguageModelError";
        this.code = code ?? "";
    }
}

export class McpStdioServerDefinition implements vscode.McpStdioServerDefinition {
    public cwd?: vscode.Uri;

    public constructor(
        public label: string,
        public command: string,
        public args: string[] = [],
        public env: Record<string, string | number | null> = {},
        public version?: string,
    ) {}
}

export class McpHttpServerDefinition implements vscode.McpHttpServerDefinition {
    public constructor(
        public label: string,
        public uri: vscode.Uri,
        public headers: Record<string, string> = {},
        public version?: string,
    ) {}
}
