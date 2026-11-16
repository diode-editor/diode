import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IFileIndexRequest } from "../../search/common/fileSearch.ts";

// Quick Open's file index lives in the real subprocess (#1179): the host's customer reaches it over RPC.
describe("ExtensionHost — file search in the subprocess", () => {
    let ws: ITempWorkspace;
    let harness: IExtensionHarness | undefined;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-exthost-filesearch-",
            files: { "src/main.ts": "", "README.md": "" },
        });
    });

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
        ws.dispose();
    });

    function request(cacheKey: string): IFileIndexRequest {
        return {
            cacheKey,
            folder: ws.dir,
            excludes: [],
            useIgnoreFiles: { local: true, parent: false, global: false },
        };
    }

    it("a request starts the subprocess when no extension did, walks the folder there and answers the top matches", async () => {
        // No extensions: nothing activates, so only the search request can bring the subprocess up.
        harness = await createExtensionTestHarness({ extensions: [] });
        const { fileSearch } = harness.host;

        expect(await fileSearch.index(request("k"))).toEqual({ limitHit: false });
        const result = await fileSearch.query({ cacheKey: "k", query: "main", maxResults: 10 });

        expect(result.complete).toBe(true);
        expect(result.matches.map((m) => m.relativePath)).toEqual(["src/main.ts"]);
    }, 30_000);

    it("clearCache frees the index in the subprocess", async () => {
        harness = await createExtensionTestHarness({ extensions: [] });
        const { fileSearch } = harness.host;
        await fileSearch.index(request("k"));

        fileSearch.clearCache("k");

        // The notification and the next request travel in order over the same channel.
        expect(await fileSearch.query({ cacheKey: "k", query: "", maxResults: 10 })).toEqual({
            matches: [],
            complete: false,
            limitHit: false,
        });
    }, 30_000);

    it("after the host is disposed a request is refused instead of spawning a new subprocess", async () => {
        const h = await createExtensionTestHarness({ extensions: [] });
        await h.dispose();

        await expect(h.host.fileSearch.index(request("k"))).rejects.toThrow("ExtensionHost disposed");
    }, 30_000);
});
