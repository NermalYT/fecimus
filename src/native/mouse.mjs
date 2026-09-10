
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import * as z from "zod/v4";


const SERVER_NAME = "local-fecimus-desktop-mouse";

const SERVER_VERSION = "1.0.0";


const server = new McpServer({

    name: SERVER_NAME,

    version: SERVER_VERSION,

});


function clamp(value, minimum, maximum) {

    return Math.min(
        maximum,
        Math.max(
            minimum,
            value,
        ),
    );

}


function runXdotool(args) {

    const result = spawnSync(
        "xdotool",
        args,
        {
            encoding: "utf8",

            timeout: 30000,

            env: process.env,
        },
    );


    if (result.error) {

        throw result.error;

    }


    if (result.status !== 0) {

        const stderr = (
            result.stderr ||
            ""
        ).trim();


        const stdout = (
            result.stdout ||
            ""
        ).trim();


        throw new Error(
            [
                `xdotool failed with exit code ${result.status}.`,
                stderr,
                stdout,
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


function getMousePosition() {

    const output = runXdotool([
        "getmouselocation",
        "--shell",
    ]);


    const values = {};


    for (const line of output.split(/\r?\n/)) {

        const equals = line.indexOf("=");


        if (equals === -1) {

            continue;

        }


        const key = line
            .slice(0, equals)
            .trim();


        const value = line
            .slice(equals + 1)
            .trim();


        values[key] = value;

    }


    const x = Number(values.X);

    const y = Number(values.Y);

    const screen = Number(values.SCREEN ?? 0);

    const window = values.WINDOW ?? null;


    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y)
    ) {

        throw new Error(
            `Could not parse xdotool mouse position:\n${output}`,
        );

    }


    return {

        x,

        y,

        screen,

        window,

    };

}


function getDisplaySize() {

    const output = runXdotool([
        "getdisplaygeometry",
    ]);


    const parts = output
        .trim()
        .split(/\s+/)
        .map(Number);


    if (
        parts.length < 2 ||
        !Number.isFinite(parts[0]) ||
        !Number.isFinite(parts[1])
    ) {

        throw new Error(
            `Could not parse desktop geometry: ${output}`,
        );

    }


    return {

        width: parts[0],

        height: parts[1],

    };

}


function validateCoordinates(x, y) {

    const {
        width,
        height,
    } = getDisplaySize();


    if (
        x < 0 ||
        y < 0 ||
        x >= width ||
        y >= height
    ) {

        throw new Error(
            `Coordinates (${x}, ${y}) are outside the desktop ` +
            `bounds 0-${width - 1}, 0-${height - 1}.`,
        );

    }


    return {

        x: Math.round(x),

        y: Math.round(y),

        width,

        height,

    };

}


function buttonNumber(button) {

    const buttons = {

        left: 1,

        middle: 2,

        right: 3,

    };


    if (!(button in buttons)) {

        throw new Error(
            `Unknown mouse button: ${button}`,
        );

    }


    return buttons[button];

}


async function smoothMove(
    targetX,
    targetY,
    durationMs = 300,
) {

    const validated = validateCoordinates(
        targetX,
        targetY,
    );


    targetX = validated.x;

    targetY = validated.y;


    const start = getMousePosition();


    durationMs = clamp(
        Math.round(durationMs),
        0,
        3000,
    );


    if (durationMs === 0) {

        runXdotool([
            "mousemove",

            String(targetX),
            String(targetY),
        ]);


        return getMousePosition();

    }


    const steps = clamp(
        Math.round(durationMs / 18),
        2,
        60,
    );


    const delay = Math.max(
        1,
        Math.round(durationMs / steps),
    );


    for (
        let step = 1;
        step <= steps;
        step += 1
    ) {

        const progress =
            step / steps;


        /*
         * Smoothstep interpolation:
         *
         * 3t² - 2t³
         *
         * This makes the visible cursor accelerate and
         * decelerate rather than teleporting instantly.
         */

        const eased =
            progress *
            progress *
            (
                3 -
                2 * progress
            );


        const x = Math.round(
            start.x +
            (
                targetX -
                start.x
            ) *
            eased,
        );


        const y = Math.round(
            start.y +
            (
                targetY -
                start.y
            ) *
            eased,
        );


        runXdotool([
            "mousemove",
            String(x),
            String(y),
        ]);


        if (step !== steps) {

            await sleep(delay);

        }

    }


    runXdotool([
        "mousemove",

        String(targetX),
        String(targetY),
    ]);


    return getMousePosition();

}


function textResult(text) {

    return {

        content: [
            {
                type: "text",

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


/* ==========================================================
 * TOOL: display_size
 * ========================================================== */

server.registerTool(

    "display_size",

    {

        description:
            "Return the full X11 desktop width and height in pixels. " +
            "Use this before choosing absolute mouse coordinates.",

        inputSchema: z.object({}),

    },

    async () => {

        return jsonResult(
            getDisplaySize(),
        );

    },

);


/* ==========================================================
 * TOOL: mouse_position
 * ========================================================== */

server.registerTool(

    "mouse_position",

    {

        description:
            "Return the current physical mouse cursor position on the desktop.",

        inputSchema: z.object({}),

    },

    async () => {

        return jsonResult(
            getMousePosition(),
        );

    },

);


/* ==========================================================
 * TOOL: mouse_move
 * ========================================================== */

server.registerTool(

    "mouse_move",

    {

        description:
            "Physically move the real desktop mouse cursor to absolute " +
            "X/Y screen coordinates. The cursor visibly moves on the user's " +
            "XFCE desktop.",

        inputSchema: z.object({

            x: z
                .number()
                .int()
                .describe(
                    "Absolute horizontal screen coordinate in pixels.",
                ),

            y: z
                .number()
                .int()
                .describe(
                    "Absolute vertical screen coordinate in pixels.",
                ),

            duration_ms: z
                .number()
                .int()
                .min(0)
                .max(3000)
                .default(300)
                .describe(
                    "Visible movement duration in milliseconds. " +
                    "Use approximately 250-500 ms for human-like movement.",
                ),

        }),

    },

    async ({
        x,
        y,
        duration_ms,
    }) => {

        const finalPosition =
            await smoothMove(
                x,
                y,
                duration_ms,
            );


        return jsonResult({

            success: true,

            action: "mouse_move",

            position: finalPosition,

        });

    },

);


/* ==========================================================
 * TOOL: mouse_move_relative
 * ========================================================== */

server.registerTool(

    "mouse_move_relative",

    {

        description:
            "Physically move the real desktop cursor relative to its " +
            "current location.",

        inputSchema: z.object({

            dx: z
                .number()
                .int()
                .describe(
                    "Horizontal movement in pixels. Positive is right, negative is left.",
                ),

            dy: z
                .number()
                .int()
                .describe(
                    "Vertical movement in pixels. Positive is down, negative is up.",
                ),

            duration_ms: z
                .number()
                .int()
                .min(0)
                .max(3000)
                .default(250),

        }),

    },

    async ({
        dx,
        dy,
        duration_ms,
    }) => {

        const current =
            getMousePosition();


        const display =
            getDisplaySize();


        const targetX = clamp(
            current.x + dx,
            0,
            display.width - 1,
        );


        const targetY = clamp(
            current.y + dy,
            0,
            display.height - 1,
        );


        const finalPosition =
            await smoothMove(
                targetX,
                targetY,
                duration_ms,
            );


        return jsonResult({

            success: true,

            action: "mouse_move_relative",

            position: finalPosition,

        });

    },

);


/* ==========================================================
 * TOOL: mouse_click
 * ========================================================== */

server.registerTool(

    "mouse_click",

    {

        description:
            "Click the real desktop mouse at its current location. " +
            "Move the cursor first if necessary.",

        inputSchema: z.object({

            button: z
                .enum([
                    "left",
                    "middle",
                    "right",
                ])
                .default("left"),

            count: z
                .number()
                .int()
                .min(1)
                .max(10)
                .default(1),

            interval_ms: z
                .number()
                .int()
                .min(20)
                .max(2000)
                .default(120),

        }),

    },

    async ({
        button,
        count,
        interval_ms,
    }) => {

        const number =
            buttonNumber(button);


        for (
            let index = 0;
            index < count;
            index += 1
        ) {

            runXdotool([
                "click",
                String(number),
            ]);


            if (
                index + 1 < count
            ) {

                await sleep(
                    interval_ms,
                );

            }

        }


        return jsonResult({

            success: true,

            action: "mouse_click",

            button,

            count,

            position:
                getMousePosition(),

        });

    },

);


/* ==========================================================
 * TOOL: mouse_double_click
 * ========================================================== */

server.registerTool(

    "mouse_double_click",

    {

        description:
            "Double-click the real mouse at the current cursor position.",

        inputSchema: z.object({

            button: z
                .enum([
                    "left",
                    "middle",
                    "right",
                ])
                .default("left"),

            interval_ms: z
                .number()
                .int()
                .min(20)
                .max(1000)
                .default(120),

        }),

    },

    async ({
        button,
        interval_ms,
    }) => {

        const number =
            buttonNumber(button);


        runXdotool([
            "click",
            String(number),
        ]);


        await sleep(
            interval_ms,
        );


        runXdotool([
            "click",
            String(number),
        ]);


        return jsonResult({

            success: true,

            action: "mouse_double_click",

            button,

            position:
                getMousePosition(),

        });

    },

);


/* ==========================================================
 * TOOL: mouse_down
 * ========================================================== */

server.registerTool(

    "mouse_down",

    {

        description:
            "Hold down a physical mouse button. Use mouse_up afterward.",

        inputSchema: z.object({

            button: z
                .enum([
                    "left",
                    "middle",
                    "right",
                ])
                .default("left"),

        }),

    },

    async ({
        button,
    }) => {

        runXdotool([
            "mousedown",
            String(
                buttonNumber(button),
            ),
        ]);


        return jsonResult({

            success: true,

            action: "mouse_down",

            button,

        });

    },

);


/* ==========================================================
 * TOOL: mouse_up
 * ========================================================== */

server.registerTool(

    "mouse_up",

    {

        description:
            "Release a physical mouse button previously held with mouse_down.",

        inputSchema: z.object({

            button: z
                .enum([
                    "left",
                    "middle",
                    "right",
                ])
                .default("left"),

        }),

    },

    async ({
        button,
    }) => {

        runXdotool([
            "mouseup",
            String(
                buttonNumber(button),
            ),
        ]);


        return jsonResult({

            success: true,

            action: "mouse_up",

            button,

        });

    },

);


/* ==========================================================
 * TOOL: mouse_scroll
 * ========================================================== */

server.registerTool(

    "mouse_scroll",

    {

        description:
            "Scroll the desktop at the current cursor position. " +
            "Positive clicks scroll down and negative clicks scroll up.",

        inputSchema: z.object({

            clicks: z
                .number()
                .int()
                .min(-30)
                .max(30)
                .describe(
                    "Positive = scroll down. Negative = scroll up.",
                ),

        }),

    },

    async ({
        clicks,
    }) => {

        if (clicks === 0) {

            return jsonResult({

                success: true,

                action: "mouse_scroll",

                clicks: 0,

            });

        }


        const button =
            clicks > 0
                ? 5
                : 4;


        const count =
            Math.abs(clicks);


        for (
            let index = 0;
            index < count;
            index += 1
        ) {

            runXdotool([
                "click",
                String(button),
            ]);


            if (
                index + 1 < count
            ) {

                await sleep(35);

            }

        }


        return jsonResult({

            success: true,

            action: "mouse_scroll",

            clicks,

            position:
                getMousePosition(),

        });

    },

);


/* ==========================================================
 * TOOL: mouse_drag_to
 * ========================================================== */

server.registerTool(

    "mouse_drag_to",

    {

        description:
            "Drag something with the real mouse from the current cursor " +
            "position to an absolute X/Y destination.",

        inputSchema: z.object({

            x: z
                .number()
                .int(),

            y: z
                .number()
                .int(),

            button: z
                .enum([
                    "left",
                    "middle",
                    "right",
                ])
                .default("left"),

            duration_ms: z
                .number()
                .int()
                .min(50)
                .max(5000)
                .default(600),

        }),

    },

    async ({
        x,
        y,
        button,
        duration_ms,
    }) => {

        const number =
            buttonNumber(button);


        runXdotool([
            "mousedown",
            String(number),
        ]);


        try {

            await sleep(75);


            const finalPosition =
                await smoothMove(
                    x,
                    y,
                    duration_ms,
                );


            await sleep(75);


            runXdotool([
                "mouseup",
                String(number),
            ]);


            return jsonResult({

                success: true,

                action: "mouse_drag_to",

                button,

                position:
                    finalPosition,

            });

        } catch (error) {

            try {

                runXdotool([
                    "mouseup",
                    String(number),
                ]);

            } catch {

                // Ignore secondary release failure.

            }


            throw error;

        }

    },

);


/* ==========================================================
 * TOOL: mouse_release_all
 * ========================================================== */

server.registerTool(

    "mouse_release_all",

    {

        description:
            "Emergency recovery tool that releases the left, middle, and " +
            "right mouse buttons if one was accidentally left held down.",

        inputSchema: z.object({}),

    },

    async () => {

        for (const button of [
            1,
            2,
            3,
        ]) {

            try {

                runXdotool([
                    "mouseup",
                    String(button),
                ]);

            } catch {

                // Continue releasing remaining buttons.

            }

        }


        return jsonResult({

            success: true,

            action: "mouse_release_all",

            position:
                getMousePosition(),

        });

    },

);


/* ==========================================================
 * START STDIO MCP SERVER
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


main().catch((error) => {

    console.error(
        `[${SERVER_NAME}] Fatal error:`,
        error,
    );


    process.exit(1);

});
