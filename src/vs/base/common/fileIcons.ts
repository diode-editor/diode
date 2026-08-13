import { packRgb } from "@tuidom/all/common/colorUtils";

export interface FileIcon {
    icon: string;
    color: number;
}

const DEFAULT_ICON: FileIcon = { icon: "\uF016", color: packRgb(180, 180, 180) };

const EXTENSION_ICONS: Record<string, FileIcon | undefined> = {
    ".ts": { icon: "\uE628", color: packRgb(49, 120, 198) },
    ".tsx": { icon: "\uE628", color: packRgb(49, 120, 198) },
    ".js": { icon: "\uE781", color: packRgb(241, 224, 90) },
    ".jsx": { icon: "\uE781", color: packRgb(241, 224, 90) },
    ".json": { icon: "\uE60B", color: packRgb(241, 224, 90) },
    ".md": { icon: "\uE609", color: packRgb(81, 154, 186) },
    ".html": { icon: "\uE736", color: packRgb(227, 76, 38) },
    ".css": { icon: "\uE749", color: packRgb(86, 61, 124) },
    ".rs": { icon: "\uE7A8", color: packRgb(222, 165, 132) },
    ".go": { icon: "\uE724", color: packRgb(0, 173, 216) },
    ".py": { icon: "\uE73C", color: packRgb(55, 118, 171) },
    ".txt": { icon: "\uF0F6", color: packRgb(180, 180, 180) },
    ".yaml": { icon: "\uE6A8", color: packRgb(203, 23, 30) },
    ".yml": { icon: "\uE6A8", color: packRgb(203, 23, 30) },
    ".toml": { icon: "\uE6B2", color: packRgb(156, 66, 33) },
    ".sh": { icon: "\uE795", color: packRgb(78, 154, 6) },
    ".bash": { icon: "\uE795", color: packRgb(78, 154, 6) },
    ".lua": { icon: "\uE620", color: packRgb(0, 0, 128) },
    ".c": { icon: "\uE61E", color: packRgb(85, 85, 255) },
    ".cpp": { icon: "\uE61D", color: packRgb(0, 89, 156) },
    ".h": { icon: "\uF1DC", color: packRgb(146, 131, 194) },
};

const FILENAME_ICONS: Record<string, FileIcon | undefined> = {
    Makefile: { icon: "\uE779", color: packRgb(111, 66, 193) },
    Dockerfile: { icon: "\uE7B0", color: packRgb(56, 151, 214) },
    ".gitignore": { icon: "\uE702", color: packRgb(240, 80, 50) },
};

export function getFileIcon(filename: string): FileIcon {
    const match = FILENAME_ICONS[filename];
    if (match) return match;

    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex >= 0) {
        const ext = filename.slice(dotIndex);
        const extMatch = EXTENSION_ICONS[ext];
        if (extMatch) return extMatch;
    }

    return DEFAULT_ICON;
}
