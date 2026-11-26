import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../TestUtils/testConfigurationService.ts";
import type { IWireWorkspaceEditOp } from "../common/wireTypes.ts";

import { FileOperationParticipantAdapter } from "./fileOperationParticipantAdapter.ts";

const FILES = [{ source: "file:///a", target: "file:///b" }];

function setup(timeout: unknown, ops: readonly IWireWorkspaceEditOp[] = []) {
    const host = {
        willRunFileOperation: vi.fn(() => Promise.resolve(ops)),
        didRunFileOperation: vi.fn(),
    };
    const titles: string[] = [];
    const locations: string[] = [];
    const adapter = new FileOperationParticipantAdapter(
        host,
        createTestConfigurationService({ "files.participants.timeout": timeout as number }),
        {
            withProgress: (options, task) => {
                titles.push(options.title);
                locations.push(options.location);
                return task();
            },
        },
    );
    return { adapter, host, titles, locations };
}

describe("FileOperationParticipantAdapter", () => {
    it("asks the host with files.participants.timeout and converts the reply", async () => {
        const { adapter, host } = setup(1234, [{ kind: "delete", resource: "file:///x" }]);

        await expect(adapter.willRun("move", FILES)).resolves.toEqual([{ kind: "delete", from: "/x" }]);

        expect(host.willRunFileOperation).toHaveBeenCalledWith({ operation: "move", files: FILES, timeoutMs: 1234 });
    });

    it.each([0, -1])("the setting %j disables participants", async (timeout) => {
        const { adapter, host } = setup(timeout);

        await expect(adapter.willRun("create", FILES)).resolves.toBeNull();

        expect(host.willRunFileOperation).not.toHaveBeenCalled();
    });

    it.each([
        ["create", "Running 'File Create' participants..."],
        ["move", "Running 'File Rename' participants..."],
        ["copy", "Running 'File Copy' participants..."],
        ["delete", "Running 'File Delete' participants..."],
    ] as const)("%s shows upstream's progress title", async (operation, title) => {
        const { adapter, titles } = setup(1000);

        await adapter.willRun(operation, FILES);

        expect(titles).toEqual([title]);
    });

    it("the progress goes to the status bar", async () => {
        const { adapter, locations } = setup(1000);

        await adapter.willRun("move", FILES);

        expect(locations).toEqual(["window"]);
    });

    it("an edit on a non-file resource is refused as a whole", async () => {
        const { adapter } = setup(1000, [{ kind: "delete", resource: "output:/x" }]);

        await expect(adapter.willRun("delete", FILES)).resolves.toBeNull();
    });

    it("did goes straight to the host", () => {
        const { adapter, host } = setup(1000);

        adapter.didRun("copy", FILES);

        expect(host.didRunFileOperation).toHaveBeenCalledExactlyOnceWith({ operation: "copy", files: FILES });
    });
});
