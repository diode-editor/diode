import { FileService } from "../vs/platform/files/common/fileService.ts";
import { DiskFileSystemProvider } from "../vs/platform/files/node/diskFileSystemProvider.ts";

export function diskFileService(): FileService {
    const files = new FileService();
    files.registerProvider("file", new DiskFileSystemProvider());
    return files;
}
