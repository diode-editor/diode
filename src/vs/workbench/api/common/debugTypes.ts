import type * as vscode from "vscode";

/**
 * Дебаггера нет, но расширения конструируют эти классы сами (`golang.go` —
 * `new DebugAdapterServer(port)`) — без значения падал бы уже `new`.
 */

export enum DebugConsoleMode {
    Separate = 0,
    MergeWithParent = 1,
}

export enum DebugConfigurationProviderTriggerKind {
    Initial = 1,
    Dynamic = 2,
}

export class Breakpoint implements vscode.Breakpoint {
    private ownId: string | undefined;

    public readonly enabled: boolean;
    public readonly condition?: string;
    public readonly hitCondition?: string;
    public readonly logMessage?: string;
    public readonly mode?: string;

    protected constructor(
        enabled?: boolean,
        condition?: string,
        hitCondition?: string,
        logMessage?: string,
        mode?: string,
    ) {
        this.enabled = typeof enabled === "boolean" ? enabled : true;
        if (typeof condition === "string") this.condition = condition;
        if (typeof hitCondition === "string") this.hitCondition = hitCondition;
        if (typeof logMessage === "string") this.logMessage = logMessage;
        if (typeof mode === "string") this.mode = mode;
    }

    /** Ленивый, как у эталона: id точки стабилен на всё время жизни. */
    public get id(): string {
        this.ownId ??= globalThis.crypto.randomUUID();
        return this.ownId;
    }
}

export class SourceBreakpoint extends Breakpoint implements vscode.SourceBreakpoint {
    public readonly location: vscode.Location;

    public constructor(
        location: vscode.Location,
        enabled?: boolean,
        condition?: string,
        hitCondition?: string,
        logMessage?: string,
        mode?: string,
    ) {
        super(enabled, condition, hitCondition, logMessage, mode);
        // JS-расширение может передать что угодно; эталон проверяет ровно null.
        if ((location as vscode.Location | null) === null) throw new Error("Illegal argument: location");
        this.location = location;
    }
}

export class FunctionBreakpoint extends Breakpoint implements vscode.FunctionBreakpoint {
    public readonly functionName: string;

    public constructor(
        functionName: string,
        enabled?: boolean,
        condition?: string,
        hitCondition?: string,
        logMessage?: string,
        mode?: string,
    ) {
        super(enabled, condition, hitCondition, logMessage, mode);
        this.functionName = functionName;
    }
}

export class DebugAdapterExecutable implements vscode.DebugAdapterExecutable {
    public readonly command: string;
    public readonly args: string[];
    public readonly options?: vscode.DebugAdapterExecutableOptions;

    public constructor(command: string, args?: string[], options?: vscode.DebugAdapterExecutableOptions) {
        this.command = command;
        this.args = args ?? [];
        this.options = options;
    }
}

export class DebugAdapterServer implements vscode.DebugAdapterServer {
    public constructor(
        public readonly port: number,
        public readonly host?: string,
    ) {}
}

export class DebugAdapterNamedPipeServer implements vscode.DebugAdapterNamedPipeServer {
    public constructor(public readonly path: string) {}
}

export class DebugAdapterInlineImplementation implements vscode.DebugAdapterInlineImplementation {
    public constructor(public readonly implementation: vscode.DebugAdapter) {}
}

export class DebugThread implements vscode.DebugThread {
    public constructor(
        public readonly session: vscode.DebugSession,
        public readonly threadId: number,
    ) {}
}

export class DebugStackFrame implements vscode.DebugStackFrame {
    public constructor(
        public readonly session: vscode.DebugSession,
        public readonly threadId: number,
        public readonly frameId: number,
    ) {}
}
