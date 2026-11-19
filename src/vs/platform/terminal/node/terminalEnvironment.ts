// Upstream `src/vs/platform/terminal/node/terminalEnvironment.ts`, `getShellIntegrationInjection`: Linux/macOS
// bash, zsh, fish and pwsh. Not ported: the Windows branches (pwsh.exe, powershell.exe, git bash),
// `ignoreShellIntegration`/`forceShellIntegration` (no launch sets them), `VSCODE_SHELL_ENV_REPORTING` (it comes with
// the OSC 633 parsing), and upstream's zsh/fish check
// that passes its own injected args through by array identity (no caller hands them back here).

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
    /**
     * The directory holding `shellIntegration-*` (upstream `<appRoot>/out/vs/workbench/contrib/terminal/common/scripts`);
     * asked only for a shell that gets the scripts — the packaged build unpacks them on the first call.
     */
    scriptsDir(): string;
    /**
     * Upstream `addEnvMixinPathPrefix`: the extensions' joined `Prepend`s to `PATH` (absent with `strictEnv`); asked
     * only where a profile rebuilds `PATH` — fish always, bash and zsh login shells on macOS.
     */
    pathPrefix?(): string | undefined;
}

/** The `node:os` calls the injection makes; tests replace them. */
export interface IShellIntegrationHost {
    platform(): NodeJS.Platform;
    tmpdir(): string;
    userInfo(): { readonly username: string };
    homedir(): string;
}

const shLoginArgs = ["--login", "-l"];
const shInteractiveArgs = ["-i", "--interactive"];
const pwshLoginArgs = ["-login", "-l"];
const pwshImpliedArgs = ["-nol", "-nologo"];

/** A login flag alone, or next to an implied one (`-nologo`) in either order. */
function arePwshLoginArgs(originalArgs: readonly string[]): boolean {
    const args = originalArgs.map((arg) => arg.toLowerCase());
    if (args.length === 1) return pwshLoginArgs.includes(args[0]);
    return (
        args.length === 2 &&
        args.some((arg) => pwshLoginArgs.includes(arg)) &&
        args.some((arg) => pwshImpliedArgs.includes(arg))
    );
}

/** No arguments or only `-nologo`: pwsh starts as a plain interactive shell. */
function arePwshImpliedArgs(originalArgs: readonly string[]): boolean {
    return (
        originalArgs.length === 0 ||
        (originalArgs.length === 1 && pwshImpliedArgs.includes(originalArgs[0].toLowerCase()))
    );
}

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
    const addPathPrefix = (): void => {
        const prefix = options.pathPrefix?.();
        if (prefix !== undefined) envMixin.VSCODE_PATH_PREFIX = prefix;
    };
    const isMacintosh = host.platform() === "darwin";

    switch (path.basename(launch.executable)) {
        case "bash": {
            if (!isDefaultArgs && !isLoginArgs) return { type: "failure", reason: "unsupportedArgs" };
            if (isLoginArgs) {
                envMixin.VSCODE_SHELL_LOGIN = "1";
                if (isMacintosh) addPathPrefix();
            }
            // diode is a stable build: the insiders-only parts of the script stay off.
            envMixin.VSCODE_STABLE = "1";
            return {
                type: "injection",
                newArgs: ["--init-file", path.join(options.scriptsDir(), "shellIntegration-bash.sh")],
                envMixin,
                filesToCopy: [],
            };
        }
        case "fish": {
            if (!isDefaultArgs && !isLoginArgs) return { type: "failure", reason: "unsupportedArgs" };
            // fish prepends `fish_user_paths` for login and non-login shells alike.
            addPathPrefix();
            const source = `source "${path.join(options.scriptsDir(), "shellIntegration.fish")}"`;
            return {
                type: "injection",
                newArgs: [...(isLoginArgs ? ["-l"] : []), "--init-command", source],
                envMixin,
                filesToCopy: [],
            };
        }
        case "pwsh": {
            const isPwshLogin = arePwshLoginArgs(originalArgs);
            if (!isPwshLogin && !arePwshImpliedArgs(originalArgs))
                return { type: "failure", reason: "unsupportedArgs" };
            const dotSource = `. "${path.join(options.scriptsDir(), "shellIntegration.ps1")}"`;
            envMixin.VSCODE_STABLE = "1";
            return {
                type: "injection",
                newArgs: [...(isPwshLogin ? ["-l"] : []), "-noexit", "-command", dotSource],
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
            if (isLoginArgs && isMacintosh) addPathPrefix();
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
