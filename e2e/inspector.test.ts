import { fileURLToPath } from "node:url";

import * as pty from "node-pty";
import { afterEach, describe, expect, it } from "vitest";

import { connectWithRetry, freePort, getDocument } from "./helpers/inspectorClient.ts";

const DEMO_PATH = fileURLToPath(new URL("./fixtures/inspectedHostApp.ts", import.meta.url));

function filterEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) out[key] = value;
    }
    out.TERM = "xterm-256color";
    delete out.TMUX;
    return out;
}

describe("inspector e2e smoke (real process + WebSocket)", () => {
    let term: pty.IPty | undefined;

    afterEach(() => {
        try {
            term?.kill();
        } catch {
            // already gone
        }
        term = undefined;
    });

    it("serves TUIDom.getDocument from a spawned demo app", async () => {
        const port = await freePort();
        term = pty.spawn(process.execPath, ["--import", "tsx/esm", DEMO_PATH, String(port)], {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            env: filterEnv(),
        });

        const ws = await connectWithRetry(`ws://127.0.0.1:${String(port)}`, 20_000);
        const result = await getDocument(ws);
        ws.close();

        expect(result.root?.type).toBe("BodyElement");
        // the demo's box has id "main" — confirm we serialized the real tree
        const json = JSON.stringify(result.root);
        expect(json).toContain('"id":"main"');
    });
});
