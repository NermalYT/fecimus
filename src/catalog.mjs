// Exact, reviewed prose replacements. Unknown backend prose is retained in full:
// future descriptions may introduce constraints that must not be truncated.
const descriptions = new Map([
  ['Search the accessibility snapshot of the current page for text or a regular expression. Returns matching snapshot nodes with a few lines of surrounding context (like search snippets), each shown under its path from the root of the tree, which is cheaper than capturing the whole snapshot when you only need to locate an element and its ref.',
    'Find text/regex in the current accessibility snapshot. Returns matching nodes, refs, tree paths and nearby context; cheaper than a full snapshot.'],
  ['Drop files or MIME-typed data onto an element, as if dragged from outside the page. At least one of "paths" or "data" must be provided.',
    'Drop external files or MIME data onto an element. Provide paths, data, or both.'],
  ['Returns a numbered list of network requests since loading the page. Use browser_network_request with the number to get full details.',
    'List numbered requests since page load. Pass a number to browser_network_request for details.'],
  ['Returns full details (headers and body) of a single network request, or a single part if `part` is set. Use the number from browser_network_requests.',
    'Get request headers/body or selected part by number from browser_network_requests.'],
  ['Capture accessibility snapshot of the current page, this is better than screenshot',
    'Get current page accessibility snapshot; preferred for actions.'],
  ['Go back to the previous page in the history', 'Go back in page history.'],
  ['Run a Playwright code snippet. Unsafe: executes arbitrary JavaScript in the Playwright server process and is RCE-equivalent.',
    'Run arbitrary JavaScript in the Playwright server process (RCE-equivalent).'],
  ['Take a screenshot of the current page. You can\'t perform actions based on the screenshot, use browser_snapshot for actions.',
    'Screenshot current page. Use browser_snapshot for actions; do not act from this screenshot.'],
  ['Return the full X11 desktop width and height in pixels. Use this before choosing absolute mouse coordinates.',
    'AI desktop. Get full X11 width/height in pixels before choosing absolute mouse coordinates.'],
  ['Return the current physical mouse cursor position on the desktop.', 'AI desktop. Get current cursor position.'],
  ["Physically move the real desktop mouse cursor to absolute X/Y screen coordinates. The cursor visibly moves on the user's XFCE desktop.",
    'AI desktop. Move cursor to absolute X/Y screen coordinates.'],
  ['Physically move the real desktop cursor relative to its current location.', 'AI desktop. Move cursor relative to its current position.'],
  ['Click the real desktop mouse at its current location. Move the cursor first if necessary.',
    'AI desktop. Click at current cursor position; move first if needed.'],
  ['Double-click the real mouse at the current cursor position.', 'AI desktop. Double-click at current cursor position.'],
  ['Hold down a physical mouse button. Use mouse_up afterward.', 'AI desktop. Hold mouse button; release with mouse_up.'],
  ['Release a physical mouse button previously held with mouse_down.', 'AI desktop. Release button held with mouse_down.'],
  ['Scroll the desktop at the current cursor position. Positive clicks scroll down and negative clicks scroll up.',
    'AI desktop. Scroll at cursor: positive clicks down, negative up.'],
  ['Drag something with the real mouse from the current cursor position to an absolute X/Y destination.',
    'AI desktop. Drag from current cursor position to absolute X/Y.'],
  ['Emergency recovery tool that releases the left, middle, and right mouse buttons if one was accidentally left held down.',
    'AI desktop. Release left, middle and right mouse buttons for recovery.'],
  ['Return desktop dimensions and the current physical mouse cursor coordinates without taking a screenshot.',
    'AI desktop. Get dimensions and cursor coordinates without a screenshot.'],
  ['Take a screenshot of the entire physical XFCE desktop and return it as an image to the vision model. Use this before moving/clicking the mouse when the location of an interface element is unknown.',
    'AI desktop. Return full XFCE screenshot as an image. Inspect before moving/clicking when element location is unknown.'],
  ['Take a high-resolution screenshot of a rectangular region of the desktop. Useful after a full screenshot when the model needs to inspect a menu, dialog, small button, text area, or other detailed interface region.',
    'AI desktop. Get a high-resolution rectangular screenshot to inspect details after a full screenshot.'],
  ['Type text through the real X11 keyboard into the currently focused application. Use this for ordinary text. For large blocks or Unicode-heavy text, use keyboard_paste_text.',
    'AI desktop. Type ordinary text into focused X11 app. Prefer keyboard_paste_text for large/Unicode text.'],
  ['Paste a block of text into the currently focused application using the X11 clipboard and Ctrl+V. This is faster and more reliable for large or Unicode text. The previous clipboard is restored afterward when possible.',
    'AI desktop. Paste into focused app via X11 clipboard and Ctrl+V; preferred for large/Unicode text. Restore prior clipboard when possible.'],
  ['Press and release a keyboard key on the real XFCE desktop. Examples: Enter, Escape, Tab, BackSpace, Delete, Left, Right, Up, Down, F1 through F12.',
    'AI desktop. Press/release key, e.g. Enter, Escape, Tab, BackSpace, Delete, Left/Right/Up/Down, F1–F12.'],
  ["Press a keyboard shortcut on the real desktop. Examples: ['ctrl','l'], ['ctrl','c'], ['ctrl','shift','t'], ['alt','Tab'], ['ctrl','alt','t'].",
    'AI desktop. Press shortcut, e.g. ["ctrl","l"], ["ctrl","shift","t"], ["alt","Tab"].'],
  ['Hold down a real keyboard key or modifier. Always release it afterward with keyboard_key_up.',
    'AI desktop. Hold key/modifier; always release with keyboard_key_up.'],
  ['Release a key previously held with keyboard_key_down.', 'AI desktop. Release key held with keyboard_key_down.'],
  ['Emergency recovery tool. Releases common modifier keys if one becomes stuck after interrupted automation.',
    'AI desktop. Release common modifier keys for recovery.'],
  ['Search installed graphical desktop applications.', 'AI desktop. Search installed GUI apps.'],
  ['List installed graphical desktop applications.', 'AI desktop. List installed GUI apps.'],
  ['Launch an installed graphical application asynchronously. This returns without waiting for the GUI process to exit.',
    'AI desktop. Launch installed GUI app without waiting for it to exit.'],
  ['List currently open desktop windows.', 'AI desktop. List open windows.'],
  ['Return the currently focused graphical window.', 'AI desktop. Get focused window.'],
  ['Return exact screen position, dimensions, and center coordinates of a desktop window. Prefer this over guessing window coordinates from screenshots.',
    'AI desktop. Get exact window position, dimensions and center; prefer over guessing from screenshots.'],
  ['Focus and bring an existing graphical window to front.', 'AI desktop. Focus and raise existing window.'],
  ['Minimize a graphical window.', 'AI desktop. Minimize window.'],
  ['Maximize a graphical window.', 'AI desktop. Maximize window.'],
  ['Restore a maximized window.', 'AI desktop. Restore maximized window.'],
  ['Request normal closure of a graphical window.', 'AI desktop. Request normal window closure.'],
  ["List files and folders inside a directory under the user's HOME directory.", 'List directory entries under HOME.'],
  ['Return metadata about a file or directory under HOME.', 'Get file/directory metadata under HOME.'],
  ['Read a UTF-8 text file under HOME. Intended for source code, configuration, logs and documents stored as plain text.', 'Read UTF-8 text file under HOME.'],
  ['Create or replace a UTF-8 text file under HOME. Parent directory must already exist.', 'Create/replace UTF-8 file under HOME; parent must exist.'],
  ['Create a directory under HOME, including parent directories if needed.', 'Create directory and missing parents under HOME.'],
  ['Copy one regular file to another location under HOME.', 'Copy one regular file within HOME.'],
  ['Move or rename a file or folder within HOME.', 'Move/rename file or folder within HOME.'],
  ['Move a file or folder under HOME to the desktop Trash instead of permanently deleting it.', 'Move file/folder under HOME to desktop Trash.'],
  ['Search for filenames under a directory inside HOME.', 'Search filenames under a directory in HOME.'],
  ['Return useful information about the local shell environment.', 'Get local shell environment information.'],
  ['Find the executable path for an installed command without executing it.', 'Find installed command path without execution.'],
  ['Run a non-root shell command locally. The working directory must remain inside HOME. Use for compiling, testing, package-manager operations that do not require root, scripts, git, development tools, diagnostics and normal user commands.',
    'Run local non-root shell command (builds, tests, packages, scripts, git, diagnostics). Working directory must remain under HOME.'],
  ['Read loaded text and links from Fecimus browser tabs without selecting or foregrounding them. Works in Fecimus’s hidden browser while the user works elsewhere. Reads beyond the viewport; unloaded lazy content still requires scrolling. Current, all (first 16), or zero-based tab indices. Reports errors and omitted indices individually. Does not access tabs in a separate personal browser.',
    'Read loaded text/links beyond viewport in Fecimus hidden tabs without selecting/foregrounding. Personal browser tabs excluded. Lazy content needs scrolling. Select current, first 16, or zero-based indices. Reports per-tab errors and omitted indices.'],
  ['Read 1–8 HTTP(S) URLs in temporary Fecimus background tabs, up to 3 at once. Returns compact page text, title, links, HTTP status and individual failures. Uses Fecimus browser cookies. Closes only its temporary tabs, preserves existing tabs, and never moves the user’s OS cursor. Waits for DOMContentLoaded; pages requiring later rendering or scrolling may need normal browser tools.',
    'Read 1–8 HTTP(S) URLs in temporary Fecimus background tabs, 3 at once, using Fecimus cookies; return text/title/links/status/per-URL errors. Close only temporary tabs; preserve existing tabs and user cursor. Wait for DOMContentLoaded; later rendering/lazy content may need browser tools.'],

  // Shared and nested parameter guidance; defaults, units and preconditions stay explicit.
  ['Level of the console messages to return. Each level includes the messages of more severe levels. Defaults to "info".', 'Minimum console severity; includes higher levels. Default: info.'],
  ['Return all console messages since the beginning of the session, not just since the last navigation. Defaults to false.', 'Include messages since session start; otherwise since last navigation. Default: false.'],
  ['Filename to save the console messages to. If not provided, messages are returned as text.', 'Save messages to file; omit to return text.'],
  ['Filename to save the result to. If not provided, result is returned as text.', 'Save result to file; omit to return text.'],
  ['Filename to save the result to. If not provided, output is returned as text.', 'Save result to file; omit to return text.'],
  ['Filename to save the network requests to. If not provided, requests are returned as text.', 'Save requests to file; omit to return text.'],
  ['Whether to accept the dialog.', 'Accept dialog if true.'],
  ['The text of the prompt in case of a prompt dialog.', 'Text for prompt dialog.'],
  ['Human-readable element description used to obtain permission to interact with the element', 'Element description for interaction permission.'],
  ['Human-readable source element description used to obtain the permission to interact with the element', 'Source element description for interaction permission.'],
  ['Human-readable target element description used to obtain the permission to interact with the element', 'Target element description for interaction permission.'],
  ['Exact target element reference from the page snapshot, or a unique element selector', 'Snapshot ref only (e.g. e12), or a unique selector; do not copy the full labeled snapshot line.'],
  ['The absolute paths to the files to upload. Can be single file or multiple files. If omitted, file chooser is cancelled.', 'Absolute file paths; omit to cancel file chooser.'],
  ['Absolute paths to files to drop onto the element.', 'Absolute file paths to drop.'],
  ['Data to drop, as a map of MIME type to string value (e.g. {"text/plain": "hello", "text/uri-list": "https://example.com"}).', 'MIME type → string map, e.g. {"text/plain":"hello"}.'],
  ['Plain text to search for in the page snapshot (case-insensitive substring match). Provide either text or regex, not both.', 'Case-insensitive snapshot substring. Provide text or regex, not both.'],
  ['Regular expression to search for in the page snapshot. Matching is case-sensitive by default; wrap the pattern in slashes to add flags, e.g. "/error/i" for case-insensitive. Provide either text or regex, not both.',
    'Snapshot regex; case-sensitive by default. Use /pattern/flags, e.g. /error/i, for flags. Provide text or regex, not both.'],
  ['Value to fill in the field. If the field is a checkbox, the value should be `true` or `false`. If the field is a combobox, the value should be the text of the option.', 'Field value: checkbox "true"/"false"; combobox option text.'],
  ['Name of the key to press or a character to generate, such as `ArrowLeft` or `a`', 'Key name or character, e.g. ArrowLeft or a.'],
  ['Text to type into the element', 'Text to type.'],
  ['Whether to submit entered text (press Enter after)', 'Press Enter after typing.'],
  ['Whether to type one character at a time. Useful for triggering key handlers in the page. By default entire text is filled in at once.', 'Type character by character to trigger key handlers; default fills entire text at once.'],
  ['Button to click, defaults to left', 'Mouse button; default: left.'],
  ['Button to press, defaults to left', 'Mouse button; default: left.'],
  ['Number of clicks, defaults to 1', 'Click count; default: 1.'],
  ['Time to wait between mouse down and mouse up in milliseconds, defaults to 0', 'Mouse down-to-up delay in milliseconds; default: 0.'],
  ['Whether to include successful static resources like images, fonts, scripts, etc. Defaults to false.', 'Include successful static resources (images/fonts/scripts); default: false.'],
  ['Only return requests whose URL matches this regexp (e.g. "/api/.*user").', 'URL regex filter, e.g. /api/.*user.'],
  ['1-based index of the request, as printed by browser_network_requests.', '1-based request index from browser_network_requests.'],
  ['Return only this part of the request. Omit to return full details.', 'Return this part only; omit for full details.'],
  ['File name to save the pdf to. Defaults to `page-{timestamp}.pdf` if not specified. Prefer relative file names to stay within the output directory.', 'PDF filename; default: page-{timestamp}.pdf. Prefer relative paths in output directory.'],
  ['A JavaScript function containing Playwright code to execute. It will be invoked with a single argument, page, which you can use for any page interaction. For example: `async (page) => { await page.getByRole(\'button\', { name: \'Submit\' }).click(); return await page.title(); }`',
    'Playwright function receiving one argument, page, for page interactions; e.g. async (page) => await page.title().'],
  ['Load code from the specified file. If both code and filename are provided, code will be ignored.', 'Load code from file; overrides code when both supplied.'],
  ['Image format for the screenshot. If unset, inferred from the filename extension, otherwise png.', 'Image format; default from filename extension, or png.'],
  ['File name to save the screenshot to. Defaults to `page-{timestamp}.{png|jpeg|webp}` if not specified. Prefer relative file names to stay within the output directory.', 'Screenshot filename; default: page-{timestamp}.{png|jpeg|webp}. Prefer relative paths in output directory.'],
  ['When true, takes a screenshot of the full scrollable page, instead of the currently visible viewport. Cannot be used with element screenshots.', 'Capture full scrollable page instead of viewport. Incompatible with element screenshots.'],
  ['Image resolution scale. "css" produces a screenshot sized in CSS pixels (smaller, consistent across devices). "device" produces a high-resolution screenshot using device pixels (larger, accounts for the device pixel ratio). Default is css.',
    'css: smaller, device-independent CSS pixels (default). device: higher resolution device pixels using device pixel ratio.'],
  ['Save snapshot to markdown file instead of returning it in the response.', 'Save snapshot to Markdown file instead of response.'],
  ["Include each element's bounding box as [box=x,y,width,height] in the snapshot. Coordinates are viewport-relative, in CSS pixels (Element.getBoundingClientRect)", 'Include [box=x,y,width,height] per element: viewport-relative CSS pixels (getBoundingClientRect).'],
  ['Whether to perform a double click instead of a single click', 'Double-click instead of single-click.'],
  ['Array of values to select in the dropdown. This can be a single value or multiple values.', 'One or more dropdown values to select.'],
  ['Tab index, used for close/select. If omitted for close, current tab is closed.', 'Tab index for close/select; omit for close to close current tab.'],
  ['URL to navigate to in the new tab, used for new.', 'URL for new tab.'],
  ['The time to wait in seconds', 'Wait time in seconds.'],
  ['The text to wait for to disappear', 'Wait for this text to disappear.'],
  ['Absolute horizontal screen coordinate in pixels.', 'Absolute screen X in pixels.'],
  ['Absolute vertical screen coordinate in pixels.', 'Absolute screen Y in pixels.'],
  ['Visible movement duration in milliseconds. Use approximately 250-500 ms for human-like movement.', 'Movement duration in milliseconds; about 250–500 ms for human-like movement.'],
  ['Horizontal movement in pixels. Positive is right, negative is left.', 'Horizontal pixels: positive right, negative left.'],
  ['Vertical movement in pixels. Positive is down, negative is up.', 'Vertical pixels: positive down, negative up.'],
  ["Maximum returned image width. 1536 preserves this laptop's full desktop width.", 'Maximum image width in pixels; 1536 retains the configured full desktop width.'],
  ['JPEG quality. Higher quality helps read small interface text.', 'JPEG quality; higher improves small-text legibility.'],
  ['Draw a small marker over the real physical cursor position.', 'Mark AI desktop cursor position.']
]);

const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const schemaLists = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const schemaValues = new Set(['additionalItems', 'additionalProperties', 'contains', 'contentSchema', 'else', 'if', 'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties']);

function compactSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const result = { ...schema };
  delete result.title;
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'title') continue; // JSON Schema display metadata only.
    if (key === 'description') result[key] = descriptions.get(value) ?? value;
    else if (schemaMaps.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, compactSchema(child)]));
    } else if (schemaLists.has(key) && Array.isArray(value)) result[key] = value.map(compactSchema);
    else if (key === 'items') result[key] = Array.isArray(value) ? value.map(compactSchema) : compactSchema(value);
    else if (key === 'dependencies' && value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, Array.isArray(child) ? child : compactSchema(child)]));
    } else if (schemaValues.has(key)) result[key] = compactSchema(value);
    else result[key] = value;
  }
  return result;
}

/** Compact advertising only; preserve tool names, annotations, outputSchema and validation keywords. */
export function compactTool(tool) {
  const result = structuredClone(tool);
  if (typeof result.description === 'string') result.description = descriptions.get(result.description) ?? result.description;
  if (result.inputSchema) result.inputSchema = compactSchema(result.inputSchema);
  return result;
}
