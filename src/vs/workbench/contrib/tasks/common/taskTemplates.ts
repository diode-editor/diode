// Шаблоны tasks.json для «Create tasks.json file from template»
// (`taskTemplates.ts` эталона, схема 2.0.0): тексты дословно. npm, gulp и
// прочие инструменты дают задачи провайдеры своих расширений, а не шаблон.

import type { QuickPickItem } from "../../../common/quickPickItem.ts";

/** Шаблон: строка пикера и текст файла (отступы — табами, как у эталона). */
export interface ITaskTemplate extends QuickPickItem {
    readonly id: string;
    readonly sort?: string;
    readonly content: string;
}

const dotnetBuild: ITaskTemplate = {
    id: "dotnetCore",
    label: ".NET Core",
    sort: "NET Core",
    description: "Executes .NET Core build command",
    content: [
        "{",
        "\t// See https://go.microsoft.com/fwlink/?LinkId=733558",
        "\t// for the documentation about the tasks.json format",
        '\t"version": "2.0.0",',
        '\t"tasks": [',
        "\t\t{",
        '\t\t\t"label": "build",',
        '\t\t\t"command": "dotnet",',
        '\t\t\t"type": "shell",',
        '\t\t\t"args": [',
        '\t\t\t\t"build",',
        "\t\t\t\t// Ask dotnet build to generate full paths for file names.",
        '\t\t\t\t"/property:GenerateFullPaths=true",',
        "\t\t\t\t// Do not generate summary otherwise it leads to duplicate errors in Problems panel",
        '\t\t\t\t"/consoleloggerparameters:NoSummary"',
        "\t\t\t],",
        '\t\t\t"group": "build",',
        '\t\t\t"presentation": {',
        '\t\t\t\t"reveal": "silent"',
        "\t\t\t},",
        '\t\t\t"problemMatcher": "$msCompile"',
        "\t\t}",
        "\t]",
        "}",
    ].join("\n"),
};

const msbuild: ITaskTemplate = {
    id: "msbuild",
    label: "MSBuild",
    description: "Executes the build target",
    content: [
        "{",
        "\t// See https://go.microsoft.com/fwlink/?LinkId=733558",
        "\t// for the documentation about the tasks.json format",
        '\t"version": "2.0.0",',
        '\t"tasks": [',
        "\t\t{",
        '\t\t\t"label": "build",',
        '\t\t\t"type": "shell",',
        '\t\t\t"command": "msbuild",',
        '\t\t\t"args": [',
        "\t\t\t\t// Ask msbuild to generate full paths for file names.",
        '\t\t\t\t"/property:GenerateFullPaths=true",',
        '\t\t\t\t"/t:build",',
        "\t\t\t\t// Do not generate summary otherwise it leads to duplicate errors in Problems panel",
        '\t\t\t\t"/consoleloggerparameters:NoSummary"',
        "\t\t\t],",
        '\t\t\t"group": "build",',
        '\t\t\t"presentation": {',
        "\t\t\t\t// Reveal the output only if unrecognized errors occur.",
        '\t\t\t\t"reveal": "silent"',
        "\t\t\t},",
        "\t\t\t// Use the standard MS compiler pattern to detect errors, warnings and infos",
        '\t\t\t"problemMatcher": "$msCompile"',
        "\t\t}",
        "\t]",
        "}",
    ].join("\n"),
};

const command: ITaskTemplate = {
    id: "externalCommand",
    label: "Others",
    description: "Example to run an arbitrary external command",
    content: [
        "{",
        "\t// See https://go.microsoft.com/fwlink/?LinkId=733558",
        "\t// for the documentation about the tasks.json format",
        '\t"version": "2.0.0",',
        '\t"tasks": [',
        "\t\t{",
        '\t\t\t"label": "echo",',
        '\t\t\t"type": "shell",',
        '\t\t\t"command": "echo Hello"',
        "\t\t}",
        "\t]",
        "}",
    ].join("\n"),
};

const maven: ITaskTemplate = {
    id: "maven",
    label: "maven",
    sort: "MVN",
    description: "Executes common maven commands",
    content: [
        "{",
        "\t// See https://go.microsoft.com/fwlink/?LinkId=733558",
        "\t// for the documentation about the tasks.json format",
        '\t"version": "2.0.0",',
        '\t"tasks": [',
        "\t\t{",
        '\t\t\t"label": "verify",',
        '\t\t\t"type": "shell",',
        '\t\t\t"command": "mvn -B verify",',
        '\t\t\t"group": "build"',
        "\t\t},",
        "\t\t{",
        '\t\t\t"label": "test",',
        '\t\t\t"type": "shell",',
        '\t\t\t"command": "mvn -B test",',
        '\t\t\t"group": "test"',
        "\t\t}",
        "\t]",
        "}",
    ].join("\n"),
};

/** Шаблоны в порядке пикера (`getTemplates`): по `sort ?? label`, «Others» — последним. */
export function getTaskTemplates(): ITaskTemplate[] {
    const sorted = [dotnetBuild, msbuild, maven].sort((a, b) => (a.sort ?? a.label).localeCompare(b.sort ?? b.label));
    return [...sorted, command];
}
