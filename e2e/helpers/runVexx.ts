import * as pty from "node-pty";
import type WebSocket from "ws";

import type { GetDocumentResult, NodeSnapshot } from "@tuidom/inspector/protocol";

import { AnsiScreen } from "./AnsiScreen.ts";
import { getBinaryPath } from "./buildOnce.ts";
import { hermeticSpawnEnv } from "./hermeticEnv.ts";
import { connectWithRetry, freePort, getDocument } from "./inspectorClient.ts";

export interface VexxSessionOptions {
    args: string[];
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    /**
     * Working directory for the spawned process. Extensions see this as
     * `workspace.workspaceFolders[0]` (the extension host derives folders from
     * `process.cwd()`), which matters e.g. for `EditorConfig.generate`.
     */
    cwd?: string;
    /**
     * Start the real app with the TUIDom inspector enabled. The harness picks a
     * free port, injects `--inspect-tui=127.0.0.1:<port>` into the args and lets
     * assertions read the live document tree via {@link VexxSession.getDocument}
     * / {@link VexxSession.waitForDocument} — no ANSI-screen parsing needed.
     */
    inspect?: boolean;
    /**
     * Бинарь, который запускаем. По умолчанию — SEA (`getBinaryPath()`).
     * Переопределяется, чтобы прогнать те же сценарии против self-extract-сборки
     * (см. `getSelfExtractPath()` и `selfextract.test.ts`).
     */
    binary?: string;
}

/**
 * Wraps a `node-pty` spawn of the SEA binary, accumulates stdout for ANSI
 * parsing and provides convenience methods for e2e assertions.
 */
export class VexxSession {
    public readonly cols: number;
    public readonly rows: number;
    /** Port the TUIDom inspector listens on, or `null` when `inspect` was not set. */
    public readonly inspectorPort: number | null;
    private readonly term: pty.IPty;
    private buffer = "";
    private exited = false;
    private exitCode: number | null = null;
    private readonly waiters: Array<() => void> = [];
    private inspectorWs: WebSocket | null = null;

    public static async start(options: VexxSessionOptions): Promise<VexxSession> {
        const binary = options.binary ?? (await getBinaryPath());
        const cols = options.cols ?? 120;
        const rows = options.rows ?? 32;
        // Терминальная идентичность (TERM, маркеры kitty/tmux/ssh) пинуется к
        // детерминированному baseline — иначе keyboard-tier и вывод зависят от
        // машины, на которой гоняется e2e (см. hermeticEnv.ts).
        const env = hermeticSpawnEnv(options.env);

        // Launch exactly like the other e2e tests; when inspecting, the only
        // difference is an injected --inspect-tui flag on a free loopback port.
        const args = [...options.args];
        let inspectorPort: number | null = null;
        if (options.inspect === true) {
            inspectorPort = await freePort();
            args.push(`--inspect-tui=127.0.0.1:${String(inspectorPort)}`);
        }

        const term = pty.spawn(binary, args, {
            name: "xterm-256color",
            cols,
            rows,
            env,
            ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        });
        return new VexxSession(term, cols, rows, inspectorPort);
    }

    private constructor(term: pty.IPty, cols: number, rows: number, inspectorPort: number | null) {
        this.term = term;
        this.cols = cols;
        this.rows = rows;
        this.inspectorPort = inspectorPort;
        this.term.onData((data) => {
            this.buffer += data;
            for (const w of this.waiters.splice(0)) w();
        });
        this.term.onExit(({ exitCode }) => {
            this.exited = true;
            this.exitCode = exitCode;
            for (const w of this.waiters.splice(0)) w();
        });
    }

    public get isExited(): boolean {
        return this.exited;
    }

    public get code(): number | null {
        return this.exitCode;
    }

    public getRawOutput(): string {
        return this.buffer;
    }

    public parseScreen(): AnsiScreen {
        const screen = new AnsiScreen(this.cols, this.rows);
        screen.feed(this.buffer);
        return screen;
    }

    public write(input: string): void {
        if (!this.exited) this.term.write(input);
    }

    /**
     * Resolves once `predicate(parsedScreen)` returns true AND there are no new
     * bytes for `stableMs`. Throws on timeout.
     */
    public async waitFor(
        predicate: (screen: AnsiScreen) => boolean,
        opts: { timeoutMs?: number; stableMs?: number } = {},
    ): Promise<AnsiScreen> {
        const timeoutMs = opts.timeoutMs ?? (process.platform === "win32" ? 30_000 : 10_000);
        const stableMs = opts.stableMs ?? 150;
        const deadline = Date.now() + timeoutMs;
        // On Windows, ConPTY can inject clearing sequences after each resize that
        // cause the app's delta renderer to miss cells. Do up to 5 resize cycles so
        // the app eventually resets prevGrid and issues a full redraw that lands
        // AFTER the ConPTY injections have settled. The 1.2 s sleep after the
        // second resize gives ConPTY and the app enough time to finish.
        let winKicksLeft = process.platform === "win32" ? 5 : 0;
        let winNextKickAt = process.platform === "win32" ? Date.now() + 500 : Infinity;

        while (Date.now() < deadline) {
            const screen = this.parseScreen();
            if (predicate(screen)) {
                // Wait for quiescence to make sure the frame is fully flushed.
                const sizeBefore = this.buffer.length;
                await sleep(stableMs);
                if (this.buffer.length === sizeBefore) {
                    return this.parseScreen();
                }
                continue;
            }
            if (winKicksLeft > 0 && Date.now() >= winNextKickAt) {
                winKicksLeft--;
                winNextKickAt = Date.now() + 4000; // space kicks ≥ 4 s apart
                this.term.resize(this.cols, this.rows + 1);
                await sleep(300); // let ConPTY inject for this resize
                this.term.resize(this.cols, this.rows);
                await sleep(1200); // let ConPTY inject for reverse, then app re-renders
                continue;
            }
            await this.waitForData(Math.max(50, deadline - Date.now()));
        }
        throw new Error(
            `waitFor timed out after ${String(timeoutMs)}ms.\n--- screen ---\n${this.parseScreen().toString()}\n--- raw (last 500 chars) ---\n${JSON.stringify(this.buffer.slice(-500))}`,
        );
    }

    /** Lazily open (and cache) the inspector WebSocket, retrying until it's up. */
    private async ensureInspector(): Promise<WebSocket> {
        if (this.inspectorPort === null) {
            throw new Error("VexxSession was started without { inspect: true }");
        }
        if (this.inspectorWs === null) {
            this.inspectorWs = await connectWithRetry(`ws://127.0.0.1:${String(this.inspectorPort)}`, 20_000);
        }
        return this.inspectorWs;
    }

    /** Fetch the current document tree from the inspector. Requires `inspect: true`. */
    public async getDocument(): Promise<GetDocumentResult> {
        const ws = await this.ensureInspector();
        return getDocument(ws);
    }

    /**
     * Poll the inspector's document tree until `predicate(root)` holds, then
     * return the matching root. The inspector-side analogue of {@link waitFor}.
     */
    public async waitForDocument(
        predicate: (root: NodeSnapshot) => boolean,
        opts: { timeoutMs?: number; intervalMs?: number } = {},
    ): Promise<NodeSnapshot> {
        const timeoutMs = opts.timeoutMs ?? 10_000;
        const intervalMs = opts.intervalMs ?? 100;
        const deadline = Date.now() + timeoutMs;
        let lastRootType = "<null>";
        while (Date.now() < deadline) {
            const { root } = await this.getDocument();
            if (root !== null) {
                lastRootType = root.type;
                if (predicate(root)) return root;
            }
            await sleep(intervalMs);
        }
        throw new Error(`waitForDocument timed out after ${String(timeoutMs)}ms (last root: ${lastRootType})`);
    }

    private waitForData(timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                resolve();
            };
            this.waiters.push(finish);
            setTimeout(finish, timeoutMs);
        });
    }

    /** Send Ctrl+C and wait for process exit (or kill after fallback timeout). */
    public async dispose(graceMs = 2000): Promise<void> {
        if (this.inspectorWs !== null) {
            try {
                this.inspectorWs.close();
            } catch {
                // already closed
            }
            this.inspectorWs = null;
        }
        if (!this.exited) {
            try {
                this.term.write("\x03");
            } catch {
                // ignore
            }
            await this.waitForExit(graceMs);
        }
        if (!this.exited) {
            try {
                this.term.kill("SIGTERM");
            } catch {
                // ignore
            }
            await this.waitForExit(500);
        }
        if (!this.exited) {
            try {
                this.term.kill("SIGKILL");
            } catch {
                // ignore
            }
            // On Windows node-pty's kill() closes the ConPTY handle but may not
            // immediately fire onExit. Also signal the process directly by PID.
            if (process.platform === "win32") {
                try {
                    process.kill(this.term.pid);
                } catch {
                    // ignore — process may have already exited
                }
            }
            await this.waitForExit(1000);
        }
        // If onExit still hasn't fired (can happen on Windows when ConPTY
        // terminates the process without propagating the exit event), mark the
        // session as disposed so callers are not left hanging.
        if (!this.exited) {
            this.exited = true;
            for (const w of this.waiters.splice(0)) w();
        }
    }

    public waitForExit(timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            if (this.exited) {
                resolve();
                return;
            }
            const finish = () => {
                resolve();
            };
            this.waiters.push(finish);
            setTimeout(finish, timeoutMs);
        });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
