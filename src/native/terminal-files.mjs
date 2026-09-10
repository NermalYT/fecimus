import { readPrefix } from '../file-io.mjs';
import { createPathGuard } from '../file-roots.mjs';

import {
    spawnSync,
} from "node:child_process";

import {
    appendFileSync,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    readdirSync,
    renameSync,
    statSync,
    writeFileSync,
} from "node:fs";

import path from "node:path";

import os from "node:os";

import {
    McpServer,
} from "@modelcontextprotocol/server";

import {
    StdioServerTransport,
} from "@modelcontextprotocol/server/stdio";

import * as z from "zod/v4";


const SERVER_NAME =
    "local-fecimus-terminal-files";

const SERVER_VERSION =
    "1.0.0";


const HOME =
    path.resolve(
        os.homedir(),
    );


const MAX_READ_BYTES =
    2 * 1024 * 1024;


const MAX_WRITE_BYTES =
    4 * 1024 * 1024;


const MAX_OUTPUT_CHARS =
    50000;


const server =
    new McpServer({

        name:
            SERVER_NAME,

        version:
            SERVER_VERSION,

    });


function textResult(text) {

    return {

        content: [

            {

                type:
                    "text",

                text,

            },

        ],

    };

}


function jsonResult(value) {

    return textResult(
        JSON.stringify(
            value,
            null,
            2,
        ),
    );

}


const fileGuard = createPathGuard();
const ensureInsideHome = inputPath => fileGuard.resolve(inputPath);
const relativeHome = filename => fileGuard.display(filename);



function truncateOutput(
    text,
) {

    text =
        String(
            text ?? "",
        );


    if (
        text.length <=
        MAX_OUTPUT_CHARS
    )
    {

        return {

            text,

            truncated:
                false,

        };

    }


    return {

        text:
            text.slice(
                0,
                MAX_OUTPUT_CHARS,
            ) +
            "\n\n[OUTPUT TRUNCATED]",

        truncated:
            true,

    };

}


function statObject(
    filename,
) {

    const stats =
        lstatSync(
            filename,
        );


    return {

        path:
            relativeHome(
                filename,
            ),

        absolute_path:
            filename,

        type:
            stats.isDirectory()
                ? "directory"
                : stats.isFile()
                    ? "file"
                    : stats.isSymbolicLink()
                        ? "symlink"
                        : "other",

        size:
            stats.size,

        modified:
            stats.mtime.toISOString(),

        created:
            stats.birthtime.toISOString(),

        mode:
            (
                stats.mode &
                0o777
            )
                .toString(8)
                .padStart(
                    3,
                    "0",
                ),

    };

}


function blockedShellReason(
    command,
) {

    const normalized =
        command
            .trim()
            .toLowerCase();


    const patterns = [

        {
            regex:
                /(^|[;&|]\s*)sudo(\s|$)/,

            reason:
                "sudo is disabled for autonomous shell tools.",
        },

        {
            regex:
                /(^|[;&|]\s*)su(\s|$)/,

            reason:
                "su is disabled.",
        },

        {
            regex:
                /(^|[;&|]\s*)pkexec(\s|$)/,

            reason:
                "pkexec is disabled.",
        },

        {
            regex:
                /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b/,

            reason:
                "Power-management commands are disabled.",
        },

        {
            regex:
                /\bmkfs(\.|\s)|\bfdisk\b|\bparted\b|\bwipefs\b/,

            reason:
                "Disk formatting/partitioning commands are disabled.",
        },

        {
            regex:
                /(^|\s)dd\s+.*\bof=\/dev\//,

            reason:
                "Raw writes to block devices are disabled.",
        },

        {
            regex:
                /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+\/(\s|$)/,

            reason:
                "Recursive deletion of root is disabled.",
        },

        {
            regex:
                /\brm\s+.*\/etc\b|\brm\s+.*\/usr\b|\brm\s+.*\/boot\b|\brm\s+.*\/var\b/,

            reason:
                "Deletion attempts against system directories are disabled.",
        },

        {
            regex:
                /:\(\)\s*\{\s*:\|:&\s*;\s*\}/,

            reason:
                "Fork bombs are disabled.",
        },

    ];


    for (
        const rule
        of patterns
    )
    {

        if (
            rule.regex.test(
                normalized,
            )
        )
        {

            return rule.reason;

        }

    }


    return null;

}


/* ==========================================================
 * filesystem_list
 * ========================================================== */

server.registerTool(

    "filesystem_list",

    {

        description:
            "List files and folders inside a directory within configured file roots (HOME by default).",

        inputSchema:
            z.object({

                path:
                    z
                        .string()
                        .default("~"),

                show_hidden:
                    z
                        .boolean()
                        .default(false),

                limit:
                    z
                        .number()
                        .int()
                        .min(1)
                        .max(1000)
                        .default(200),

            }),

    },

    async ({
        path: inputPath,
        show_hidden,
        limit,
    }) => {

        const target =
            ensureInsideHome(
                inputPath,
            );


        const stats =
            statSync(
                target,
            );


        if (!stats.isDirectory())
        {

            throw new Error(
                "filesystem_list target must be a directory.",
            );

        }


        let entries =
            readdirSync(
                target,
                {
                    withFileTypes:
                        true,
                },
            );


        if (!show_hidden)
        {

            entries =
                entries.filter(
                    entry =>
                        !entry.name.startsWith(
                            ".",
                        ),
                );

        }


        entries =
            entries
                .sort(
                    (
                        first,
                        second,
                    ) => {

                        if (
                            first.isDirectory() &&
                            !second.isDirectory()
                        )
                        {

                            return -1;

                        }


                        if (
                            !first.isDirectory() &&
                            second.isDirectory()
                        )
                        {

                            return 1;

                        }


                        return first.name.localeCompare(
                            second.name,
                        );

                    },
                )
                .slice(
                    0,
                    limit,
                );


        const results =
            entries.map(
                entry => {

                    const full =
                        path.join(
                            target,
                            entry.name,
                        );


                    let size =
                        null;


                    let modified =
                        null;


                    try
                    {

                        const itemStats =
                            lstatSync(
                                full,
                            );


                        size =
                            itemStats.size;


                        modified =
                            itemStats.mtime.toISOString();

                    }
                    catch
                    {

                        // Ignore transient item stat errors.

                    }


                    return {

                        name:
                            entry.name,

                        type:
                            entry.isDirectory()
                                ? "directory"
                                : entry.isFile()
                                    ? "file"
                                    : entry.isSymbolicLink()
                                        ? "symlink"
                                        : "other",

                        path:
                            relativeHome(
                                full,
                            ),

                        size,

                        modified,

                    };

                },
            );


        return jsonResult({

            directory:
                relativeHome(
                    target,
                ),

            count:
                results.length,

            entries:
                results,

        });

    },

);


/* ==========================================================
 * filesystem_stat
 * ========================================================== */

server.registerTool(

    "filesystem_stat",

    {

        description:
            "Return metadata about a file or directory within configured file roots (HOME by default).",

        inputSchema:
            z.object({

                path:
                    z.string(),

            }),

    },

    async ({
        path: inputPath,
    }) => {

        const target =
            ensureInsideHome(
                inputPath,
            );


        if (!existsSync(target))
        {

            throw new Error(
                `Path does not exist: ${relativeHome(target)}`,
            );

        }


        return jsonResult(
            statObject(
                target,
            ),
        );

    },

);


/* ==========================================================
 * filesystem_read_text
 * ========================================================== */

server.registerTool(

    "filesystem_read_text",

    {

        description:
            "Read a UTF-8 text file within configured file roots (HOME by default). Intended for source code, configuration, logs and documents stored as plain text.",

        inputSchema:
            z.object({

                path:
                    z.string(),

                max_bytes:
                    z
                        .number()
                        .int()
                        .min(1)
                        .max(MAX_READ_BYTES)
                        .default(500000),

            }),

    },

    async ({
        path: inputPath,
        max_bytes,
    }) => {

        const target =
            ensureInsideHome(
                inputPath,
            );


        const stats =
            statSync(
                target,
            );


        if (!stats.isFile())
        {

            throw new Error(
                "filesystem_read_text requires a regular file.",
            );

        }


        const bytesToRead =
            Math.min(
                stats.size,
                max_bytes,
                MAX_READ_BYTES,
            );


        const subset = readPrefix(target, bytesToRead);


        const contents =
            subset.toString(
                "utf8",
            );


        return jsonResult({

            path:
                relativeHome(
                    target,
                ),

            file_size:
                stats.size,

            returned_bytes:
                subset.length,

            truncated:
                stats.size >
                subset.length,

            content:
                contents,

        });

    },

);


/* ==========================================================
 * filesystem_write_text
 * ========================================================== */

server.registerTool(

    "filesystem_write_text",

    {

        description:
            "Create or replace a UTF-8 text file within configured file roots (HOME by default). Parent directory must already exist.",

        inputSchema:
            z.object({

                path:
                    z.string(),

                content:
                    z
                        .string()
                        .max(MAX_WRITE_BYTES),

            }),

    },

    async ({
        path: inputPath,
        content,
    }) => {

        const target =
            ensureInsideHome(
                inputPath,
            );


        const parent =
            path.dirname(
                target,
            );


        if (!existsSync(parent))
        {

            throw new Error(
                `Parent directory does not exist: ${relativeHome(parent)}`,
            );

        }


        writeFileSync(
            target,
            content,
            {
                encoding:
                    "utf8",
            },
        );


        return jsonResult({

            success:
                true,

            action:
                "filesystem_write_text",

            path:
                relativeHome(
                    target,
                ),

            bytes:
                Buffer.byteLength(
                    content,
                    "utf8",
                ),

        });

    },

);


/* ==========================================================
 * filesystem_append_text
 * ========================================================== */

server.registerTool(

    "filesystem_append_text",

    {

        description:
            "Append UTF-8 text to a file within configured file roots (HOME by default).",

        inputSchema:
            z.object({

                path:
                    z.string(),

                content:
                    z
                        .string()
                        .max(MAX_WRITE_BYTES),

            }),

    },

    async ({
        path: inputPath,
        content,
    }) => {

        const target =
            ensureInsideHome(
                inputPath,
            );


        appendFileSync(
            target,
            content,
            {
                encoding:
                    "utf8",
            },
        );


        return jsonResult({

            success:
                true,

            action:
                "filesystem_append_text",

            path:
                relativeHome(
                    target,
                ),

            appended_bytes:
                Buffer.byteLength(
                    content,
                    "utf8",
                ),

        });

    },

);


/* ==========================================================
 * filesystem_create_directory
 * ========================================================== */

server.registerTool(

    "filesystem_create_directory",

    {

        description:
            "Create a directory within configured file roots, including parent directories if needed.",

        inputSchema:
            z.object({

                path:
                    z.string(),

            }),

    },

    async ({
        path: inputPath,
    }) => {

        const target =
            ensureInsideHome(
                inputPath,
            );


        mkdirSync(
            target,
            {
                recursive:
                    true,
            },
        );


        return jsonResult({

            success:
                true,

            action:
                "filesystem_create_directory",

            path:
                relativeHome(
                    target,
                ),

        });

    },

);


/* ==========================================================
 * filesystem_copy
 * ========================================================== */

server.registerTool(

    "filesystem_copy",

    {

        description:
            "Copy one regular file to another location within configured file roots (HOME by default).",

        inputSchema:
            z.object({

                source:
                    z.string(),

                destination:
                    z.string(),

                overwrite:
                    z
                        .boolean()
                        .default(false),

            }),

    },

    async ({
        source,
        destination,
        overwrite,
    }) => {

        const sourcePath =
            ensureInsideHome(
                source,
            );


        const destinationPath =
            ensureInsideHome(
                destination,
            );


        const sourceStats =
            statSync(
                sourcePath,
            );


        if (!sourceStats.isFile())
        {

            throw new Error(
                "filesystem_copy currently copies regular files only.",
            );

        }


        if (
            existsSync(
                destinationPath,
            ) &&
            !overwrite
        )
        {

            throw new Error(
                "Destination already exists and overwrite=false.",
            );

        }


        copyFileSync(
            sourcePath,
            destinationPath,
        );


        return jsonResult({

            success:
                true,

            action:
                "filesystem_copy",

            source:
                relativeHome(
                    sourcePath,
                ),

            destination:
                relativeHome(
                    destinationPath,
                ),

        });

    },

);


/* ==========================================================
 * filesystem_move
 * ========================================================== */

server.registerTool(

    "filesystem_move",

    {

        description:
            "Move or rename a file or folder within configured file roots.",

        inputSchema:
            z.object({

                source:
                    z.string(),

                destination:
                    z.string(),

                overwrite:
                    z
                        .boolean()
                        .default(false),

            }),

    },

    async ({
        source,
        destination,
        overwrite,
    }) => {

        const sourcePath =
            ensureInsideHome(
                source,
            );


        const destinationPath =
            ensureInsideHome(
                destination,
            );


        if (
            existsSync(
                destinationPath,
            )
        )
        {

            if (!overwrite)
            {

                throw new Error(
                    "Destination exists and overwrite=false.",
                );

            }


            throw new Error(
                "For safety, filesystem_move does not overwrite existing paths. Trash or rename the existing destination first.",
            );

        }


        renameSync(
            sourcePath,
            destinationPath,
        );


        return jsonResult({

            success:
                true,

            action:
                "filesystem_move",

            source:
                relativeHome(
                    sourcePath,
                ),

            destination:
                relativeHome(
                    destinationPath,
                ),

        });

    },

);


/* ==========================================================
 * filesystem_trash
 * ========================================================== */

server.registerTool(

    "filesystem_trash",

    {

        description:
            "Move a file or folder within configured file roots to the desktop Trash instead of permanently deleting it.",

        inputSchema:
            z.object({

                path:
                    z.string(),

            }),

    },

    async ({
        path: inputPath,
    }) => {

        const target =
            ensureInsideHome(
                inputPath,
            );


        if (fileGuard.roots.includes(realpathSync(target)))
        {

            throw new Error(
                "Refusing to trash a configured file root.",
            );

        }


        const result =
            spawnSync(
                "gio",
                [
                    "trash",
                    target,
                ],
                {

                    encoding:
                        "utf8",

                    timeout:
                        15000,

                    env:
                        process.env,

                },
            );


        if (
            result.error
        )
        {

            throw result.error;

        }


        if (
            result.status !== 0
        )
        {

            throw new Error(
                (
                    result.stderr ||
                    "gio trash failed."
                ).trim(),
            );

        }


        return jsonResult({

            success:
                true,

            action:
                "filesystem_trash",

            path:
                relativeHome(
                    target,
                ),

        });

    },

);


/* ==========================================================
 * filesystem_search
 * ========================================================== */

server.registerTool(

    "filesystem_search",

    {

        description:
            "Search for filenames under a directory inside configured file roots (HOME by default).",

        inputSchema:
            z.object({

                directory:
                    z
                        .string()
                        .default("~"),

                name_contains:
                    z
                        .string()
                        .min(1)
                        .max(200),

                max_depth:
                    z
                        .number()
                        .int()
                        .min(1)
                        .max(20)
                        .default(6),

                limit:
                    z
                        .number()
                        .int()
                        .min(1)
                        .max(500)
                        .default(100),

            }),

    },

    async ({
        directory,
        name_contains,
        max_depth,
        limit,
    }) => {

        const root =
            ensureInsideHome(
                directory,
            );


        const result =
            spawnSync(
                "find",
                [
                    root,
                    "-maxdepth",
                    String(
                        max_depth,
                    ),
                    "-iname",
                    `*${name_contains}*`,
                    "-print",
                ],
                {

                    encoding:
                        "utf8",

                    timeout:
                        20000,

                    env:
                        process.env,

                },
            );


        if (
            result.error
        )
        {

            throw result.error;

        }


        const matches =
            (
                result.stdout ||
                ""
            )
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(
                    0,
                    limit,
                )
                .map(
                    filename =>
                        relativeHome(
                            filename,
                        ),
                );


        return jsonResult({

            directory:
                relativeHome(
                    root,
                ),

            query:
                name_contains,

            count:
                matches.length,

            matches,
            partial: result.status !== 0,
            exit_code: result.status,
            warning: (result.stderr || '').slice(0, 4000),

        });

    },

);


/* ==========================================================
 * shell_environment
 * ========================================================== */

server.registerTool(

    "shell_environment",

    {

        description:
            "Return useful information about the local shell environment.",

        inputSchema:
            z.object({}),

    },

    async () => {

        return jsonResult({

            user:
                os.userInfo().username,

            home:
                HOME,

            platform:
                process.platform,

            architecture:
                process.arch,

            shell:
                process.env.SHELL ||
                "/bin/bash",

            path:
                process.env.PATH ||
                "",

            node:
                process.version,

        });

    },

);


/* ==========================================================
 * shell_which
 * ========================================================== */

server.registerTool(

    "shell_which",

    {

        description:
            "Find the executable path for an installed command without executing it.",

        inputSchema:
            z.object({

                command:
                    z
                        .string()
                        .regex(
                            /^[A-Za-z0-9._+-]+$/,
                        ),

            }),

    },

    async ({
        command,
    }) => {

        const result =
            spawnSync(
                "which",
                [
                    command,
                ],
                {

                    encoding:
                        "utf8",

                    timeout:
                        5000,

                    env:
                        process.env,

                },
            );


        return jsonResult({

            command,

            found:
                result.status === 0,

            path:
                result.status === 0
                    ? (
                        result.stdout ||
                        ""
                    ).trim()
                    : null,

        });

    },

);


/* ==========================================================
 * shell_run
 * ========================================================== */

server.registerTool(

    "shell_run",

    {

        description:
            "Run a non-root shell command locally. The working directory must remain inside configured file roots (HOME by default). Use for compiling, testing, package-manager operations that do not require root, scripts, git, development tools, diagnostics and normal user commands.",

        inputSchema:
            z.object({

                command:
                    z
                        .string()
                        .min(1)
                        .max(20000),

                cwd:
                    z
                        .string()
                        .default("~"),

                timeout_seconds:
                    z
                        .number()
                        .int()
                        .min(1)
                        .max(120)
                        .default(30),

            }),

    },

    async ({
        command,
        cwd,
        timeout_seconds,
    }) => {

        const workingDirectory =
            ensureInsideHome(
                cwd,
            );


        if (
            !existsSync(
                workingDirectory,
            )
        )
        {

            throw new Error(
                "Working directory does not exist.",
            );

        }


        if (
            !statSync(
                workingDirectory,
            ).isDirectory()
        )
        {

            throw new Error(
                "cwd must be a directory.",
            );

        }


        const blockedReason =
            blockedShellReason(
                command,
            );


        if (blockedReason)
        {

            throw new Error(
                `Command blocked: ${blockedReason}`,
            );

        }


        const result =
            spawnSync(
                "/bin/bash",
                [
                    "--noprofile",
                    "--norc",
                    "-lc",
                    command,
                ],
                {

                    cwd:
                        workingDirectory,

                    encoding:
                        "utf8",

                    timeout:
                        timeout_seconds *
                        1000,

                    env: {

                        ...process.env,

                        HOME,

                        PWD:
                            workingDirectory,

                    },

                    maxBuffer:
                        8 *
                        1024 *
                        1024,

                },
            );


        let timedOut =
            false;


        if (
            result.error &&
            result.error.code ===
            "ETIMEDOUT"
        )
        {

            timedOut =
                true;

        }
        else if (
            result.error
        )
        {

            throw result.error;

        }


        const stdout =
            truncateOutput(
                result.stdout ||
                "",
            );


        const stderr =
            truncateOutput(
                result.stderr ||
                "",
            );


        return jsonResult({

            command,

            cwd:
                relativeHome(
                    workingDirectory,
                ),

            exit_code:
                result.status,

            signal:
                result.signal,

            timed_out:
                timedOut,

            stdout:
                stdout.text,

            stdout_truncated:
                stdout.truncated,

            stderr:
                stderr.text,

            stderr_truncated:
                stderr.truncated,

        });

    },

);


/* ==========================================================
 * START MCP
 * ========================================================== */

async function main()
{

    const transport =
        new StdioServerTransport();


    await server.connect(
        transport,
    );


    console.error(
        `[${SERVER_NAME}] MCP server started.`,
    );

}


main().catch(
    error => {

        console.error(
            `[${SERVER_NAME}] Fatal error:`,
            error,
        );


        process.exit(
            1,
        );

    },
);
