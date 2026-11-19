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
const WAIT = { timeout: 10_000, interval: 50 };
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

const { Prepend, Replace } = EnvironmentVariableMutatorType;

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

describe("applyAtShellIntegration — live bash and zsh", () => {
    for (const [name, shell, rc] of [
        ["bash", BASH, ".bashrc"],
        ["zsh", ZSH ?? "", ".zshrc"],
    ] as const) {
        it.skipIf(shell === "")(
            `${name}: a Prepend to PATH survives the rc file's \`export PATH=…\`; a value with ':', spaces and unicode arrives intact`,
            async () => {
                writeFileSync(path.join(home, rc), `export PATH=${RC_PATH}\n`);
                const session = start(shell, {
                    "x.y": [
                        mutator(Prepend, "PATH", "/opt/x/bin:"),
                        mutator(Replace, "DIODE_GREETING", "héllo wörld ✓: a:b"),
                    ],
                });
                // `$((…))` keeps the expected text out of the echoed command line.
                await run(session, 'echo "p$((1))=$PATH"', `p1=/opt/x/bin:${RC_PATH}`);
                await run(session, 'echo "g$((1))=$DIODE_GREETING"', "g1=héllo wörld ✓: a:b");
            },
            30_000,
        );

        it.skipIf(shell === "")(
            `${name}: Python activation runs only when ms-python.vscode-python-envs set it`,
            async () => {
                const activate = `VSCODE_PYTHON_${name.toUpperCase()}_ACTIVATE`;
                const allowed = start(shell, { [PYTHON_ENVS]: [mutator(Replace, activate, "export ACTIVATED=1")] });
                await run(allowed, 'echo "a$((1))=[$ACTIVATED]"', "a1=[1]");
                const blocked = start(shell, { "other.ext": [mutator(Replace, activate, "export ACTIVATED=1")] });
                await run(blocked, 'echo "a$((1))=[$ACTIVATED]"', "a1=[]");
            },
            30_000,
        );
    }
});

describe.skipIf(FISH === undefined)("applyAtShellIntegration — live fish", () => {
    it("VSCODE_PATH_PREFIX: a Prepend to PATH stays in front of what config.fish puts there", async () => {
        const config = path.join(home, ".config", "fish", "config.fish");
        mkdirSync(path.dirname(config), { recursive: true });
        writeFileSync(config, "set -gx PATH /usr/bin /bin\n");
        // Process creation as well, as an extension does by default: the prefix re-applies it after the profile.
        const session = start(FISH ?? "", {
            "x.y": [mutator(Prepend, "PATH", "/opt/x/bin:", {})],
        });
        await run(session, 'echo "p"(math 0+1)"=$PATH"', "p1=/opt/x/bin:/usr/bin:/bin");
    }, 30_000);
});
