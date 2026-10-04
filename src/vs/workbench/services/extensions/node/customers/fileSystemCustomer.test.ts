import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import { NULL_EXTENSION_FILE_WATCHER } from "../../../../api/common/iExtensionFileWatcher.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";

import { FileSystemCustomer } from "./fileSystemCustomer.ts";

function attach(customer: FileSystemCustomer) {
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const attached = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { peer, attached };
}

describe("FileSystemCustomer — уход спавна", () => {
    it("объявленные схемы умирают вместе с субпроцессом: ФС — с событием, содержимое — молча", async () => {
        const customer = new FileSystemCustomer(NULL_EXTENSION_FILE_WATCHER);
        const changed = vi.fn();
        customer.onFileSystemProvidersChanged(changed);
        const { peer, attached } = attach(customer);
        peer.notify("workspace.fileSystemProvidersChanged", { schemes: ["git"] });
        peer.notify("workspace.textDocumentContentProvidersChanged", { schemes: ["jdt"] });
        await flushMicrotasks();
        expect(customer.getFileSystemSchemes()).toEqual(["git"]);
        expect(customer.hasTextContentProvider("jdt")).toBe(true);
        changed.mockClear();

        attached.dispose();

        expect(customer.getFileSystemSchemes()).toEqual([]);
        expect(customer.hasTextContentProvider("jdt")).toBe(false);
        expect(changed).toHaveBeenCalledOnce();
        await expect(customer.readProvidedFile(Uri.parse("git:/a.ts"))).rejects.toThrow(
            "extension host is not running",
        );
    });

    it("субпроцесс без схем ФС на уходе событие не порождает", () => {
        const customer = new FileSystemCustomer(NULL_EXTENSION_FILE_WATCHER);
        const changed = vi.fn();
        customer.onFileSystemProvidersChanged(changed);
        const { attached } = attach(customer);

        attached.dispose();

        expect(changed).not.toHaveBeenCalled();
    });
});
