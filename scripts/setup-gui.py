#!/usr/bin/env python3
"""Native Linux setup/addon window. CLI fallback remains available without GTK."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent


def node_command():
    candidates = [shutil.which('node'), str(Path.home() / '.local/share/fecimus/node/bin/node')]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            result = subprocess.run([candidate, '-e', 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)'], capture_output=True, timeout=10)
            if result.returncode == 0:
                return candidate
    raise RuntimeError('Install Fecimus first: Node.js 22 or newer is required for addons.')


def addon_command(action, folder=None):
    if action not in ('list', 'inspect', 'install'):
        raise ValueError('Unsupported setup action')
    command = [node_command(), str(ROOT / 'scripts/addons.mjs'), action]
    if action != 'list':
        target = Path(folder).resolve(strict=True)
        if not target.is_dir():
            raise ValueError('Choose the extracted folder containing fecimus-addon.json.')
        command.append(str(target))
    if action == 'install':
        command.append('--trust')
    return command


def install_worker(result_path):
    result = Path(result_path)
    code = 1
    result.with_suffix('.started').write_text(str(os.getpid()))
    child = None
    def interrupted(signum, _frame):
        if child and child.poll() is None:
            child.terminate()
        raise SystemExit(128 + signum)
    for signum in (signal.SIGHUP, signal.SIGTERM):
        signal.signal(signum, interrupted)
    try:
        with result.with_suffix('.log').open('wb') as output:
            child = subprocess.Popen(['bash', str(ROOT / 'platform/Linux/INSTALL_FECIMUS.sh'), '--no-gui'], env={**os.environ, 'FECIMUS_NO_PAUSE': '1'}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            while True:
                chunk = os.read(child.stdout.fileno(), 4096)
                if not chunk:
                    break
                output.write(chunk)
                output.flush()
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            code = child.wait()
    finally:
        if child and child.poll() is None:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        temporary = result.with_suffix('.tmp')
        temporary.write_text(json.dumps({'exit_code': code}))
        temporary.replace(result)
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--check', action='store_true', help='Check GUI dependencies without opening a window')
    args = parser.parse_args()
    if args.worker:
        return install_worker(args.worker)
    try:
        import gi
        gi.require_version('Gtk', '3.0')
        from gi.repository import Gtk, Gdk, GLib
    except ImportError:
        print('Graphical setup needs python3-gi and gir1.2-gtk-3.0. Install those packages or run bash platform/Linux/INSTALL_FECIMUS.sh --no-gui.', file=sys.stderr)
        return 1
    if args.check:
        return 0
    if os.geteuid() == 0:
        print('Launch Fecimus setup as your ordinary desktop user, not root.', file=sys.stderr)
        return 1
    css = Gtk.CssProvider()
    css.load_from_data(b'''window {background:#101820;color:#e7f2f3;} label {color:#e7f2f3;} button {background:#243742;color:#fff;border-radius:9px;padding:12px;border:0;} button:hover {background:#345361;} .primary {background:#117d70;} .title {font-size:36px;font-weight:bold;} .subtitle {color:#96b9c0;} textview text {background:#17252f;color:#d5e8ec;}''')
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    window = Gtk.Window(title='Fecimus · Setup & addons')
    window.set_default_size(790, 640)
    window.set_border_width(28)
    layout = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
    window.add(layout)
    def label(text, style=None):
        widget = Gtk.Label(label=text, xalign=0)
        widget.set_line_wrap(True)
        if style:
            widget.get_style_context().add_class(style)
        layout.pack_start(widget, False, False, 0)
        return widget
    label('FECIMUS / 3.0', 'subtitle')
    label('Your workspace. Extended.', 'title')
    label('One MCP connection. A private desktop, background browser and tools for your projects.', 'subtitle')
    label('Install a fresh source copy and connect LM Studio. Existing configuration is backed up; six legacy Fecimus connections are replaced. A terminal handles sudo prompts.')
    buttons = Gtk.Box(spacing=10)
    layout.pack_start(buttons, False, False, 0)
    install = Gtk.Button(label='Install / upgrade Fecimus')
    install.get_style_context().add_class('primary')
    choose = Gtk.Button(label='Install addon…')
    listing = Gtk.Button(label='My addons')
    for button in (install, choose, listing):
        buttons.pack_start(button, True, True, 0)
    status = label('Ready · Ubuntu LTS / Linux Mint · Setup requires internet access', 'subtitle')
    scroll = Gtk.ScrolledWindow()
    scroll.set_min_content_height(220)
    log = Gtk.TextView(editable=False, cursor_visible=False, wrap_mode=Gtk.WrapMode.WORD_CHAR)
    log.set_left_margin(12)
    log.set_right_margin(12)
    scroll.add(log)
    layout.pack_start(scroll, True, True, 0)
    label('Studio applications and models are installed separately. Addons run with your account permissions. Restart Fecimus after installing an addon.', 'subtitle')
    state = {'busy': False}
    def show(message, details=''):
        status.set_text(message)
        if details:
            log.get_buffer().set_text(str(details)[-30000:])
    def busy(value):
        state['busy'] = value
        for button in (install, choose, listing):
            button.set_sensitive(not value)
    def background(work, done):
        busy(True)
        def run():
            try:
                value, error = work(), None
            except Exception as exc:
                value, error = None, str(exc)
            def finish():
                busy(False)
                if error:
                    show('Action failed', error)
                else:
                    done(value)
                return False
            GLib.idle_add(finish)
        threading.Thread(target=run, daemon=True).start()
    def call_addon(action, folder=None):
        completed = subprocess.run(addon_command(action, folder), capture_output=True, text=True, timeout=60)
        if completed.returncode:
            raise RuntimeError(completed.stderr or completed.stdout)
        return completed.stdout
    def on_choose(_):
        picker = Gtk.FileChooserDialog(title='Choose extracted addon folder', parent=window, action=Gtk.FileChooserAction.SELECT_FOLDER)
        picker.add_buttons('Cancel', Gtk.ResponseType.CANCEL, 'Review addon', Gtk.ResponseType.OK)
        selected = picker.get_filename() if picker.run() == Gtk.ResponseType.OK else None
        picker.destroy()
        if not selected:
            return
        def inspected(details):
            show('Review addon before installation', details)
            prompt = Gtk.MessageDialog(transient_for=window, modal=True, message_type=Gtk.MessageType.WARNING, buttons=Gtk.ButtonsType.OK_CANCEL, text='Install this trusted addon?')
            prompt.format_secondary_text(details[:6000] + '\n\nIt can execute code with your account permissions when Fecimus restarts. Install only source you trust. Nothing is uploaded to GitHub.')
            trusted = prompt.run() == Gtk.ResponseType.OK
            prompt.destroy()
            if trusted:
                background(lambda: call_addon('install', selected), lambda value: show('Addon installed · restart Fecimus to activate', value))
        background(lambda: call_addon('inspect', selected), inspected)
    def on_install(_):
        terminal = shutil.which('x-terminal-emulator')
        if not terminal:
            show('No desktop terminal found', 'Run bash platform/Linux/INSTALL_FECIMUS.sh --no-gui from a terminal.')
            return
        directory = tempfile.TemporaryDirectory(prefix='fecimus-setup-')
        result = Path(directory.name) / 'result.json'
        try:
            process = subprocess.Popen([terminal, '-e', sys.executable, str(Path(__file__).resolve()), '--worker', str(result)])
        except OSError as exc:
            directory.cleanup()
            show('Could not open installation terminal', str(exc))
            return
        busy(True)
        show('Installing · follow the terminal for progress and sudo prompts')
        def poll():
            if not result.exists():
                started = result.with_suffix('.started')
                if started.exists():
                    try:
                        os.kill(int(started.read_text()), 0)
                    except ProcessLookupError:
                        result.write_text(json.dumps({'exit_code': 1}))
                elif process.poll() is not None:
                    show('Installation terminal closed before setup started', 'Run the terminal installer with --no-gui to see the error.')
                    busy(False)
                    directory.cleanup()
                    return False
                return True
            try:
                code = json.loads(result.read_text())['exit_code']
                show('Installed · restart LM Studio and enable mcp/fecimus' if code == 0 else 'Installation failed · review the terminal output', result.with_suffix('.log').read_text(errors='replace')[-30000:] if result.with_suffix('.log').exists() else f'Installer exit code: {code}. See docs/SETUP.md for recovery.')
            finally:
                busy(False)
                directory.cleanup()
            return False
        GLib.timeout_add(1000, poll)
    def closing(*_):
        if state['busy']:
            show('An action is still running · wait for its result before closing')
            return True
        Gtk.main_quit()
        return False
    install.connect('clicked', on_install)
    choose.connect('clicked', on_choose)
    listing.connect('clicked', lambda _: background(lambda: call_addon('list'), lambda value: show('Installed addons', value)))
    window.connect('delete-event', closing)
    window.show_all()
    Gtk.main()
    return 0


if __name__ == '__main__':
    sys.exit(main())
