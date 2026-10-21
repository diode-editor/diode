import { IFileServiceDIToken } from "../../platform/files/common/files.ts";
import { FileService } from "../../platform/files/common/fileService.ts";
import { DiskFileSystemProvider } from "../../platform/files/node/diskFileSystemProvider.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";

export const filesModule: ContainerModule = (container) => {
    container.bind(IFileServiceDIToken, () => {
        const files = new FileService();
        files.registerProvider("file", new DiskFileSystemProvider());
        return files;
    });
};
