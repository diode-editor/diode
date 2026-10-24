import { IFileServiceDIToken } from "../../platform/files/common/files.ts";
import { FileService } from "../../platform/files/common/fileService.ts";
import { IRandomAccessFileOpenerDIToken } from "../../platform/files/common/iRandomAccessFile.ts";
import { DiskFileSystemProvider } from "../../platform/files/node/diskFileSystemProvider.ts";
import { nodeRandomAccessFileOpener } from "../../platform/files/node/nodeRandomAccessFile.ts";
import { IMemoryProbeDIToken } from "../../platform/memory/common/iMemoryProbe.ts";
import { nodeMemoryProbe } from "../../platform/memory/node/nodeMemoryProbe.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";

export const filesModule: ContainerModule = (container) => {
    container.bind(IFileServiceDIToken, () => {
        const files = new FileService();
        files.registerProvider("file", new DiskFileSystemProvider());
        return files;
    });
    container.bind(IRandomAccessFileOpenerDIToken, () => nodeRandomAccessFileOpener);
    // Its consumer is the same as the opener's: a large file read into memory ("Enable Editing").
    container.bind(IMemoryProbeDIToken, () => nodeMemoryProbe);
};
