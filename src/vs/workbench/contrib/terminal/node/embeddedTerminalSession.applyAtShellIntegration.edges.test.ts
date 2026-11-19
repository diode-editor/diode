import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findShell, PROMPT_START, RecordingSession } from "../../../../../TestUtils/shellIntegrationSession.ts";
import {
    EnvironmentVariableMutatorType,
    type IEnvironmentVariableMutator,
    MergedEnvironmentVariableCollection,
} from "../../../../platform/terminal/common/environmentVariable.ts";
import { createExtensionEnvironmentContributor } from "../common/extensionEnvironment.ts";

import type { EmbeddedTerminalOptions } from "./embeddedTerminalSession.ts";

// Live shells: the collections go through the real merge and the upstream scripts apply `VSCODE_ENV_*` after the
// user's rc files. fish is skipped where it is not installed (CI installs it).
const BASH = "/bin/bash";
const ZSH = findShell("zsh");
const FISH = findShell("fish");
const PWSH = findShell("pwsh");
const WAIT = { timeout: 20_000, interval: 50 };
const PYTHON_ENVS = "ms-python.vscode-python-envs";
const AT_SHELL = { applyAtProcessCreation: false, applyAtShellIntegration: true };
/** What the user's rc file resets `PATH` to. */
const RC_PATH = "/usr/bin:/bin";

let home: string;
let tmp: string;
const sessions: RecordingSession[] = [];

beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "diode-si-env-home-"));
    tmp = mkdtempSync(path.join(os.tmpdir(), "diode-si-env-tmp-"));
    // The zsh ZDOTDIR goes here, not into the machine's /tmp.
    vi.stubEnv("TMPDIR", tmp);
});
afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

type Mutators = Record<string, readonly IEnvironmentVariableMutator[]>;

const { Append, Prepend, Replace } = EnvironmentVariableMutatorType;

function mutator(
    type: EnvironmentVariableMutatorType,
    variable: string,
    value: string,
    options: IEnvironmentVariableMutator["options"] = AT_SHELL,
): IEnvironmentVariableMutator {
    return { variable, value, type, options };
}

function start(shell: string, collections: Mutators, options: Partial<EmbeddedTerminalOptions> = {}): RecordingSession {
    const merged = new MergedEnvironmentVariableCollection(
        new Map(
            Object.entries(collections).map(([id, mutators]) => [
                id,
                { map: new Map(mutators.map((m) => [m.variable, m])) },
            ]),
        ),
    );
    const workspace = { getWorkspace: () => ({ folders: [] }) as never, getWorkspaceFolder: () => null };
    const session = new RecordingSession(
        {
            cols: 200,
            rows: 10,
            cwd: home,
            shell,
            shellIntegrationEnabled: true,
            env: {
                HOME: home,
                HISTFILE: "/dev/null",
                ZDOTDIR: home,
                skip_global_compinit: "1",
                XDG_CONFIG_HOME: path.join(home, ".config"),
                XDG_DATA_HOME: path.join(home, ".local/share"),
                fish_history: "",
                POWERSHELL_TELEMETRY_OPTOUT: "1",
                POWERSHELL_UPDATECHECK: "Off",
            },
            ...options,
        },
        createExtensionEnvironmentContributor(() => merged, workspace, false),
    );
    sessions.push(session);
    return session;
}

async function run(session: RecordingSession, command: string, expected: string): Promise<void> {
    await vi.waitFor(() => {
        expect(session.raw).toContain(PROMPT_START);
    }, WAIT);
    session.write(`${command}\r`);
    await vi.waitFor(() => {
        expect(session.raw).toContain(expected);
    }, WAIT);
}

function rc(relative: string, content: string): void {
    const file = path.join(home, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
}

describe("applyAtShellIntegration — edges, bash and zsh", () => {
    for (const [name, shell, rcFile] of [
        ["bash", BASH, ".bashrc"],
        ["zsh", ZSH ?? "", ".zshrc"],
    ] as const) {
        it.skipIf(shell === "")(
            `${name}: an Append to PATH lands after what the rc file set`,
            async () => {
                rc(rcFile, `export PATH=${RC_PATH}\n`);
                const session = start(shell, { "x.y": [mutator(Append, "PATH", ":/opt/tail/bin")] });
                await run(session, 'echo "p$((1))=$PATH"', `p1=${RC_PATH}:/opt/tail/bin\r`);
            },
            30_000,
        );

        it.skipIf(shell === "")(
            `${name}: a Replace whose value holds '=' arrives intact`,
            async () => {
                const session = start(shell, { "x.y": [mutator(Replace, "DIODE_OPTS", "--flag=a=b --x")] });
                await run(session, 'echo "o$((1))=[$DIODE_OPTS]"', "o1=[--flag=a=b --x]");
            },
            30_000,
        );

        it.skipIf(shell === "")(
            `${name}: two extensions prepending PATH end up in the same order as at process creation`,
            async () => {
                const atCreation = start(shell, {
                    "a.one": [mutator(Prepend, "PATH", "/opt/one:", {})],
                    "b.two": [mutator(Prepend, "PATH", "/opt/two:", {})],
                });
                await run(atCreation, 'echo "c$((1))=$PATH"', "c1=/opt/");
                const created = /c1=(\/opt\/\w+:\/opt\/\w+:)/.exec(atCreation.raw)?.[1];
                rc(rcFile, `export PATH=${RC_PATH}\n`);
                const atShell = start(shell, {
                    "a.one": [mutator(Prepend, "PATH", "/opt/one:")],
                    "b.two": [mutator(Prepend, "PATH", "/opt/two:")],
                });
                await run(atShell, 'echo "s$((1))=$PATH"', `s1=${created ?? "?"}${RC_PATH}\r`);
            },
            30_000,
        );

        it.skipIf(shell === "")(
            `${name}: the editor started from a terminal that already auto-activated (guard inherited) still activates`,
            async () => {
                vi.stubEnv("VSCODE_PYTHON_AUTOACTIVATE_GUARD", "1");
                const activate = `VSCODE_PYTHON_${name.toUpperCase()}_ACTIVATE`;
                const session = start(shell, { [PYTHON_ENVS]: [mutator(Replace, activate, "export ACTIVATED=1")] });
                await run(session, 'echo "a$((1))=[$ACTIVATED]"', "a1=[1]");
            },
            30_000,
        );

        it.skipIf(shell === "")(
            `${name}: the VSCODE_ENV_* carriers do not leak into the shell's children`,
            async () => {
                const session = start(shell, { "x.y": [mutator(Prepend, "PATH", "/opt/x/bin:")] });
                await run(session, 'echo "e$((1))=[${VSCODE_ENV_PREPEND-}]"', "e1=[]");
            },
            30_000,
        );
    }

    it("bash: shell integration off — the at-shell-integration Prepend does not reach PATH", async () => {
        rc(".bashrc", `export PATH=${RC_PATH}\nPS1='diode$ '\n`);
        const session = start(
            BASH,
            { "x.y": [mutator(Prepend, "PATH", "/opt/x/bin:")] },
            { shellIntegrationEnabled: false },
        );
        await vi.waitFor(() => {
            expect(session.raw).toContain("diode$");
        }, WAIT);
        session.write('echo "p$((1))=$PATH"\r');
        await vi.waitFor(() => {
            expect(session.raw).toContain(`p1=${RC_PATH}\r`);
        }, WAIT);
    }, 30_000);
});

describe.skipIf(FISH === undefined)("applyAtShellIntegration — edges, fish", () => {
    const fish = FISH ?? "";

    it("fish: a Replace with ':', spaces and unicode arrives intact", async () => {
        const session = start(fish, { "x.y": [mutator(Replace, "DIODE_GREETING", "привет, мир: a:b")] });
        await run(session, 'echo "g"(math 0+1)"=$DIODE_GREETING"', "g1=привет, мир: a:b");
    }, 30_000);

    it("fish: an at-shell-integration-only Prepend to PATH survives config.fish", async () => {
        rc(".config/fish/config.fish", "set -gx PATH /usr/bin /bin\n");
        const session = start(fish, { "x.y": [mutator(Prepend, "PATH", "/opt/x/bin:")] });
        await run(session, 'echo "p"(math 0+1)"=$PATH"', "p1=/opt/x/bin");
    }, 30_000);

    // Upstream fish applies VSCODE_ENV_* on the first prompt, after the activation block: the variable goes in at process creation.
    it("fish: Python activation runs only when ms-python.vscode-python-envs set it", async () => {
        const allowed = start(fish, {
            [PYTHON_ENVS]: [mutator(Replace, "VSCODE_PYTHON_FISH_ACTIVATE", "set -gx ACTIVATED 1", {})],
        });
        await run(allowed, 'echo "a"(math 0+1)"=[$ACTIVATED]"', "a1=[1]");
        const blocked = start(fish, {
            "other.ext": [mutator(Replace, "VSCODE_PYTHON_FISH_ACTIVATE", "set -gx ACTIVATED 1", {})],
        });
        await run(blocked, 'echo "a"(math 0+1)"=[$ACTIVATED]"', "a1=[]");
    }, 30_000);

    it("fish: a VSCODE_PATH_PREFIX inherited by the editor does not end up in PATH", async () => {
        vi.stubEnv("VSCODE_PATH_PREFIX", "/opt/stale:");
        rc(".config/fish/config.fish", "set -gx PATH /usr/bin /bin\n");
        const session = start(fish, {});
        await run(session, 'echo "p"(math 0+1)"=$PATH"', "p1=/usr/bin:/bin\r");
    }, 30_000);
});

describe.skipIf(PWSH === undefined)("applyAtShellIntegration — edges, pwsh", () => {
    const pwsh = PWSH ?? "";

    it("pwsh: a Prepend to PATH survives the profile's `$env:PATH = …`", async () => {
        rc(".config/powershell/Microsoft.PowerShell_profile.ps1", `$env:PATH = '${RC_PATH}'\n`);
        const session = start(pwsh, { "x.y": [mutator(Prepend, "PATH", "/opt/x/bin:")] });
        await run(session, '"p" + (0+1) + "=" + $env:PATH', `p1=/opt/x/bin:${RC_PATH}`);
    }, 60_000);

    it("pwsh: Python activation runs only when ms-python.vscode-python-envs set it", async () => {
        const allowed = start(pwsh, {
            [PYTHON_ENVS]: [mutator(Replace, "VSCODE_PYTHON_PWSH_ACTIVATE", "$env:ACTIVATED = '1'")],
        });
        await run(allowed, '"a" + (0+1) + "=[" + $env:ACTIVATED + "]"', "a1=[1]");
        const blocked = start(pwsh, {
            "other.ext": [mutator(Replace, "VSCODE_PYTHON_PWSH_ACTIVATE", "$env:ACTIVATED = '1'")],
        });
        await run(blocked, '"a" + (0+1) + "=[" + $env:ACTIVATED + "]"', "a1=[]");
    }, 60_000);
});
