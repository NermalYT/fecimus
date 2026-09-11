#!/usr/bin/env python3
"""Build and verify a self-contained installer without installing Fecimus.

Usage: python3 scripts/build-installer.py [--output /path/install-fecimus.py]
Uses tracked public source files (including working-tree edits), or the explicit
manifest below before Git initialization. Existing installers are backed up.
"""
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import subprocess
import sys
import tempfile
import textwrap
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_FILES = frozenset("""
.gitattributes
.github/ISSUE_TEMPLATE/bug.yml
.github/ISSUE_TEMPLATE/feature.yml
.github/pull_request_template.md
.github/workflows/ci.yml
.gitignore
CHANGELOG.md
CODE_OF_CONDUCT.md
CONTRIBUTING.md
LICENSE
README.md
SECURITY.md
docs/MODELS.md
docs/PERFORMANCE.md
docs/PLATFORMS.md
docs/STUDIO.md
docs/blender-verification.json
docs/models.json
docs/performance-v2.0.json
docs/performance-v2.1.json
package-lock.json
package.json
platform/Linux/INSTALL_FECIMUS.sh
platform/Linux/README.md
platform/Windows/INSTALL_FECIMUS.cmd
platform/Windows/README.md
scripts/benchmark.mjs
scripts/build-installer.py
scripts/check-model.mjs
scripts/install.mjs
scripts/install.ps1
scripts/install.sh
scripts/package-release.py
src/application-paths.mjs
src/browser-output.mjs
src/browser-tools.mjs
src/browser.config.json
src/catalog.mjs
src/config.mjs
src/desktop-tools.mjs
src/desktop-workflow.mjs
src/file-io.mjs
src/file-roots.mjs
src/gateway-core.mjs
src/native/apps.mjs
src/native/keyboard.mjs
src/native/mouse.mjs
src/native/terminal-files.mjs
src/native/vision.mjs
src/platform.mjs
src/runtime-child.py
src/runtime.mjs
src/server.mjs
src/start-browser.mjs
src/studio-job-guard.py
src/studio-tools.mjs
src/version.mjs
test/application-paths.test.mjs
test/browser-output.test.mjs
test/browser-tools.test.mjs
test/catalog-fixture.json
test/catalog.test.mjs
test/check-model.test.mjs
test/desktop-speed.test.mjs
test/desktop-tools.test.mjs
test/file-io.test.mjs
test/file-roots.test.mjs
test/gateway.test.mjs
test/integration-test.mjs
test/lifecycle-test.mjs
test/platform.test.mjs
test/run.mjs
test/studio-tools.test.mjs
test/unit.mjs
test/windows-installer.test.ps1
docs/V3_CAPABILITY_AUDIT.md
scripts/control.mjs
src/agent-runner.mjs
src/control-panel.mjs
src/control-state.mjs
src/help.mjs
src/project-tools.mjs
src/tool-discovery.mjs
src/ui/control-panel.html
src/ui/control-panel.css
src/ui/control-panel.js
src/workspace-tools.mjs
test/agent-runner.test.mjs
test/control-panel.test.mjs
test/project-tools.test.mjs
test/tool-discovery.test.mjs
test/v3-protocol.test.mjs
test/v3-lifecycle.test.mjs
test/workspace-tools.test.mjs
src/service-maintenance.mjs
scripts/maintain.mjs
test/service-maintenance.test.mjs
src/addons.mjs
scripts/addons.mjs
scripts/setup-gui.py
scripts/setup-gui.ps1
docs/SETUP.md
docs/REQUEST_STATUS.md
test/setup-gui.test.mjs
test/addons.test.mjs
test/extensions-protocol.test.mjs
docs/UPGRADING.md
docs/ADDONS.md
.github/ISSUE_TEMPLATE/addon.yml
addons/README.md
examples/hello-addon/fecimus-addon.json
examples/hello-addon/server.mjs
examples/hello-addon/README.md
examples/hello-addon/LICENSE
examples/roblox-studio-addon/fecimus-addon.json
examples/roblox-studio-addon/README.md
examples/roblox-studio-addon/LICENSE
examples/unity-cli-addon/fecimus-addon.json
examples/unity-cli-addon/README.md
examples/unity-cli-addon/LICENSE
""".split())

BOOTSTRAP = r'''#!/usr/bin/env python3
"""Fecimus __VERSION__ source installer. No download is needed to extract the source.

Install on Ubuntu LTS / declared derivatives:
    python3 install-fecimus.py --system-deps
Extract only, with no dependency installation or LM Studio configuration writes:
    python3 install-fecimus.py --extract-only /new/directory
Windows 11 Pro: extract the source and run scripts/install.ps1 from PowerShell.
"""
import argparse
import base64
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import subprocess
import sys

PAYLOAD_SHA256 = "__HASH__"
PAYLOAD = (
__PAYLOAD__
)
MAX_MANIFEST_BYTES = 32 * 1024 * 1024


def validate_payload(payload):
    if not isinstance(payload, dict) or payload.get("format") != 1:
        raise ValueError("Unsupported source manifest.")
    files = payload.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= 1000:
        raise ValueError("Invalid source file list.")
    seen = set()
    decoded = []
    for entry in files:
        if not isinstance(entry, dict):
            raise ValueError("Invalid source entry.")
        name = entry.get("path")
        if (not isinstance(name, str) or not name or "\\" in name or ":" in name
                or "\x00" in name or any(part in ("", ".", "..") for part in name.split("/"))
                or PurePosixPath(name).is_absolute() or name in seen):
            raise ValueError("Unsafe or duplicate source path.")
        if entry.get("mode") not in (0o644, 0o755):
            raise ValueError("Invalid source file mode.")
        content = base64.b64decode(entry.get("data", ""), validate=True)
        if (len(content) != entry.get("size")
                or hashlib.sha256(content).hexdigest() != entry.get("sha256")):
            raise ValueError("Source hash mismatch: " + name)
        seen.add(name)
        decoded.append((name, content, entry["mode"]))
    # A file cannot also be a parent directory of another entry.
    for name in seen:
        if any(str(parent) in seen for parent in PurePosixPath(name).parents):
            raise ValueError("Conflicting source paths.")
    required = {"package.json", "package-lock.json", "scripts/install.sh", "scripts/install.mjs", "scripts/install.ps1", "src/server.mjs"}
    if not required.issubset(seen):
        raise ValueError("Incomplete source package.")
    package = json.loads(next(content for name, content, _ in decoded if name == "package.json"))
    if package.get("version") != payload.get("version"):
        raise ValueError("Source version mismatch.")
    return decoded


def load_payload():
    packed = base64.b85decode(PAYLOAD)
    if hashlib.sha256(packed).hexdigest() != PAYLOAD_SHA256:
        raise ValueError("Embedded source archive hash mismatch.")
    with gzip.GzipFile(fileobj=io.BytesIO(packed)) as stream:
        raw = stream.read(MAX_MANIFEST_BYTES + 1)
    if len(raw) > MAX_MANIFEST_BYTES:
        raise ValueError("Source manifest is too large.")
    payload = json.loads(raw)
    decoded = validate_payload(payload)
    if any(name == "SOURCE_MANIFEST.json" for name, _, _ in decoded):
        raise ValueError("Reserved generated source manifest path.")
    baseline = {"format": 1, "project": "fecimus", "version": payload["version"],
                "files": [{key: entry[key] for key in ("path", "size", "sha256", "mode")} for entry in payload["files"]]}
    decoded.append(("SOURCE_MANIFEST.json", (json.dumps(baseline, indent=2, sort_keys=True) + "\n").encode(), 0o644))
    return payload, decoded


def extract_source(destination, decoded):
    destination = Path(destination).expanduser().absolute()
    # mkdir without exist_ok rejects existing files, directories and symlinks.
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.mkdir(mode=0o700)
    try:
        for name, content, mode in decoded:
            target = destination.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output:
                output.write(content)
            target.chmod(mode)
            if hashlib.sha256(target.read_bytes()).hexdigest() != hashlib.sha256(content).hexdigest():
                raise OSError("Extracted source verification failed: " + name)
    except BaseException:
        shutil.rmtree(destination)
        raise
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--extract-only", metavar="NEW_DIRECTORY", help="Extract and verify source only; destination must not exist.")
    parser.add_argument("--keep-legacy", action="store_true", help="Do not add the default --replace-legacy installer option.")
    options, forwarded = parser.parse_known_args(argv)
    if forwarded[:1] == ["--"]:
        forwarded = forwarded[1:]
    if options.extract_only and (forwarded or options.keep_legacy):
        parser.error("--extract-only cannot be combined with installation options.")
    if not options.extract_only and sys.platform != "linux":
        parser.error("Installation here requires Ubuntu LTS-based Linux. On Windows 11 Pro, use --extract-only and run the extracted scripts/install.ps1 in PowerShell.")
    payload, decoded = load_payload()
    if options.extract_only:
        destination = options.extract_only
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4)
        # The trusted package version is normalized before becoming a path.
        version = str(payload["version"])
        if not version or any(c not in "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-" for c in version):
            raise ValueError("Invalid installation version.")
        destination = Path.home() / ".local/share/fecimus/sources" / (version + "-" + stamp)
    extracted = extract_source(destination, decoded)
    print("Verified {} Fecimus {} source files in {}".format(len(decoded), payload["version"], extracted), flush=True)
    if options.extract_only:
        return 0
    if not options.keep_legacy and "--replace-legacy" not in forwarded:
        forwarded.append("--replace-legacy")
    # install.sh validates the actual Ubuntu base and installs dependencies;
    # install.mjs verifies startup and backs up configuration before replacing it.
    result = subprocess.run(["bash", str(extracted / "scripts/install.sh"), *forwarded], cwd=extracted)
    if result.returncode:
        print("Installation did not complete. The verified source remains at " + str(extracted), file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("Fecimus installer: " + str(error), file=sys.stderr)
        sys.exit(1)
'''


def source_files():
    if (ROOT / ".git").exists():
        result = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True)
        tracked = set(result.stdout.decode("utf-8").split("\0")) - {""}
        missing = PUBLIC_FILES - tracked
        if missing:
            raise ValueError("Stage the public source files before building: " + ", ".join(sorted(missing)))
        # Explicit allowlist prevents accidentally tracked profiles/secrets from
        # entering an installer. Add new public source paths deliberately.
    files = []
    for name in sorted(PUBLIC_FILES):
        file = ROOT / name
        if file.is_symlink() or not file.is_file() or any(parent.is_symlink() for parent in file.parents if parent != ROOT.parent):
            raise ValueError("Missing or symlinked public source: " + name)
        content = file.read_bytes()
        files.append({"path": name, "mode": 0o755 if file.stat().st_mode & 0o111 else 0o644,
                      "size": len(content), "sha256": hashlib.sha256(content).hexdigest(),
                      "data": base64.b64encode(content).decode("ascii")})
    return files


def build_source(files):
    version = json.loads((ROOT / "package.json").read_text())["version"]
    if not isinstance(version, str) or any(c not in "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-" for c in version):
        raise ValueError("Invalid package version.")
    packed = gzip.compress(json.dumps({"format": 1, "version": version, "files": files}, sort_keys=True, separators=(",", ":")).encode(), mtime=0)
    digest = hashlib.sha256(packed).hexdigest()
    encoded = "\n".join("    " + repr(line) for line in textwrap.wrap(base64.b85encode(packed).decode(), 110))
    result = BOOTSTRAP.replace("__VERSION__", version).replace("__HASH__", digest).replace("__PAYLOAD__", encoded)
    compile(result, "install-fecimus.py", "exec")
    return result.encode(), digest


def verify_bootstrap(content, files):
    with tempfile.TemporaryDirectory(prefix="fecimus-bootstrap-check-") as temporary:
        root = Path(temporary)
        bootstrap = root / "install-fecimus.py"
        bootstrap.write_bytes(content)
        target = root / "source"
        command = [sys.executable, str(bootstrap), "--extract-only", str(target)]
        subprocess.run(command, check=True, capture_output=True, text=True)
        expected = {entry["path"]: entry["sha256"] for entry in files}
        version = json.loads(next(base64.b64decode(entry["data"]) for entry in files if entry["path"] == "package.json"))["version"]
        baseline = {"format": 1, "project": "fecimus", "version": version,
                    "files": [{key: entry[key] for key in ("path", "size", "sha256", "mode")} for entry in files]}
        expected["SOURCE_MANIFEST.json"] = hashlib.sha256((json.dumps(baseline, indent=2, sort_keys=True) + "\n").encode()).hexdigest()
        actual = {str(file.relative_to(target).as_posix()): hashlib.sha256(file.read_bytes()).hexdigest()
                  for file in target.rglob("*") if file.is_file()}
        if actual != expected:
            raise ValueError("Extracted source does not match the build manifest.")
        repeated = subprocess.run(command, capture_output=True, text=True)
        if repeated.returncode == 0:
            raise ValueError("Bootstrap unexpectedly overwrote an existing destination.")
        for name, digest in expected.items():
            if hashlib.sha256((target / name).read_bytes()).hexdigest() != digest:
                raise ValueError("Rejected extraction modified an existing file.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=Path.home() / "Downloads/install-fecimus.py")
    options = parser.parse_args()
    files = source_files()
    content, digest = build_source(files)
    verify_bootstrap(content, files)
    output = options.output.expanduser().absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_symlink():
        raise ValueError("Refusing to replace a symlinked installer.")
    backup = None
    if output.exists():
        if output.read_bytes() == content:
            print("Verified installer already current: " + str(output))
            return
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4)
        backup = output.with_name(output.name + ".backup-" + stamp)
        with output.open("rb") as source, backup.open("xb") as destination:
            shutil.copyfileobj(source, destination)
        shutil.copystat(output, backup)
    fd, temporary = tempfile.mkstemp(prefix=output.name + ".tmp-", dir=output.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o755)
        os.replace(temporary, output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print("Built and extraction-verified {} files: {}".format(len(files), output))
    print("Embedded archive SHA256: " + digest)
    if backup:
        print("Previous installer preserved: " + str(backup))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print("Installer build failed: " + str(error), file=sys.stderr)
        sys.exit(1)
