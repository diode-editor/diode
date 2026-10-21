import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import { CommandOriginalResourceProvider, ORIGINAL_RESOURCE_COMMAND } from "./commandOriginalResourceProvider.ts";

const FILE = Uri.file("/repo/a.ts");
const GIT_URI = "git:/repo/a.ts?%7B%22ref%22%3A%22HEAD%22%7D";

function withCommand(result: unknown) {
    const registry = new CommandRegistry();
    registry.register(ORIGINAL_RESOURCE_COMMAND, () => result);
    return new CommandOriginalResourceProvider(registry);
}

describe("CommandOriginalResourceProvider", () => {
    it("parses the extension's response into the original resource", async () => {
        const resource = await withCommand(GIT_URI).provideOriginalResource(FILE);

        expect(resource?.scheme).toBe("git");
        expect(resource?.toString()).toBe(GIT_URI);
    });

    it("no SCM extension means no original, and that is not an error", async () => {
        const provider = new CommandOriginalResourceProvider(new CommandRegistry());

        await expect(provider.provideOriginalResource(FILE)).resolves.toBeNull();
    });

    it("the extension answered null (untracked/outside a repo): no original", async () => {
        await expect(withCommand(null).provideOriginalResource(FILE)).resolves.toBeNull();
    });

    it("an empty string does not become a resource", async () => {
        await expect(withCommand("").provideOriginalResource(FILE)).resolves.toBeNull();
    });

    it("a non-string response is ignored", async () => {
        await expect(withCommand(42).provideOriginalResource(FILE)).resolves.toBeNull();
        await expect(withCommand(undefined).provideOriginalResource(FILE)).resolves.toBeNull();
    });

    it("the resource is passed to the extension as a string", async () => {
        const registry = new CommandRegistry();
        const seen: unknown[] = [];
        registry.register(ORIGINAL_RESOURCE_COMMAND, (arg) => {
            seen.push(arg);
            return GIT_URI;
        });

        await new CommandOriginalResourceProvider(registry).provideOriginalResource(FILE);

        expect(seen).toEqual([FILE.toString()]);
    });
});
