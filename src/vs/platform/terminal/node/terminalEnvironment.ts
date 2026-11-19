// Upstream `src/vs/platform/terminal/node/terminalEnvironment.ts`, `getShellIntegrationInjection`: Linux/macOS
// bash and zsh. Not ported: the Windows branches (pwsh.exe, git bash), fish and pwsh (the next issue of the chain),
// `ignoreShellIntegration`/`forceShellIntegration` (no launch sets them), `VSCODE_PATH_PREFIX` (comes with the
// environment API).

import { chmodSync, mkdirSync, realpathSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isFileNotFound } from "../../../base/node/fsErrors.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

/** Upstream `productService.applicationName`: the zsh `ZDOTDIR` is `<tmp>/<user>-diode-zsh`. */
const APPLICATION_NAME = "diode";

/** Upstream `ShellIntegrationInjectionFailureReason` without the Windows build and the ignore flag. */
export type ShellIntegrationInjectionFailureReason =
    | "injectionSettingDisabled"
    | "noExecutable"
    | "featureTerminal"
    | "unsupportedArgs"
    | "unsupportedShell"
    | "failedToSetStickyBit"
    | "failedToCreateTmpDir";

export interface IShellIntegrationConfigInjection {
    readonly type: "injection";
    readonly newArgs: readonly string[];
    readonly envMixin: Readonly<Record<string, string>>;
    /** Copied by the process before the spawn (zsh's rc files; none for bash); a failed copy is ignored. */
    readonly filesToCopy: readonly { readonly source: string; readonly dest: string }[];
}

export interface IShellIntegrationInjectionFailure {
    readonly type: "failure";
    readonly reason: ShellIntegrationInjectionFailureReason;
}

export interface IShellIntegrationLaunchConfig {
    readonly executable: string | undefined;
    readonly args: readonly string[] | undefined;
    /** A task terminal: upstream `isFeatureTerminal`. */
    readonly isFeatureTerminal?: boolean;
}

export interface IShellIntegrationOptions {
    /** `terminal.integrated.shellIntegration.enabled`. */
    readonly enabled: boolean;
    /** `terminal.integrated.shellIntegration.environmentReporting`. */
    readonly environmentReporting?: boolean;
    /**
     * The directory holding `shellIntegration-*` (upstream `<appRoot>/out/vs/workbench/contrib/terminal/common/scripts`);
     * asked only for a shell that gets the scripts — the packaged build unpacks them on the first call.
     */
    scriptsDir(): string;
}

/** The `node:os` calls the zsh branch makes; tests replace them. */
export interface IShellIntegrationHost {
    tmpdir(): string;
    userInfo(): { readonly username: string };
    homedir(): string;
}

const SHELL_ENV_REPORTING_KEYS = "PATH,VIRTUAL_ENV,HOME,SHELL,PWD";

const shLoginArgs = ["--login", "-l"];
const shInteractiveArgs = ["-i", "--interactive"];

function areZshBashFishLoginArgs(originalArgs: readonly string[]): boolean {
    const args = originalArgs.filter((arg) => !shInteractiveArgs.includes(arg.toLowerCase()));
    return args.length === 1 && shLoginArgs.includes(args[0].toLowerCase());
}

/**
 * Arguments that replace the shell's own and an environment mixin that make the shell run the upstream script.
 * `env` is the terminal's resulting environment: its `ZDOTDIR` is the user's one for zsh.
 */
export function getShellIntegrationInjection(
    launch: IShellIntegrationLaunchConfig,
    options: IShellIntegrationOptions,
    env: Readonly<Record<string, string | undefined>>,
    logger: ILogger,
    host: IShellIntegrationHost = os,
): IShellIntegrationConfigInjection | IShellIntegrationInjectionFailure {
    if (!options.enabled) return { type: "failure", reason: "injectionSettingDisabled" };
    if (launch.executable === undefined || launch.executable === "") return { type: "failure", reason: "noExecutable" };
    if (launch.isFeatureTerminal === true) return { type: "failure", reason: "featureTerminal" };

    const originalArgs = launch.args ?? [];
    const isDefaultArgs = originalArgs.length === 0;
    const isLoginArgs = areZshBashFishLoginArgs(originalArgs);
    const envMixin: Record<string, string> = { VSCODE_INJECTION: "1" };
    // Upstream: "Temporarily pass list of hardcoded env vars for shell env api".
    if (options.environmentReporting === true) envMixin.VSCODE_SHELL_ENV_REPORTING = SHELL_ENV_REPORTING_KEYS;

    switch (path.basename(launch.executable)) {
        case "bash": {
            if (!isDefaultArgs && !isLoginArgs) return { type: "failure", reason: "unsupportedArgs" };
            if (isLoginArgs) envMixin.VSCODE_SHELL_LOGIN = "1";
            // diode is a stable build: the insiders-only parts of the script stay off.
            envMixin.VSCODE_STABLE = "1";
            return {
                type: "injection",
                newArgs: ["--init-file", path.join(options.scriptsDir(), "shellIntegration-bash.sh")],
                envMixin,
                filesToCopy: [],
            };
        }
        case "zsh": {
            if (!isDefaultArgs && !isLoginArgs) return { type: "failure", reason: "unsupportedArgs" };
            const zdotdir = zdotdirOf(host, logger);
            if (zdotdir === undefined) return { type: "failure", reason: "failedToCreateTmpDir" };
            const failure = ensureZdotdir(zdotdir, logger);
            if (failure !== undefined) return { type: "failure", reason: failure };
            envMixin.ZDOTDIR = zdotdir;
            envMixin.USER_ZDOTDIR = env.ZDOTDIR ?? host.homedir();
            const scriptsDir = options.scriptsDir();
            const copy = (script: string, dest: string) => ({
                source: path.join(scriptsDir, `shellIntegration-${script}`),
                dest: path.join(zdotdir, dest),
            });
            return {
                type: "injection",
                newArgs: isLoginArgs ? ["-il"] : ["-i"],
                envMixin,
                filesToCopy: [
                    copy("rc.zsh", ".zshrc"),
                    copy("profile.zsh", ".zprofile"),
                    copy("env.zsh", ".zshenv"),
                    copy("login.zsh", ".zlogin"),
                ],
            };
        }
    }
    logger.warn(`Shell integration cannot be enabled for executable "${launch.executable}" and args`, launch.args);
    return { type: "failure", reason: "unsupportedShell" };
}

/** The real tmp directory, so the sticky bit is set on it, not on a link. Upstream throws here; we fail the injection. */
function zdotdirOf(host: IShellIntegrationHost, logger: ILogger): string | undefined {
    let username: string;
    try {
        username = host.userInfo().username;
    } catch {
        username = "unknown";
    }
    try {
        return path.join(realpathSync(host.tmpdir()), `${username}-${APPLICATION_NAME}-zsh`);
    } catch (err) {
        logger.error(`Failed to resolve the temp directory: ${String(err)}`);
        return undefined;
    }
}

/**
 * `0o1700`: only the owner reads it, and the sticky bit keeps others from replacing its files. Deviation: upstream
 * reports `failedToSetStickyBit` even after creating the directory, so its first zsh ever starts without shell
 * integration; here a created directory is used.
 */
function ensureZdotdir(zdotdir: string, logger: ILogger): ShellIntegrationInjectionFailureReason | undefined {
    try {
        chmodSync(zdotdir, 0o1700);
        return undefined;
    } catch (err) {
        if (!isFileNotFound(err)) {
            logger.error(`Failed to set sticky bit on ${zdotdir}: ${String(err)}`);
            return "failedToSetStickyBit";
        }
    }
    try {
        mkdirSync(zdotdir);
        chmodSync(zdotdir, 0o1700);
        return undefined;
    } catch (err) {
        logger.error(`Failed to create zdotdir at ${zdotdir}: ${String(err)}`);
        return "failedToCreateTmpDir";
    }
}
