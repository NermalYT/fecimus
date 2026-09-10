
import {
    spawnSync,
    execFile,
} from "node:child_process";

import {
    setTimeout as sleep,
} from "node:timers/promises";

import {
    McpServer,
} from "@modelcontextprotocol/server";

import {
    StdioServerTransport,
} from "@modelcontextprotocol/server/stdio";

import * as z from "zod/v4";
import { promisify } from "node:util";
import { observeUntil } from "../desktop-workflow.mjs";
const execFileAsync = promisify(execFile);


const SERVER_NAME =
    "local-fecimus-desktop-keyboard";

const SERVER_VERSION =
    "1.0.0";


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


function runCommand(
    command,
    args,
    {
        input = undefined,
        timeout = 15000,
    } = {},
) {

    const result =
        spawnSync(
            command,
            args,
            {

                encoding:
                    "utf8",

                input,

                timeout,

                env:
                    process.env,

            },
        );


    if (result.error) {

        throw result.error;

    }


    if (result.status !== 0) {

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


function runXdotool(args) {

    return runCommand(
        "xdotool",
        args,
    );

}


function normalizeKey(raw) {

    if (
        typeof raw !== "string" ||
        raw.trim() === ""
    ) {

        throw new Error(
            "Keyboard key cannot be empty.",
        );

    }


    const input =
        raw.trim();


    const aliases = {

        ctrl:
            "ctrl",

        control:
            "ctrl",

        shift:
            "shift",

        alt:
            "alt",

        super:
            "super",

        win:
            "super",

        windows:
            "super",

        meta:
            "super",

        enter:
            "Return",

        return:
            "Return",

        esc:
            "Escape",

        escape:
            "Escape",

        tab:
            "Tab",

        space:
            "space",

        backspace:
            "BackSpace",

        delete:
            "Delete",

        del:
            "Delete",

        insert:
            "Insert",

        home:
            "Home",

        end:
            "End",

        pageup:
            "Page_Up",

        pagedown:
            "Page_Down",

        up:
            "Up",

        down:
            "Down",

        left:
            "Left",

        right:
            "Right",

        capslock:
            "Caps_Lock",

        numlock:
            "Num_Lock",

        printscreen:
            "Print",

        pause:
            "Pause",

    };


    const lower =
        input.toLowerCase();


    if (aliases[lower]) {

        return aliases[lower];

    }


    /*
     * Permit normal X11 keysym names.
     *
     * Examples:
     *
     *   F1
     *   F12
     *   XF86AudioRaiseVolume
     *   bracketleft
     *   semicolon
     */

    if (
        !/^[A-Za-z0-9_]+$/.test(
            input,
        )
    ) {

        throw new Error(
            `Unsupported key name: ${input}`,
        );

    }


    return input;

}


function getActiveWindow() {

    let id = null;

    let name = null;


    try {

        id =
            runXdotool([
                "getactivewindow",
            ]);

    } catch {

        // No active window available.

    }


    try {

        name =
            runXdotool([
                "getactivewindow",
                "getwindowname",
            ]);

    } catch {

        // Name unavailable.

    }


    return {

        id,

        name,

    };

}


function readClipboard(timeout = 3000) {

    const result =
        spawnSync(
            "xclip",
            [
                "-selection",
                "clipboard",
                "-out",
            ],
            {

                encoding:
                    "utf8",

                timeout,

                env:
                    process.env,

            },
        );


    if (
        result.status === 0
    ) {

        return result.stdout ?? "";

    }


    return null;

}


function writeClipboard(text) {

    const result =
        spawnSync(
            "xclip",
            [
                "-selection",
                "clipboard",
                "-in",
            ],
            {

                encoding:
                    "utf8",

                input:
                    text,

                timeout:
                    3000,

                env:
                    process.env,

            },
        );


    if (
        result.error
    ) {

        throw result.error;

    }


    if (
        result.status !== 0
    ) {

        throw new Error(
            (
                result.stderr ||
                "xclip failed"
            ).trim(),
        );

    }

}


/* ==========================================================
 * TOOL: keyboard_type_text
 * ========================================================== */

server.registerTool(

    "keyboard_type_text",

    {

        description:
            "Type text through the real X11 keyboard into the " +
            "currently focused application. Use this for ordinary " +
            "text. For large blocks or Unicode-heavy text, use " +
            "keyboard_paste_text.",

        inputSchema:
            z.object({

                text:
                    z
                        .string()
                        .max(20000),

                interval_ms:
                    z
                        .number()
                        .int()
                        .min(0)
                        .max(500)
                        .default(15),

            }),

    },

    async ({
        text,
        interval_ms,
    }) => {

        if (
            text.length === 0
        ) {

            return jsonResult({

                success:
                    true,

                action:
                    "keyboard_type_text",

                characters:
                    0,

            });

        }


        const expectedMs = Array.from(text).length * interval_ms;
        if (expectedMs > 120000) throw new Error("Typing would exceed two minutes. Use keyboard_paste_text for this block or reduce interval_ms; no text was typed.");
        await execFileAsync("xdotool", ["type", "--clearmodifiers", "--delay", String(interval_ms), "--", text], {
            timeout: Math.max(15000, expectedMs + 10000), env: process.env,
        });


        return jsonResult({

            success:
                true,

            action:
                "keyboard_type_text",

            characters:
                text.length,

            active_window:
                getActiveWindow(),

        });

    },

);


/* ==========================================================
 * TOOL: keyboard_paste_text
 * ========================================================== */

server.registerTool(

    "keyboard_paste_text",

    {

        description:
            "Paste a block of text into the currently focused " +
            "application using the X11 clipboard and Ctrl+V. " +
            "This is faster and more reliable for large or Unicode " +
            "text. The previous clipboard is restored afterward " +
            "when possible.",

        inputSchema:
            z.object({

                text:
                    z
                        .string()
                        .max(100000),

                restore_clipboard:
                    z
                        .boolean()
                        .default(true),

            }),

    },

    async ({
        text,
        restore_clipboard,
    }) => {

        const previousClipboard =
            restore_clipboard
                ? readClipboard()
                : null;


        writeClipboard(
            text,
        );


        const clipboardReady = await observeUntil(() => readClipboard(100), value => value === text, 500);
        if (!clipboardReady.ready) throw new Error("Clipboard ownership was not confirmed; no paste shortcut was sent.");


        runXdotool([

            "key",

            "--clearmodifiers",

            "ctrl+v",

        ]);


        await sleep(
            250,
        );


        let restored =
            false;


        if (
            restore_clipboard &&
            previousClipboard !== null
        ) {

            try {

                writeClipboard(
                    previousClipboard,
                );


                restored =
                    true;

            } catch {

                restored =
                    false;

            }

        }


        return jsonResult({

            success:
                true,

            action:
                "keyboard_paste_text",

            characters:
                text.length,

            clipboard_restored:
                restored,

            active_window:
                getActiveWindow(),

        });

    },

);


/* ==========================================================
 * TOOL: keyboard_press_key
 * ========================================================== */

server.registerTool(

    "keyboard_press_key",

    {

        description:
            "Press and release a keyboard key on the real XFCE " +
            "desktop. Examples: Enter, Escape, Tab, BackSpace, " +
            "Delete, Left, Right, Up, Down, F1 through F12.",

        inputSchema:
            z.object({

                key:
                    z
                        .string(),

                repeat:
                    z
                        .number()
                        .int()
                        .min(1)
                        .max(100)
                        .default(1),

                interval_ms:
                    z
                        .number()
                        .int()
                        .min(0)
                        .max(2000)
                        .default(80),

            }),

    },

    async ({
        key,
        repeat,
        interval_ms,
    }) => {

        const normalized =
            normalizeKey(
                key,
            );


        for (
            let index = 0;
            index < repeat;
            index += 1
        ) {

            runXdotool([

                "key",

                "--clearmodifiers",

                normalized,

            ]);


            if (
                index + 1 < repeat
            ) {

                await sleep(
                    interval_ms,
                );

            }

        }


        return jsonResult({

            success:
                true,

            action:
                "keyboard_press_key",

            key:
                normalized,

            repeat,

            active_window:
                getActiveWindow(),

        });

    },

);


/* ==========================================================
 * TOOL: keyboard_hotkey
 * ========================================================== */

server.registerTool(

    "keyboard_hotkey",

    {

        description:
            "Press a keyboard shortcut on the real desktop. " +
            "Examples: ['ctrl','l'], ['ctrl','c'], " +
            "['ctrl','shift','t'], ['alt','Tab'], " +
            "['ctrl','alt','t'].",

        inputSchema:
            z.object({

                keys:
                    z
                        .array(
                            z.string(),
                        )
                        .min(2)
                        .max(6),

            }),

    },

    async ({
        keys,
    }) => {

        const normalized =
            keys.map(
                normalizeKey,
            );


        const shortcut =
            normalized.join(
                "+",
            );


        runXdotool([

            "key",

            "--clearmodifiers",

            shortcut,

        ]);


        return jsonResult({

            success:
                true,

            action:
                "keyboard_hotkey",

            keys:
                normalized,

            shortcut,

            active_window:
                getActiveWindow(),

        });

    },

);


/* ==========================================================
 * TOOL: keyboard_key_down
 * ========================================================== */

server.registerTool(

    "keyboard_key_down",

    {

        description:
            "Hold down a real keyboard key or modifier. " +
            "Always release it afterward with keyboard_key_up.",

        inputSchema:
            z.object({

                key:
                    z
                        .string(),

            }),

    },

    async ({
        key,
    }) => {

        const normalized =
            normalizeKey(
                key,
            );


        runXdotool([

            "keydown",

            normalized,

        ]);


        return jsonResult({

            success:
                true,

            action:
                "keyboard_key_down",

            key:
                normalized,

        });

    },

);


/* ==========================================================
 * TOOL: keyboard_key_up
 * ========================================================== */

server.registerTool(

    "keyboard_key_up",

    {

        description:
            "Release a key previously held with keyboard_key_down.",

        inputSchema:
            z.object({

                key:
                    z
                        .string(),

            }),

    },

    async ({
        key,
    }) => {

        const normalized =
            normalizeKey(
                key,
            );


        runXdotool([

            "keyup",

            normalized,

        ]);


        return jsonResult({

            success:
                true,

            action:
                "keyboard_key_up",

            key:
                normalized,

        });

    },

);


/* ==========================================================
 * TOOL: keyboard_release_modifiers
 * ========================================================== */

server.registerTool(

    "keyboard_release_modifiers",

    {

        description:
            "Emergency recovery tool. Releases common modifier " +
            "keys if one becomes stuck after interrupted automation.",

        inputSchema:
            z.object({}),

    },

    async () => {

        const keys = [

            "ctrl",

            "ctrl_l",

            "ctrl_r",

            "shift",

            "shift_l",

            "shift_r",

            "alt",

            "alt_l",

            "alt_r",

            "super",

            "super_l",

            "super_r",

        ];


        for (
            const key of keys
        ) {

            try {

                runXdotool([

                    "keyup",

                    key,

                ]);

            } catch {

                // Continue through all modifiers.

            }

        }


        return jsonResult({

            success:
                true,

            action:
                "keyboard_release_modifiers",

        });

    },

);


/* ==========================================================
 * START MCP SERVER
 * ========================================================== */

async function main() {

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
