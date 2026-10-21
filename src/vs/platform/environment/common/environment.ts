import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Like vscode's `IEnvironmentService`, **keep the interface as small as possible**: only what
 * services outside bootstrap need. Paths are absolute strings, not URIs.
 * The profile is fixed per process (switching means a window reload), so its resources
 * live here; vscode switches profiles on the fly.
 */
export interface IEnvironmentService {
    readonly userDataRoot: string;
    readonly extensionsDir: string;
    readonly logsDir: string;
    /** `undefined` means the public Diode marketplace. */
    readonly registry: string | undefined;
    /** For `~` in user-typed paths. */
    readonly userHome: string;

    readonly settingsResource: string;
    readonly keybindingsResource: string;
    readonly globalStorageDir: string;
    readonly workspaceStorageDir: string;
    readonly secretsFile: string;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string inside is just a debug label
export const IEnvironmentServiceDIToken = token<IEnvironmentService>("EnvironmentService");
