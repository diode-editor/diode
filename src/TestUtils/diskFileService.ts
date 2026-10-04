import { FileService } from "../vs/platform/files/common/fileService.ts";
import { DiskFileSystemProvider } from "../vs/platform/files/node/diskFileSystemProvider.ts";

/** Файловый сервис со схемой `file:` на настоящем диске — для тестов на временных каталогах. */
export function diskFileService(): FileService {
    const files = new FileService();
    files.registerProvider("file", new DiskFileSystemProvider());
    return files;
}
