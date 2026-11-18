import { readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, normalize } from "node:path";

export interface IRegistryServerOptions {
    /**
     * A `.vsix` goes with `Content-Length` and stops after its first half until {@link RegistryServer.release}: a
     * frame in the middle of a download is stable.
     */
    readonly holdArtifacts?: boolean;
}

/**
 * A `createRegistryFixture` directory over HTTP: the window's registry. `path` artifacts become `url` ones (the HTTP
 * source takes only those). Requests are logged; `fail` answers 500 to a path a number of times; `offline` drops all.
 */
export class RegistryServer {
    public readonly requests: string[] = [];
    public offline = false;
    public url = "";
    private readonly failures = new Map<string, number>();
    private readonly held: (() => void)[] = [];
    private server: Server | undefined;

    public constructor(
        private readonly dir: string,
        private readonly options: IRegistryServerOptions = {},
    ) {}

    public async listen(): Promise<void> {
        const server = createServer((req, res) => {
            this.handle(req, res);
        });
        this.server = server;
        await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
        this.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
    }

    /** Sends the rest of every held `.vsix`. */
    public release(): void {
        for (const finish of this.held.splice(0)) finish();
    }

    public close(): Promise<void> {
        this.release();
        const server = this.server;
        return new Promise((done) => (server === undefined ? done() : server.close(() => done())));
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
        if (this.options.holdArtifacts === true && path.endsWith(".vsix")) {
            const half = Math.floor(body.byteLength / 2);
            res.writeHead(200, { "content-length": String(body.byteLength) });
            res.write(body.subarray(0, half));
            this.held.push(() => res.end(body.subarray(half)));
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
