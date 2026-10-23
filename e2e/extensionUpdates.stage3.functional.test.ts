import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import {
    cliOk,
    createNamedProfile,
    defaultProfileFile,
    namedProfileFile,
    obsoleteKeys,
    versionDirs,
} from "./helpers/extensionsDisk.ts";
import { frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * QA of ExtensionUpdates stage 3 (docs/TODO/ExtensionUpdates.md, "stage 3 spec") from the outside: the window talks
 * to the fixture registry over HTTP, so every request is counted and any path can fail. The edge cases the
 * implementer's suite (`extensionsAutoUpdate.functional.test.ts`) does not cover; a comment "QA report, bug N" marks a found bug,
 * fixed in the same PR.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE = resolve(here, "marketplace", "sample-extension");
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;

/** 1.0.0 and 1.1.0, both published long ago. */
const A = "test.qa3-a";
const B = "test.qa3-b";
/** 1.1.0 published thirty minutes before the suite starts. */
const FRESH = "test.qa3-fresh";
/** 1.1.0 with a `publishedAt` a day in the future (clock skew): no delay. */
const FUTURE = "test.qa3-future";
/** 1.1.0 without `publishedAt`: no delay. */
const NODATE = "test.qa3-nodate";
/** 1.1.0 declares a wrong sha256: its install fails. */
const CORRUPT = "test.qa3-corrupt";
/** Only in the registry, never installed. */
const NOT_INSTALLED = "test.qa3-notinstalled";

let root: string;
/** The fixture as a directory: the CLI seeds from it. */
let registryDir: string;
let registry: FixtureRegistryServer;
let seeds = 0;

/**
 * The fixture directory over HTTP: the window's registry. `path` artifacts become `url` ones (the HTTP source
 * takes only those). Requests are logged; `fail` answers 500 to a path a number of times; `offline` drops all.
 */
class FixtureRegistryServer {
    public readonly requests: string[] = [];
    public offline = false;
    private readonly failures = new Map<string, number>();
    private server!: Server;
    public url = "";

    public constructor(private readonly dir: string) {}

    public async listen(): Promise<void> {
        this.server = createServer((req, res) => {
            this.handle(req, res);
        });
        await new Promise<void>((resolveListen) => this.server.listen(0, "127.0.0.1", resolveListen));
        this.url = `http://127.0.0.1:${String((this.server.address() as AddressInfo).port)}/`;
    }

    public close(): Promise<void> {
        return new Promise((resolveClose) => this.server.close(() => resolveClose()));
    }

    public fail(path: string, times = Number.POSITIVE_INFINITY): void {
        this.failures.set(path, times);
    }

    /** Requests of one path, a query string included. */
    public count(path: string): number {
        return this.requests.filter((r) => r === path).length;
    }

    private handle(req: IncomingMessage, res: ServerResponse): void {
        const path = (req.url ?? "/").split("?")[0]!;
        this.requests.push(path);
        if (this.offline) {
            req.socket.destroy();
            return;
        }
        const left = this.failures.get(path) ?? 0;
        if (left > 0) {
            this.failures.set(path, left - 1);
            res.writeHead(500).end("injected failure");
            return;
        }
        const file = normalize(join(this.dir, path));
        if (!file.startsWith(this.dir)) {
            res.writeHead(403).end();
            return;
        }
        let body: Buffer;
        try {
            body = readFileSync(file);
        } catch {
            res.writeHead(404).end();
            return;
        }
        if (path.startsWith("/meta/")) {
            const meta = JSON.parse(body.toString("utf8")) as {
                versions: { artifact: { type: string; path?: string; url?: string } }[];
            };
            for (const version of meta.versions) {
                if (version.artifact.type === "path") {
                    version.artifact = { type: "url", url: `${this.url}${version.artifact.path!}` };
                }
            }
            body = Buffer.from(JSON.stringify(meta));
        }
        res.writeHead(200).end(body);
    }
}

function pageId(id: string): string {
    return id.replaceAll(".", "-");
}

interface IEntry {
    identifier: { id: string };
    version: string;
    metadata?: { pinned?: boolean };
}

function readEntries(file: string): IEntry[] {
    return JSON.parse(readFileSync(file, "utf8")) as IEntry[];
}

/** Entries of the test extensions as `id@version pinned=…`, sorted by id. */
function describeProfile(file: string): string[] {
    return readEntries(file)
        .filter((e) => e.identifier.id.startsWith("test.qa3-"))
        .map((e) => `${e.identifier.id}@${e.version} pinned=${String(e.metadata?.pinned ?? false)}`)
        .sort();
}

function profile(app: HeadlessApp): string[] {
    return describeProfile(defaultProfileFile(app.env.userDataDir));
}

/** `ids` at 1.0.0 as if installed from the marketplace earlier: the CLI pins a given version, the pin is taken off. */
async function seed(
    ids: readonly string[],
    options: { pinned?: readonly string[]; profileB?: boolean } = {},
): Promise<string> {
    const dir = join(root, `seed-${String(++seeds)}`);
    const profileArgs = options.profileB === true ? ["--profile", "B"] : [];
    if (options.profileB === true) createNamedProfile(dir, "B");
    for (const id of ids) {
        await cliOk([
            "--user-data-dir",
            dir,
            "--registry",
            registryDir,
            ...profileArgs,
            "--install-extension",
            `${id}@1.0.0`,
        ]);
    }
    const file = options.profileB === true ? namedProfileFile(dir, "B") : defaultProfileFile(dir);
    const entries = readEntries(file).map((e) =>
        options.pinned?.includes(e.identifier.id) === true ? e : { ...e, metadata: { ...e.metadata, pinned: false } },
    );
    writeFileSync(file, JSON.stringify(entries));
    return dir;
}

interface IStartOptions {
    readonly seedUserData: string;
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly extraArgs?: readonly string[];
    readonly root?: string;
}

async function start(options: IStartOptions): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { "hello.txt": "hello\n" },
        extraArgs: [`--registry=${registry.url}`, ...(options.extraArgs ?? [])],
        ...(options.root === undefined
            ? { seedUserData: options.seedUserData }
            : { root: options.root, keepRoot: true }),
        settings: options.settings ?? {},
        cols: 120,
        rows: 32,
    });
    await app.session.waitForReady();
    return app;
}

/** Like the user editing settings.json: the editor reloads it from disk. */
function writeSettings(app: HeadlessApp, settings: Readonly<Record<string, unknown>>): void {
    writeFileSync(join(app.env.userDataDir, "user-data", "User", "settings.json"), JSON.stringify(settings, null, 2));
}

async function showViewlet(app: HeadlessApp): Promise<void> {
    await app.session.executeCommand("workbench.view.extensions");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
}

async function openPage(app: HeadlessApp, query: string, id: string): Promise<void> {
    await showViewlet(app);
    for (let i = 0; i < 30; i++) await app.session.key("Backspace");
    await app.session.text(query);
    await app.session.key("Tab");
    await app.session.key("ArrowDown");
    await app.session.key("Enter");
    await app.session.waitForNode(`#extensionPage-${pageId(id)}`);
}

async function pageButtons(app: HeadlessApp): Promise<{ label: string; enabled: boolean }[]> {
    const header = await app.session.node("#extensionPageHeader");
    const state = header?.state as { buttons?: { label: string; enabled: boolean }[] } | undefined;
    return state?.buttons ?? [];
}

async function waitForButtons(app: HeadlessApp, predicate: (labels: string[]) => boolean): Promise<string[]> {
    let labels: string[] = [];
    await vi.waitFor(
        async () => {
            labels = (await pageButtons(app)).map((b) => b.label);
            expect(predicate(labels)).toBe(true);
        },
        { timeout: 10_000, interval: 100 },
    );
    return labels;
}

async function pressButton(app: HeadlessApp, label: string): Promise<void> {
    const index = (await pageButtons(app)).findIndex((b) => b.label === label);
    expect(index).toBeGreaterThanOrEqual(0);
    await app.session.executeCommand("workbench.action.focusActiveEditorGroup");
    for (let i = 0; i < index; i++) await app.session.key("ArrowRight");
    await app.session.key("Enter");
}

async function rowText(app: HeadlessApp, group: string, id: string): Promise<string | null> {
    const row = await app.session.node(`#extensionsGroup-${group}-${pageId(id)}`);
    return row?.text ?? null;
}

async function waitForRow(app: HeadlessApp, id: string, expected: RegExp, group = "installed"): Promise<void> {
    await vi.waitFor(
        async () => {
            expect(await rowText(app, group, id)).toMatch(expected);
        },
        { timeout: 10_000, interval: 100 },
    );
}

async function screen(app: HeadlessApp): Promise<string> {
    return frameToText(await app.session.captureFrame());
}

async function waitForScreen(app: HeadlessApp, needle: string): Promise<string> {
    return frameToText(await app.session.waitForText((t) => t.includes(needle)));
}

async function waitForLog(app: HeadlessApp, needle: string): Promise<string> {
    let log = "";
    await vi.waitFor(
        async () => {
            log = await app.session.getOutput("Extensions");
            expect(log).toContain(needle);
        },
        { timeout: 10_000, interval: 100 },
    );
    return log;
}

async function waitForOutdated(app: HeadlessApp, expected: boolean): Promise<void> {
    await vi.waitFor(
        async () => {
            expect(await app.session.getContextKey("hasOutdatedExtensions")).toBe(expected);
        },
        { timeout: 10_000, interval: 100 },
    );
}

/** Real time for a wrongly fired timer, request or install to land: the absence of something is only seen so. */
function settle(ms: number): Promise<void> {
    return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function waitForRequests(path: string, count: number): Promise<void> {
    await vi.waitFor(
        () => {
            expect(registry.count(path)).toBe(count);
        },
        { timeout: 10_000, interval: 50 },
    );
}

const INDEX = "/index.json";
function metaPath(id: string): string {
    return `/meta/${id}.json`;
}
function artifactPath(id: string, version: string): string {
    return `/artifacts/${id}-${version}.vsix`;
}

const UPDATED_ONE = "Updated 1 extension.";
const UPDATED_TWO = "Updated 2 extensions.";

describe("Extension auto-update — QA of stage 3 (functional e2e, HTTP registry)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        root = mkdtempSync(join(tmpdir(), "diode-qa3-"));
        const longAgo = new Date(Date.now() - 30 * 24 * HOUR).toISOString();
        const recently = new Date(Date.now() - 0.5 * HOUR).toISOString();
        const tomorrow = new Date(Date.now() + 24 * HOUR).toISOString();
        const old = (
            id: string,
            version: string,
        ): { id: string; version: string; sourceDir: string; publishedAt: string } => ({
            id,
            version,
            sourceDir: SAMPLE,
            publishedAt: longAgo,
        });
        registryDir = await createRegistryFixture(join(root, "registry"), [
            old(A, "1.0.0"),
            old(A, "1.1.0"),
            old(B, "1.0.0"),
            old(B, "1.1.0"),
            old(FRESH, "1.0.0"),
            { ...old(FRESH, "1.1.0"), publishedAt: recently },
            old(FUTURE, "1.0.0"),
            { ...old(FUTURE, "1.1.0"), publishedAt: tomorrow },
            old(NODATE, "1.0.0"),
            { id: NODATE, version: "1.1.0", sourceDir: SAMPLE },
            old(CORRUPT, "1.0.0"),
            { ...old(CORRUPT, "1.1.0"), corruptSha: true },
            { ...old(NOT_INSTALLED, "1.0.0"), displayName: "Qa Not Installed" },
        ]);
        registry = new FixtureRegistryServer(registryDir);
        await registry.listen();
    }, 300_000);

    afterAll(async () => {
        await registry.close();
        removeTempDir(root);
    });

    // Each test starts from a clean request log (the server is shared, the windows are not).
    function resetRequests(): void {
        registry.requests.length = 0;
        registry.offline = false;
    }

    describe("US-3.1/US-3.2/US-3.3: when the registry is asked", () => {
        it("US-3.1: nothing before the first frame and in the first 10 s; then one index read and the candidates' meta; the viewlet reuses it", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A]), settings: { "extensions.autoUpdate": "off" } });
            // Real time runs too: the moves stay well inside the 10 s.
            await settle(500);
            expect(registry.requests).toEqual([]);

            await app.session.advanceClock(7 * SECOND);
            await settle(300);
            expect(registry.requests).toEqual([]);

            await app.session.advanceClock(3 * SECOND);
            await waitForOutdated(app, true);
            expect(registry.count(INDEX)).toBe(1);
            expect(registry.count(metaPath(A))).toBe(1);
            // Only the candidate (outdated) costs a meta request.
            expect(registry.requests.filter((r) => r.startsWith("/meta/"))).toEqual([metaPath(A)]);

            await showViewlet(app);
            await waitForRow(app, A, /Update 1\.1\.0$/u);
            await settle(500);
            expect(registry.count(INDEX)).toBe(1);
        });

        it("US-3.2: `autoCheckUpdates: false` — not a single request in 36 hours", async () => {
            resetRequests();
            const app = await start({
                seedUserData: await seed([A]),
                settings: { "extensions.autoCheckUpdates": false, "extensions.autoUpdate": "off" },
            });
            await app.session.advanceClock(10 * SECOND);
            for (let i = 0; i < 3; i++) await app.session.advanceClock(12 * HOUR);
            await settle(1000);
            expect(registry.requests).toEqual([]);
        });

        it("US-3.3: many clock moves in a row — exactly one check per 12 hours, no piled-up timers", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A]), settings: { "extensions.autoUpdate": "off" } });
            await app.session.advanceClock(10 * SECOND);
            await waitForRequests(INDEX, 1);

            // Twelve one-hour steps: one check at the end, not one per step.
            for (let i = 0; i < 11; i++) await app.session.advanceClock(HOUR);
            await settle(500);
            expect(registry.count(INDEX)).toBe(1);
            await app.session.advanceClock(HOUR);
            await waitForRequests(INDEX, 2);

            // One big jump over several intervals is one check, not a burst.
            await app.session.advanceClock(5 * 12 * HOUR);
            await waitForRequests(INDEX, 3);
            await settle(1000);
            expect(registry.count(INDEX)).toBe(3);
        });

        it("US-3.3: a Refresh in the middle moves the next check to 12 hours after it", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A]), settings: { "extensions.autoUpdate": "off" } });
            await app.session.advanceClock(10 * SECOND);
            await waitForRequests(INDEX, 1);
            await showViewlet(app);

            await app.session.advanceClock(6 * HOUR);
            await app.session.executeCommand("extensions.refresh");
            await waitForRequests(INDEX, 2);

            await app.session.advanceClock(6 * HOUR + 60 * SECOND);
            await settle(500);
            expect(registry.count(INDEX)).toBe(2);
            await app.session.advanceClock(6 * HOUR);
            await waitForRequests(INDEX, 3);
        });

        it("an unrelated settings change is not a check", async () => {
            resetRequests();
            const settings = { "extensions.autoUpdate": "off" };
            const app = await start({ seedUserData: await seed([A]), settings });
            await app.session.advanceClock(10 * SECOND);
            await waitForRequests(INDEX, 1);

            writeSettings(app, { ...settings, "editor.tabSize": 7 });
            await settle(1500);
            expect(registry.count(INDEX)).toBe(1);
        });
    });

    describe("US-3.6: the publish delay", () => {
        // QA report, bug 1 (fixed in PR #796: the delay timer is capped at 12 h, the clock arms long timers in steps): a delay remaining beyond 2^31-1 ms (~596 h) overflows Node's `setTimeout`, which then
        // fires after 1 ms — the delay timer becomes a busy loop of background checks against the registry (and a
        // `TimeoutOverflowWarning` on stderr, over the TUI).
        it("bug 1: `autoUpdateDelay: 1000` (hours) waits quietly instead of re-checking in a loop", async () => {
            resetRequests();
            const app = await start({
                seedUserData: await seed([FRESH]),
                settings: { "extensions.autoUpdateDelay": 1000 },
            });
            await app.session.advanceClock(10 * SECOND);
            await waitForOutdated(app, true);

            await settle(5000);

            expect(registry.count(INDEX)).toBe(1);
            expect(profile(app)).toEqual([`${FRESH}@1.0.0 pinned=false`]);
        });

        // QA report, bug 2 (fixed in PR #796: an unknown date waits for the next read): when the candidate's metadata cannot be read (one 500), the target comes from the index,
        // which has no date — "no date, no delay" — and a version published 30 minutes ago is installed at once.
        it("bug 2: an unreadable meta does not bypass the delay — a fresh version is not installed", async () => {
            resetRequests();
            registry.fail(metaPath(FRESH), 1);
            const app = await start({ seedUserData: await seed([FRESH]) });
            await app.session.advanceClock(10 * SECOND);
            await waitForLog(app, `Could not read the metadata of ${FRESH}`);

            await settle(3000);

            expect(profile(app)).toEqual([`${FRESH}@1.0.0 pinned=false`]);
            expect(await screen(app)).not.toContain("Updated");
        });

        it("a `publishedAt` in the future and none at all — no delay, both installed in one batch", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([FUTURE, NODATE]) });
            await app.session.advanceClock(10 * SECOND);

            await waitForScreen(app, UPDATED_TWO);
            expect(profile(app)).toEqual([`${FUTURE}@1.1.0 pinned=false`, `${NODATE}@1.1.0 pinned=false`]);
        });

        it("the delay ends while the registry is down: no toast, no install; the next check installs it", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([FRESH]) });
            await app.session.advanceClock(10 * SECOND);
            await waitForOutdated(app, true);

            // The pass a second after the read has planned the delay timer.
            await settle(1500);
            registry.offline = true;
            await app.session.advanceClock(1.5 * HOUR + SECOND);
            await waitForLog(app, "Could not check for extension updates:");
            await settle(1500);
            const text = await screen(app);
            expect(text).not.toContain("Updated");
            expect(text).not.toContain("Retry");
            // The known catalog still says outdated: the failed read does not drop it.
            expect(await app.session.getContextKey("hasOutdatedExtensions")).toBe(true);

            registry.offline = false;
            await app.session.advanceClock(12 * HOUR);
            await waitForScreen(app, UPDATED_ONE);
            expect(profile(app)).toEqual([`${FRESH}@1.1.0 pinned=false`]);
        });

        it("a delay raised while waiting: the old end passes, nothing is installed", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([FRESH]) });
            await app.session.advanceClock(10 * SECOND);
            await waitForOutdated(app, true);

            writeSettings(app, { "extensions.autoUpdateDelay": 10 });
            await settle(1500);
            await app.session.advanceClock(2 * HOUR);
            await settle(2000);
            expect(profile(app)).toEqual([`${FRESH}@1.0.0 pinned=false`]);
            expect(await screen(app)).not.toContain("Updated");
        });

        it("unchecking `Auto Update` while waiting pins it: the end of the delay installs nothing", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([FRESH]) });
            await app.session.advanceClock(10 * SECOND);
            await waitForOutdated(app, true);
            await openPage(app, "qa3-fresh", FRESH);
            await waitForButtons(app, (labels) => labels.at(-1) === "[x] Auto Update");

            await pressButton(app, "[x] Auto Update");
            await waitForButtons(app, (labels) => labels.at(-1) === "[ ] Auto Update");
            expect(profile(app)).toEqual([`${FRESH}@1.0.0 pinned=true`]);

            await app.session.advanceClock(2 * HOUR);
            await settle(2500);
            expect(profile(app)).toEqual([`${FRESH}@1.0.0 pinned=true`]);
        });
    });

    describe("settings values", () => {
        it("`extensions.autoUpdate: false` (the old boolean) reads as off", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A]), settings: { "extensions.autoUpdate": false } });
            await app.session.advanceClock(10 * SECOND);
            await waitForOutdated(app, true);
            await settle(2000);
            expect(profile(app)).toEqual([`${A}@1.0.0 pinned=false`]);
        });

        it("`extensions.autoUpdate: true` (the old boolean) reads as on", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A]), settings: { "extensions.autoUpdate": true } });
            await app.session.advanceClock(10 * SECOND);
            await waitForScreen(app, UPDATED_ONE);
            expect(profile(app)).toEqual([`${A}@1.1.0 pinned=false`]);
        });
    });

    describe("US-3.8: the page toggle", () => {
        it("not on the page of an extension that is not installed", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A]) });
            await openPage(app, "qa not installed", NOT_INSTALLED);
            const labels = await waitForButtons(app, (l) => l.includes("Install"));
            expect(labels.some((l) => l.includes("Auto Update"))).toBe(false);
        });

        it("`.vsix`-like and CLI `id@version` installs are pinned: the toggle is unchecked and auto-update skips them", async () => {
            resetRequests();
            // The CLI pin stays (no `pinned` override).
            const app = await start({ seedUserData: await seed([A], { pinned: [A] }) });
            await app.session.advanceClock(10 * SECOND);
            await waitForOutdated(app, true);
            await settle(2000);
            expect(profile(app)).toEqual([`${A}@1.0.0 pinned=true`]);
            await openPage(app, "qa3-a", A);
            await waitForButtons(app, (labels) => labels.at(-1) === "[ ] Auto Update");
        });
    });

    describe("US-3.10/partial failures", () => {
        it("US-3.10: offline before the first list — silent; the first viewlet show reads the catalog itself", async () => {
            resetRequests();
            registry.offline = true;
            const app = await start({ seedUserData: await seed([A]), settings: { "extensions.autoUpdate": "off" } });
            await app.session.advanceClock(10 * SECOND);
            await waitForLog(app, "Could not check for extension updates:");
            const text = await screen(app);
            expect(text).not.toContain("Could not check");
            expect(text).not.toContain("Retry");

            registry.offline = false;
            await showViewlet(app);
            await waitForRow(app, A, /Update 1\.1\.0$/u);
        });

        it("US-3.10: still offline at the first show — that show is the user's read: its reason is on screen", async () => {
            resetRequests();
            registry.offline = true;
            const app = await start({ seedUserData: await seed([A]), settings: { "extensions.autoUpdate": "off" } });
            await app.session.advanceClock(10 * SECOND);
            await waitForLog(app, "Could not check for extension updates:");

            await showViewlet(app);
            await waitForScreen(app, "Retry");
        });

        it("a sha256 mismatch is only in the log; the toast counts the one that went in", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A, CORRUPT]) });
            await app.session.advanceClock(10 * SECOND);

            const text = await waitForScreen(app, UPDATED_ONE);
            expect(text).not.toContain("qa3-corrupt");
            expect(text).not.toContain("failed");
            await waitForLog(app, `Could not auto-update ${CORRUPT}`);
            expect(profile(app)).toEqual([`${A}@1.1.0 pinned=false`, `${CORRUPT}@1.0.0 pinned=false`]);
        });

        it("everything failed — silence on screen, the reason in the log", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([CORRUPT]) });
            await app.session.advanceClock(10 * SECOND);

            await waitForLog(app, `Could not auto-update ${CORRUPT}`);
            await settle(1000);
            const text = await screen(app);
            expect(text).not.toContain("Updated");
            expect(text).not.toContain("Could not");
            expect(profile(app)).toEqual([`${CORRUPT}@1.0.0 pinned=false`]);
        });
    });

    describe("US-3.11: a race with the manual Update All", () => {
        it("Update All inside the auto-update debounce: each artifact is downloaded once, one toast", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A, B]) });
            await app.session.advanceClock(10 * SECOND);
            await waitForOutdated(app, true);
            // The pass waits a second after the read (upstream autoUpdateDelayer): the user is faster.
            await app.session.executeCommand("workbench.extensions.action.updateAllExtensions");

            await waitForScreen(app, UPDATED_TWO);
            await settle(2500);
            expect(registry.count(artifactPath(A, "1.1.0"))).toBe(1);
            expect(registry.count(artifactPath(B, "1.1.0"))).toBe(1);
            const text = await screen(app);
            expect(text.split("Updated ")).toHaveLength(2);
            expect(profile(app)).toEqual([`${A}@1.1.0 pinned=false`, `${B}@1.1.0 pinned=false`]);
        });

        it("Update All while the auto batch installs: nothing installed twice", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A, B]) });
            await app.session.advanceClock(10 * SECOND);
            await vi.waitFor(
                () => {
                    expect(
                        registry.count(artifactPath(A, "1.1.0")) + registry.count(artifactPath(B, "1.1.0")),
                    ).toBeGreaterThan(0);
                },
                { timeout: 10_000, interval: 20 },
            );
            await app.session.executeCommand("workbench.extensions.action.updateAllExtensions");

            await waitForScreen(app, UPDATED_TWO);
            await settle(2500);
            expect(registry.count(artifactPath(A, "1.1.0"))).toBe(1);
            expect(registry.count(artifactPath(B, "1.1.0"))).toBe(1);
            expect(
                readEntries(defaultProfileFile(app.env.userDataDir)).filter((e) => e.identifier.id === A),
            ).toHaveLength(1);
        });
    });

    describe("US-3.12: another process over the same profile", () => {
        it("uninstalled by the CLI before this window's check: not installed back", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A, B]) });
            await cliOk(["--user-data-dir", app.env.userDataDir, "--uninstall-extension", A]);

            await app.session.advanceClock(10 * SECOND);
            await waitForScreen(app, UPDATED_ONE);
            expect(profile(app)).toEqual([`${B}@1.1.0 pinned=false`]);
        });

        it("updated by the CLI before this window's pass: skipped, no toast, one entry", async () => {
            resetRequests();
            const app = await start({ seedUserData: await seed([A]) });
            await app.session.advanceClock(10 * SECOND);
            await waitForOutdated(app, true);
            // Inside the second between the read and the pass.
            await cliOk(["--user-data-dir", app.env.userDataDir, "--registry", registryDir, "--install-extension", A]);

            await settle(2500);
            expect(await screen(app)).not.toContain("Updated");
            expect(
                readEntries(defaultProfileFile(app.env.userDataDir)).filter((e) => e.identifier.id === A),
            ).toHaveLength(1);
            expect(registry.count(artifactPath(A, "1.1.0"))).toBe(0);
        });
    });

    describe("profile B and Reload Window", () => {
        it("auto-update in profile B writes B's list only; after Reload Window the old version is gone", async () => {
            resetRequests();
            const dir = await seed([A], { profileB: true });
            const app = await start({ seedUserData: dir, extraArgs: ["--profile", "B"] });
            await app.session.advanceClock(10 * SECOND);
            await waitForScreen(app, UPDATED_ONE);
            const userData = app.env.userDataDir;
            expect(describeProfile(namedProfileFile(userData, "B"))).toEqual([`${A}@1.1.0 pinned=false`]);

            await app.session.executeCommand("workbench.action.reloadWindow").catch(() => undefined);
            await app.session.reconnect();
            await app.session.waitForReady();
            // Stage 0: the old version is used by no profile, the next start removes it.
            expect(versionDirs(userData, A)).toEqual([`${A}-1.1.0`]);
            expect(obsoleteKeys(userData)).not.toContain(`${A}-1.1.0`);
            await showViewlet(app);
            await waitForRow(app, A, /1\.1\.0/u);
            expect(await rowText(app, "installed", A)).not.toMatch(/Reload$/u);
        });
    });
});
