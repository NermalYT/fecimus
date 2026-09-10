
import {
    spawnSync,
} from "node:child_process";

import {
    existsSync,
    readFileSync,
    readdirSync,
} from "node:fs";

import { launchAndObserve, observeUntil } from "../desktop-workflow.mjs";

import path from "node:path";

import { applicationDirectories } from '../application-paths.mjs';

import {
    McpServer,
} from "@modelcontextprotocol/server";

import {
    StdioServerTransport,
} from "@modelcontextprotocol/server/stdio";

import * as z from "zod/v4";


const server =
    new McpServer({

        name:
            "local-fecimus-desktop-apps",

        version:
            "1.2.0",

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


function run(
    command,
    args,
    timeout = 15000,
) {

    const result =
        spawnSync(
            command,
            args,
            {

                encoding:
                    "utf8",

                timeout,

                env:
                    process.env,

            },
        );


    if (result.error)
    {

        throw result.error;

    }


    if (result.status !== 0)
    {

        throw new Error(
            [
                `${command} exited with status ${result.status}.`,
                (
                    result.stderr ||
                    ""
                ).trim(),
                (
                    result.stdout ||
                    ""
                ).trim(),
            ]
                .filter(Boolean)
                .join("\n"),
        );

    }


    return (
        result.stdout ||
        ""
    ).trim();

}


function parseDesktopFile(filename) {

    let contents;


    try
    {

        contents =
            readFileSync(
                filename,
                "utf8",
            );

    }
    catch
    {

        return null;

    }


    let inside =
        false;


    const values = {};


    for (
        const rawLine
        of contents.split(/\r?\n/)
    )
    {

        const line =
            rawLine.trim();


        if (
            line === "" ||
            line.startsWith("#")
        )
        {

            continue;

        }


        if (
            line.startsWith("[") &&
            line.endsWith("]")
        )
        {

            inside =
                line === "[Desktop Entry]";

            continue;

        }


        if (!inside)
        {

            continue;

        }


        const equals =
            line.indexOf("=");


        if (equals <= 0)
        {

            continue;

        }


        const key =
            line
                .slice(
                    0,
                    equals,
                )
                .trim();


        if (key.includes("["))
        {

            continue;

        }


        values[key] =
            line
                .slice(
                    equals + 1,
                )
                .trim();

    }


    if (
        values.Type !== "Application"
    )
    {

        return null;

    }


    if (
        String(
            values.Hidden ||
            "",
        ).toLowerCase() ===
        "true"
    )
    {

        return null;

    }


    if (
        String(
            values.NoDisplay ||
            "",
        ).toLowerCase() ===
        "true"
    )
    {

        return null;

    }


    if (!values.Name)
    {

        return null;

    }


    return values;

}


function walkDesktopFiles(
    root,
    current = root,
    results = [],
) {

    if (!existsSync(current))
    {

        return results;

    }


    let entries;


    try
    {

        entries =
            readdirSync(
                current,
                {
                    withFileTypes:
                        true,
                },
            );

    }
    catch
    {

        return results;

    }


    for (
        const entry
        of entries
    )
    {

        const full =
            path.join(
                current,
                entry.name,
            );


        if (entry.isDirectory())
        {

            walkDesktopFiles(
                root,
                full,
                results,
            );

            continue;

        }


        if (
            !entry.isFile() ||
            !entry.name.endsWith(
                ".desktop",
            )
        )
        {

            continue;

        }


        const relative =
            path.relative(
                root,
                full,
            );


        const id =
            relative
                .split(
                    path.sep,
                )
                .join("-");


        results.push({

            id,

            filename:
                full,

        });

    }


    return results;

}


function getApplications() {

    const apps =
        new Map();


    for (
        const directory
        of applicationDirectories()
    )
    {

        for (
            const entry
            of walkDesktopFiles(
                directory,
            )
        )
        {

            if (
                apps.has(
                    entry.id,
                )
            )
            {

                continue;

            }


            const parsed =
                parseDesktopFile(
                    entry.filename,
                );


            if (!parsed)
            {

                continue;

            }


            apps.set(
                entry.id,
                {

                    desktop_id:
                        entry.id,

                    name:
                        parsed.Name,

                    generic_name:
                        parsed.GenericName ||
                        null,

                    comment:
                        parsed.Comment ||
                        null,

                    categories:
                        (
                            parsed.Categories ||
                            ""
                        )
                            .split(";")
                            .filter(Boolean),

                    filename:
                        entry.filename,

                },
            );

        }

    }


    return Array.from(
        apps.values(),
    ).sort(
        (
            a,
            b,
        ) =>
            a.name.localeCompare(
                b.name,
            ),
    );

}


function getWindows() {

    let output;


    try
    {

        output =
            run(
                "wmctrl",
                [
                    "-lx",
                ],
            );

    }
    catch
    {

        return [];

    }


    const windows = [];


    for (
        const line
        of output.split(/\r?\n/)
    )
    {

        if (!line.trim())
        {

            continue;

        }


        const match =
            line.match(
                /^(\S+)\s+(-?\d+)\s+(\S+)\s+(\S+)\s*(.*)$/,
            );


        if (!match)
        {

            continue;

        }


        windows.push({

            id:
                match[1],

            desktop:
                Number(
                    match[2],
                ),

            host:
                match[4],

            wm_class:
                match[3],

            title:
                match[5] ||
                "",

        });

    }


    return windows;

}


function normalizeWindowId(input) {

    const value =
        String(
            input,
        ).trim();


    if (
        /^0x[0-9a-f]+$/i.test(
            value,
        )
    )
    {

        return value.toLowerCase();

    }


    if (/^\d+$/.test(value))
    {

        return (
            "0x" +
            Number(
                value,
            ).toString(
                16,
            )
        );

    }


    throw new Error(
        `Invalid window ID: ${value}`,
    );

}


function getActiveWindow(windows) {

    let decimal;


    try
    {

        decimal =
            run(
                "xdotool",
                [
                    "getactivewindow",
                ],
            );

    }
    catch
    {

        return null;

    }


    const id =
        normalizeWindowId(
            decimal,
        );


    return (
        (windows || getWindows()).find(window => Number.parseInt(window.id, 16) === Number.parseInt(id, 16))
        ||
        {
            id,
            title:
                null,
            wm_class:
                null,
        }
    );

}


function getWindowGeometry(
    windowId,
) {

    const id =
        normalizeWindowId(
            windowId,
        );


    const decimalId =
        parseInt(
            id,
            16,
        );


    const output =
        run(
            "xdotool",
            [
                "getwindowgeometry",
                "--shell",
                String(
                    decimalId,
                ),
            ],
        );


    const values = {};


    for (
        const line
        of output.split(/\r?\n/)
    )
    {

        const equals =
            line.indexOf("=");


        if (equals <= 0)
        {

            continue;

        }


        values[
            line.slice(
                0,
                equals,
            )
        ] =
            line.slice(
                equals + 1,
            );

    }


    const x =
        Number(
            values.X,
        );


    const y =
        Number(
            values.Y,
        );


    const width =
        Number(
            values.WIDTH,
        );


    const height =
        Number(
            values.HEIGHT,
        );


    return {

        window_id:
            id,

        x,

        y,

        width,

        height,

        center_x:
            Math.round(
                x +
                width / 2,
            ),

        center_y:
            Math.round(
                y +
                height / 2,
            ),

    };

}


/* ==========================================================
 * application_search
 * ========================================================== */

server.registerTool(

    "application_search",

    {

        description:
            "Search installed graphical desktop applications.",

        inputSchema:
            z.object({

                query:
                    z
                        .string()
                        .min(1)
                        .max(120),

                limit:
                    z
                        .number()
                        .int()
                        .min(1)
                        .max(50)
                        .default(15),

            }),

    },

    async ({
        query,
        limit,
    }) => {

        const needle =
            query
                .trim()
                .toLowerCase();


        const results =
            getApplications()
                .map(
                    app => {

                        const haystack =
                            [
                                app.name,
                                app.generic_name,
                                app.comment,
                                app.desktop_id,
                                ...app.categories,
                            ]
                                .filter(Boolean)
                                .join(" ")
                                .toLowerCase();


                        let score =
                            0;


                        if (
                            app.name
                                .toLowerCase() ===
                            needle
                        )
                        {

                            score +=
                                100;

                        }


                        if (
                            app.name
                                .toLowerCase()
                                .startsWith(
                                    needle,
                                )
                        )
                        {

                            score +=
                                50;

                        }


                        if (
                            haystack.includes(
                                needle,
                            )
                        )
                        {

                            score +=
                                25;

                        }


                        return {

                            app,

                            score,

                        };

                    },
                )
                .filter(
                    result =>
                        result.score > 0,
                )
                .sort(
                    (
                        a,
                        b,
                    ) =>
                        b.score -
                        a.score,
                )
                .slice(
                    0,
                    limit,
                )
                .map(
                    result =>
                        result.app,
                );


        return jsonResult({

            query,

            count:
                results.length,

            applications:
                results,

        });

    },

);


/* ==========================================================
 * application_list
 * ========================================================== */

server.registerTool(

    "application_list",

    {

        description:
            "List installed graphical desktop applications.",

        inputSchema:
            z.object({

                limit:
                    z
                        .number()
                        .int()
                        .min(1)
                        .max(250)
                        .default(50),

            }),

    },

    async ({
        limit,
    }) => {

        const apps =
            getApplications();


        return jsonResult({

            total:
                apps.length,

            applications:
                apps.slice(
                    0,
                    limit,
                ),

        });

    },

);


/* ==========================================================
 * application_launch
 * ========================================================== */

server.registerTool(
    "application_launch",
    {
        description: "Launch a GUI in Fecimus's private desktop. Use desktop_id for an installed app, or executable with args for Blender, Unity, an IDE, or a project file. cwd selects the project directory. wait_ms is a maximum readiness wait; returns early when a new window appears. A window does not guarantee an app has finished loading its project.",
        inputSchema: z.object({
            desktop_id: z.string().optional(),
            executable: z.string().min(1).max(4096).optional(),
            args: z.array(z.string().max(8192)).max(128).default([]).describe("Arguments for executable; file arguments for a desktop_id. Each argument is a separate string, never a shell command."),
            cwd: z.string().max(4096).optional(),
            wait_ms: z.number().int().min(0).max(10000).default(1800),
        }),
    },
    async ({ desktop_id, executable, args, cwd, wait_ms }) => {
        if (Boolean(desktop_id) === Boolean(executable)) throw new Error("Provide exactly one of desktop_id or executable.");
        if (args.some(value => value.includes("\0")) || [executable, cwd].some(value => value?.includes("\0"))) throw new Error("Launch arguments cannot contain NUL bytes.");
        if (args.reduce((size, value) => size + Buffer.byteLength(value), 0) > 131072) throw new Error("Combined launch arguments exceed 128 KiB.");
        const workingDirectory = cwd ? path.resolve(process.env.HOME, cwd) : process.env.HOME;
        let app;
        let command = executable;
        let launchArgs = args;
        if (desktop_id) {
            app = getApplications().find(candidate => candidate.desktop_id === desktop_id || candidate.desktop_id === `${desktop_id}.desktop`);
            if (!app) throw new Error(`Application not found: ${desktop_id}`);
            command = "gio";
            launchArgs = ["launch", app.filename, ...args];
        }
        const observed = await launchAndObserve(command, launchArgs, {
            cwd: workingDirectory,
            env: { ...process.env, HOME: process.env.FECIMUS_APP_HOME || process.env.HOME },
            windows: getWindows,
            timeoutMs: wait_ms,
        });
        return jsonResult({
            started: true,
            window_observed: observed.windowObserved,
            readiness: observed.windowObserved ? "window_observed" : "no_new_window_before_deadline",
            action: "application_launch",
            application: app ? { name: app.name, desktop_id: app.desktop_id } : { executable },
            launcher_pid: observed.pid,
            cwd: workingDirectory,
            new_windows: observed.newWindows,
            all_windows: observed.windows,
            active_window: getActiveWindow(observed.windows),
        });
    },
);


/* ==========================================================
 * window_list
 * ========================================================== */

server.registerTool(

    "window_list",

    {

        description:
            "List currently open desktop windows.",

        inputSchema:
            z.object({

                query:
                    z
                        .string()
                        .max(200)
                        .default(""),

            }),

    },

    async ({
        query,
    }) => {

        let windows =
            getWindows();


        const needle =
            query
                .trim()
                .toLowerCase();


        if (needle)
        {

            windows =
                windows.filter(
                    window =>
                        window.title
                            .toLowerCase()
                            .includes(
                                needle,
                            ) ||
                        window.wm_class
                            .toLowerCase()
                            .includes(
                                needle,
                            ),
                );

        }


        return jsonResult({

            count:
                windows.length,

            windows,

        });

    },

);


/* ==========================================================
 * window_active
 * ========================================================== */

server.registerTool(

    "window_active",

    {

        description:
            "Return the currently focused graphical window.",

        inputSchema:
            z.object({}),

    },

    async () => {

        return jsonResult({

            active_window:
                getActiveWindow(),

        });

    },

);


/* ==========================================================
 * window_geometry
 * ========================================================== */

server.registerTool(

    "window_geometry",

    {

        description:
            "Return exact screen position, dimensions, and center " +
            "coordinates of a desktop window. Prefer this over " +
            "guessing window coordinates from screenshots.",

        inputSchema:
            z.object({

                window_id:
                    z.string(),

            }),

    },

    async ({
        window_id,
    }) => {

        return jsonResult(
            getWindowGeometry(
                window_id,
            ),
        );

    },

);


/* ==========================================================
 * window_focus
 * ========================================================== */

server.registerTool(

    "window_focus",

    {

        description:
            "Focus and bring an existing graphical window to front.",

        inputSchema:
            z.object({

                window_id:
                    z.string(),

            }),

    },

    async ({
        window_id,
    }) => {

        const id =
            normalizeWindowId(
                window_id,
            );


        run(
            "xdotool",
            [
                "windowactivate",
                id,
            ],
        );


        const observed = await observeUntil(getActiveWindow,
            active => active !== null && Number.parseInt(active.id, 16) === Number.parseInt(id, 16), 1000);
        return {
            ...jsonResult({
                success: observed.ready,
                active_window: observed.value,
                ...(observed.ready ? {} : { error: "Window manager did not confirm focus before the deadline." }),
            }),
            ...(observed.ready ? {} : { isError: true }),
        };

    },

);


/* ==========================================================
 * window_minimize
 * ========================================================== */

server.registerTool(

    "window_minimize",

    {

        description:
            "Minimize a graphical window.",

        inputSchema:
            z.object({

                window_id:
                    z.string(),

            }),

    },

    async ({
        window_id,
    }) => {

        const id =
            normalizeWindowId(
                window_id,
            );


        run(
            "xdotool",
            [
                "windowminimize",
                id,
            ],
        );


        return jsonResult({

            success:
                true,

            window_id:
                id,

        });

    },

);


/* ==========================================================
 * window_maximize
 * ========================================================== */

server.registerTool(

    "window_maximize",

    {

        description:
            "Maximize a graphical window.",

        inputSchema:
            z.object({

                window_id:
                    z.string(),

            }),

    },

    async ({
        window_id,
    }) => {

        const id =
            normalizeWindowId(
                window_id,
            );


        run(
            "wmctrl",
            [
                "-ir",
                id,
                "-b",
                "add,maximized_vert,maximized_horz",
            ],
        );


        return jsonResult({

            success:
                true,

            window_id:
                id,

        });

    },

);


/* ==========================================================
 * window_restore
 * ========================================================== */

server.registerTool(

    "window_restore",

    {

        description:
            "Restore a maximized window.",

        inputSchema:
            z.object({

                window_id:
                    z.string(),

            }),

    },

    async ({
        window_id,
    }) => {

        const id =
            normalizeWindowId(
                window_id,
            );


        run(
            "wmctrl",
            [
                "-ir",
                id,
                "-b",
                "remove,maximized_vert,maximized_horz",
            ],
        );


        return jsonResult({

            success:
                true,

            window_id:
                id,

        });

    },

);


/* ==========================================================
 * window_close
 * ========================================================== */

server.registerTool(

    "window_close",

    {

        description:
            "Request normal closure of a graphical window.",

        inputSchema:
            z.object({

                window_id:
                    z.string(),

            }),

    },

    async ({
        window_id,
    }) => {

        const id =
            normalizeWindowId(
                window_id,
            );


        run(
            "wmctrl",
            [
                "-ic",
                id,
            ],
        );


        return jsonResult({

            success:
                true,

            window_id:
                id,

        });

    },

);


/* ==========================================================
 * START
 * ========================================================== */

async function main()
{

    const transport =
        new StdioServerTransport();


    await server.connect(
        transport,
    );


    console.error(
        "[local-fecimus-desktop-apps] MCP server started."
    );

}


main().catch(
    error => {

        console.error(
            "[local-fecimus-desktop-apps] Fatal error:",
            error,
        );


        process.exit(
            1,
        );

    },
);
