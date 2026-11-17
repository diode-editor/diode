import { mkdtempSync, readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The registry fixture is built at module import; the server starts in `prepare`, so loading the scenario list
// opens no socket.

const ID = "test.sample-lang";
const registryDir = await createRegistryFixture(
    join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"),
    [
        {
            id: ID,
            version: "0.0.2",
            sourceDir: resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
            displayName: "Sample Lang",
            description: "Synthetic marketplace extension: its own language and grammar",
            readme: "# Sample Lang\n\nA slow download: the page, the list and the status bar show the install.",
        },
    ],
);

/**
 * The fixture over HTTP (the HTTP source takes only `url` artifacts). A `.vsix` goes with `Content-Length` and
 * stops after its first half until {@link release}: the frame in the middle of the download is stable.
 */
class SlowRegistryServer {
    public url = "";
    private server: Server | undefined;
    private readonly held: (() => void)[] = [];

    public async listen(): Promise<void> {
        const server = createServer((req, res) => {
            this.handle(req, res);
        });
        this.server = server;
        await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
        this.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
    }

    public release(): void {
        for (const finish of this.held.splice(0)) finish();
    }

    public close(): Promise<void> {
        this.release();
        const server = this.server;
        return new Promise((done) => (server === undefined ? done() : server.close(() => done())));
    }

    private handle(req: IncomingMessage, res: ServerResponse): void {
        const path = (req.url ?? "/").split("?")[0]!;
        const file = normalize(join(registryDir, path));
        let body: Buffer;
        try {
            body = readFileSync(file);
        } catch {
            res.writeHead(404).end();
            return;
        }
        if (path.endsWith(".vsix")) {
            res.writeHead(200, { "content-length": String(body.byteLength) });
            res.write(body.subarray(0, body.byteLength / 2));
            this.held.push(() => res.end(body.subarray(body.byteLength / 2)));
            return;
        }
        if (path.startsWith("/meta/")) {
            const meta = JSON.parse(body.toString("utf8")) as { versions: { artifact: Record<string, string> }[] };
            for (const version of meta.versions) {
                version.artifact = { type: "url", url: `${this.url}${String(version.artifact["path"])}` };
            }
            body = Buffer.from(JSON.stringify(meta));
        }
        res.writeHead(200).end(body);
    }
}

const registry = new SlowRegistryServer();

export default defineScenario({
    name: "extensions-install-progress",
    title: "Extensions: an install in progress on the page, in the list and in the status bar",
    open: [repoRoot],
    // Read after `prepare`: the server's port is known only once it listens.
    get extraArgs() {
        return [`--registry=${registry.url}`];
    },
    // The headless DSL cannot encode a real Ctrl+Shift+X, so the command is bound to F6.
    userKeybindings: [
        { key: "f6", command: "workbench.view.extensions" },
        { key: "f7", command: "workbench.action.increaseSidebarWidth" },
    ],
    cols: 110,
    rows: 28,
    prepare: () => registry.listen(),
    async run(editor) {
        try {
            await editor.waitForText((t) => t.includes(explorerTitle(repoRoot)));
            await editor.sendKey("F6");
            await editor.waitForText((t) => t.includes("MARKETPLACE"));
            for (let i = 0; i < 3; i++) await editor.sendKey("F7");

            await editor.waitForNode("#extensionsGroup-marketplace-test-sample-lang");
            await editor.clickNode("#extensionsGroup-marketplace-test-sample-lang");
            await editor.waitForNode("#extensionPage-test-sample-lang");
            await editor.waitForText((t) => t.includes("Not installed"));

            // The page focuses its first button, which is Install. Half the file is in: the page button and the
            // status bar carry the percent, the list row says Installing.
            await editor.sendKey("Enter");
            await editor.waitForText(
                (t) =>
                    /Installing \d+%/u.test(t) &&
                    /Installing test\.sample-lang \(\d+%\)/u.test(t) &&
                    /Sample Lang {2}0\.0\.2 {2}Installing/u.test(t) &&
                    t.includes("Installing…"),
            );
            await editor.capture("downloading");

            registry.release();
            await editor.waitForText((t) => t.includes("Reload Window"));
            await editor.capture("installed");
        } finally {
            await registry.close();
        }
    },
});
