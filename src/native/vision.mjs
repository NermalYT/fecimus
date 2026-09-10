
import {
    spawnSync,
} from "node:child_process";

import {
    readFileSync,
    writeFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    copyFileSync,
} from "node:fs";

import path from "node:path";
import { screenshotTransform } from "../desktop-workflow.mjs";

import os from "node:os";

import {
    McpServer,
} from "@modelcontextprotocol/server";

import {
    StdioServerTransport,
} from "@modelcontextprotocol/server/stdio";

import * as z from "zod/v4";


const SERVER_NAME =
    "local-fecimus-desktop-vision";

const SERVER_VERSION =
    "1.0.0";


const HOME =
    process.env.HOME;


const VISION_HOME = path.join(process.env.FECIMUS_DATA_DIR || path.join(HOME, '.local/share/fecimus'), 'vision');


const LATEST_IMAGE =
    path.join(
        VISION_HOME,
        "latest.jpg",
    );


mkdirSync(
    VISION_HOME,
    {
        recursive: true,
    },
);


const server =
    new McpServer({

        name:
            SERVER_NAME,

        version:
            SERVER_VERSION,

    });


function run(
    command,
    args,
    timeout = 30000,
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


    if (result.error) {

        throw result.error;

    }


    if (result.status !== 0) {

        const stderr =
            (
                result.stderr ||
                ""
            ).trim();


        const stdout =
            (
                result.stdout ||
                ""
            ).trim();


        throw new Error(
            [
                `${command} failed with exit code ${result.status}.`,
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


function getDisplaySize() {

    const output =
        run(
            "xdotool",
            [
                "getdisplaygeometry",
            ],
        );


    const values =
        output
            .trim()
            .split(/\s+/)
            .map(Number);


    if (
        values.length < 2 ||
        !Number.isFinite(values[0]) ||
        !Number.isFinite(values[1])
    ) {

        throw new Error(
            `Invalid desktop geometry: ${output}`,
        );

    }


    return {

        width:
            values[0],

        height:
            values[1],

    };

}


function getMousePosition() {

    const output =
        run(
            "xdotool",
            [
                "getmouselocation",
                "--shell",
            ],
        );


    const data = {};


    for (
        const line
        of output.split(/\r?\n/)
    ) {

        const separator =
            line.indexOf("=");


        if (separator === -1) {

            continue;

        }


        const key =
            line
                .slice(
                    0,
                    separator,
                )
                .trim();


        const value =
            line
                .slice(
                    separator + 1,
                )
                .trim();


        data[key] =
            value;

    }


    return {

        x:
            Number(
                data.X,
            ),

        y:
            Number(
                data.Y,
            ),

        screen:
            Number(
                data.SCREEN ||
                0,
            ),

    };

}


function getImageSize(
    filename,
) {

    const output =
        run(
            "identify",
            [
                "-format",
                "%w %h",
                filename,
            ],
        );


    const parts =
        output
            .trim()
            .split(/\s+/)
            .map(Number);


    return {

        width:
            parts[0],

        height:
            parts[1],

    };

}


function encodeImage(
    filename,
) {

    return readFileSync(
        filename,
    ).toString(
        "base64",
    );

}


function clamp(
    value,
    minimum,
    maximum,
) {

    return Math.max(
        minimum,
        Math.min(
            maximum,
            value,
        ),
    );

}


function captureDesktop({ region = null, maxWidth = 1536, quality = 82, showCursor = true }) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "fecimus-shot-"));
    const raw = path.join(tempDir, "raw.png");
    const output = path.join(tempDir, "output.jpg");
    try {
        // Reuse a single desktop observation, including the cursor drawn on it.
        const display = getDisplaySize();
        const cursor = getMousePosition();
        const transform = screenshotTransform({
            raw, output, display, cursor, region, showCursor,
            maxWidth: clamp(Math.round(maxWidth), 256, 2048),
            quality: clamp(Math.round(quality), 45, 95),
        });
        run("scrot", [raw]);
        run("convert", transform);
        copyFileSync(output, LATEST_IMAGE);
        return {
            base64: encodeImage(output), imageSize: getImageSize(output), displaySize: display, cursor, path: LATEST_IMAGE,
            region: region || { x: 0, y: 0, width: display.width, height: display.height },
        };
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}


function imageResult(
    capture,
    label,
) {

    const metadata = {

        description:
            label,

        image_width:
            capture.imageSize.width,

        image_height:
            capture.imageSize.height,

        desktop_width:
            capture.displaySize.width,

        desktop_height:
            capture.displaySize.height,

        physical_cursor_x:
            capture.cursor.x,

        physical_cursor_y:
            capture.cursor.y,

        saved_copy:
            capture.path,

        coordinate_space: "fecimus_private_desktop",

        image_to_desktop: {
            origin_x: capture.region.x,
            origin_y: capture.region.y,
            scale_x: capture.region.width / capture.imageSize.width,
            scale_y: capture.region.height / capture.imageSize.height,
        },

    };


    return {

        content: [

            {
                type:
                    "image",

                data:
                    capture.base64,

                mimeType:
                    "image/jpeg",
            },

            {
                type:
                    "text",

                text:
                    JSON.stringify(
                        metadata,
                        null,
                        2,
                    ),
            },

        ],

    };

}


/* ==========================================================
 * TOOL: desktop_screen_info
 * ========================================================== */

server.registerTool(

    "desktop_screen_info",

    {

        description:
            "Return desktop dimensions and the current physical " +
            "mouse cursor coordinates without taking a screenshot.",

        inputSchema:
            z.object({}),

    },

    async () => {

        const result = {

            desktop:
                getDisplaySize(),

            cursor:
                getMousePosition(),

        };


        return {

            content: [
                {
                    type:
                        "text",

                    text:
                        JSON.stringify(
                            result,
                            null,
                            2,
                        ),
                },
            ],

        };

    },

);


/* ==========================================================
 * TOOL: desktop_screenshot
 * ========================================================== */

server.registerTool(

    "desktop_screenshot",

    {

        description:
            "Take a screenshot of the entire physical XFCE desktop " +
            "and return it as an image to the vision model. " +
            "Use this before moving/clicking the mouse when the " +
            "location of an interface element is unknown.",

        inputSchema:
            z.object({

                max_width:
                    z
                        .number()
                        .int()
                        .min(512)
                        .max(2048)
                        .default(1536)
                        .describe(
                            "Maximum returned image width. " +
                            "Use a region capture to inspect small interface text.",
                        ),

                quality:
                    z
                        .number()
                        .int()
                        .min(45)
                        .max(95)
                        .default(82)
                        .describe(
                            "JPEG quality. Higher quality helps read small interface text.",
                        ),

                show_cursor:
                    z
                        .boolean()
                        .default(true)
                        .describe(
                            "Draw a small marker over the real physical cursor position.",
                        ),

            }),

    },

    async ({
        max_width,
        quality,
        show_cursor,
    }) => {

        const capture =
            captureDesktop({

                maxWidth:
                    max_width,

                quality,

                showCursor:
                    show_cursor,

            });


        return imageResult(
            capture,
            "Full XFCE desktop screenshot",
        );

    },

);


/* ==========================================================
 * TOOL: desktop_screenshot_region
 * ========================================================== */

server.registerTool(

    "desktop_screenshot_region",

    {

        description:
            "Take a high-resolution screenshot of a rectangular " +
            "region of the desktop. Useful after a full screenshot " +
            "when the model needs to inspect a menu, dialog, small " +
            "button, text area, or other detailed interface region.",

        inputSchema:
            z.object({

                x:
                    z
                        .number()
                        .int()
                        .min(0),

                y:
                    z
                        .number()
                        .int()
                        .min(0),

                width:
                    z
                        .number()
                        .int()
                        .min(1),

                height:
                    z
                        .number()
                        .int()
                        .min(1),

                max_width:
                    z
                        .number()
                        .int()
                        .min(256)
                        .max(2048)
                        .default(1536),

                quality:
                    z
                        .number()
                        .int()
                        .min(45)
                        .max(95)
                        .default(90),

                show_cursor:
                    z
                        .boolean()
                        .default(true),

            }),

    },

    async ({
        x,
        y,
        width,
        height,
        max_width,
        quality,
        show_cursor,
    }) => {

        const capture =
            captureDesktop({

                region: {

                    x,

                    y,

                    width,

                    height,

                },

                maxWidth:
                    max_width,

                quality,

                showCursor:
                    show_cursor,

            });


        return imageResult(
            capture,
            `Desktop region x=${x}, y=${y}, width=${width}, height=${height}`,
        );

    },

);


/* ==========================================================
 * START SERVER
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
