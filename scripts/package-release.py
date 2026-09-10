#!/usr/bin/env python3
"""Build two platform releases from reviewed public source and verify extraction.

python3 scripts/package-release.py --output-dir dist
python3 scripts/package-release.py --verify dist/Fecimus-VERSION-Linux-Ubuntu-LTS.tar.gz
python3 scripts/package-release.py --self-test

Uses build-installer.py's explicit source allowlist plus the release files below.
Includes working-tree edits; stage all reviewed public source before building.
No dependencies, profiles, credentials, binaries, or local state are bundled.
"""
import argparse
import base64
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import stat
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = "RELEASE_MANIFEST.json"
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024
MAX_FILES = 1000
MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES + MAX_FILES * 2048
EXTRA_PUBLIC_FILES = frozenset("""
scripts/package-release.py
platform/Linux/README.md
platform/Linux/INSTALL_FECIMUS.sh
platform/Windows/README.md
platform/Windows/INSTALL_FECIMUS.cmd
docs/PLATFORMS.md
docs/STUDIO.md
""".split())
PLATFORMS = {
    "linux": ("Linux-Ubuntu-LTS", "platform/Linux/README.md", "platform/Linux/INSTALL_FECIMUS.sh", ".tar.gz"),
    "windows": ("Windows-11-Pro-WSL2", "platform/Windows/README.md", "platform/Windows/INSTALL_FECIMUS.cmd", ".zip"),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(name):
    if (not isinstance(name, str) or not name or "\\" in name or ":" in name
            or any(ord(character) < 32 for character in name)
            or PurePosixPath(name).is_absolute()
            or any(part in ("", ".", "..") or part.endswith((".", " ")) for part in name.split("/"))):
        raise ValueError("Unsafe archive path.")
    for part in name.split("/"):
        if re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part, re.IGNORECASE):
            raise ValueError("Reserved Windows archive filename.")
    return name


def public_source():
    spec = importlib.util.spec_from_file_location("fecimus_installer_builder", ROOT / "scripts/build-installer.py")
    builder = importlib.util.module_from_spec(spec)
    previous_bytecode = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(builder)
    finally:
        sys.dont_write_bytecode = previous_bytecode
    files = {entry["path"]: (base64.b64decode(entry["data"], validate=True), entry["mode"])
             for entry in builder.source_files()}
    for name in sorted(EXTRA_PUBLIC_FILES):
        target = ROOT / name
        if target.is_symlink() or not target.is_file() or any(parent.is_symlink() for parent in target.parents if parent != ROOT.parent):
            raise ValueError("Missing or symlinked public source: " + name)
        files[name] = (target.read_bytes(), 0o755 if name.endswith(".sh") else 0o644)
    # Fail closed when newly added code/docs were omitted from the reviewed manifest.
    extensions = {".mjs", ".js", ".py", ".json", ".md", ".sh", ".ps1", ".cmd", ".yml", ".yaml"}
    for directory in ("src", "scripts", "docs", "test", "platform", ".github"):
        for target in (ROOT / directory).rglob("*"):
            if target.is_file() and target.suffix in extensions and "__pycache__" not in target.parts:
                name = target.relative_to(ROOT).as_posix()
                if name not in files:
                    raise ValueError("Review and add this public file to build-installer.py PUBLIC_FILES: " + name)
    return files


def release_files(source, platform, version):
    _, readme, launcher, _ = PLATFORMS[platform]
    files = dict(source)
    # A root starter document accompanies, rather than replaces, the project README.
    files["START_HERE.md"] = (source[readme][0].replace(b"(../../", b"("), 0o644)
    files[Path(launcher).name] = (source[launcher][0], 0o755 if platform == "linux" else 0o644)
    manifest = {"format": 1, "project": "fecimus", "version": version, "platform": platform,
                "files": [{"path": name, "size": len(data), "sha256": digest(data), "mode": mode}
                          for name, (data, mode) in sorted(files.items())]}
    files[MANIFEST] = ((json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode(), 0o644)
    return files


def pack(files, top, kind):
    output = io.BytesIO()
    if kind == ".zip":
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, (data, mode) in sorted(files.items()):
                entry = zipfile.ZipInfo(top + "/" + safe_path(name), date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = (stat.S_IFREG | mode) << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, data)
    else:
        with gzip.GzipFile(fileobj=output, mode="wb", mtime=0, filename="") as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                for name, (data, mode) in sorted(files.items()):
                    entry = tarfile.TarInfo(top + "/" + safe_path(name))
                    entry.size, entry.mode, entry.mtime = len(data), mode, 0
                    archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


def read_archive(content, kind):
    if len(content) > MAX_ARCHIVE_BYTES:
        raise ValueError("Archive exceeds its size limit.")
    files, total, top = {}, 0, None
    case_names = set()

    def add(name, mode, size, reader):
        nonlocal total, top
        safe_path(name)
        if "/" not in name:
            raise ValueError("Archive files must share one top-level directory.")
        folder, relative = name.split("/", 1)
        if top is None:
            top = folder
        if folder != top or relative in files or relative.casefold() in case_names:
            raise ValueError("Conflicting, duplicate, or mixed-root archive paths.")
        if mode not in (0o644, 0o755) or size < 0 or size > MAX_FILE_BYTES or len(files) >= MAX_FILES:
            raise ValueError("Invalid archive file size, mode, or count.")
        total += size
        if total > MAX_TOTAL_BYTES:
            raise ValueError("Archive exceeds its total size limit.")
        data = reader.read(MAX_FILE_BYTES + 1)
        if len(data) != size:
            raise ValueError("Archive file size mismatch.")
        files[relative] = (data, mode)
        case_names.add(relative.casefold())

    if kind == ".zip":
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            for entry in archive.infolist():
                mode = entry.external_attr >> 16
                if entry.is_dir() or stat.S_IFMT(mode) != stat.S_IFREG:
                    raise ValueError("Only regular files are permitted in a release archive.")
                with archive.open(entry) as reader:
                    add(entry.filename, stat.S_IMODE(mode), entry.file_size, reader)
    else:
        # Bound decompression before tarfile can allocate from extension headers.
        with gzip.GzipFile(fileobj=io.BytesIO(content)) as compressed:
            uncompressed = compressed.read(MAX_ARCHIVE_BYTES + 1)
        if len(uncompressed) > MAX_ARCHIVE_BYTES:
            raise ValueError("Decompressed archive exceeds its size limit.")
        with tarfile.open(fileobj=io.BytesIO(uncompressed), mode="r:") as archive:
            for entry in archive:
                if not entry.isfile() or entry.linkname:
                    raise ValueError("Only regular files are permitted in a release archive.")
                with archive.extractfile(entry) as reader:
                    add(entry.name, entry.mode, entry.size, reader)
    for name in files:
        if any(str(parent).casefold() in case_names for parent in PurePosixPath(name).parents):
            raise ValueError("A file conflicts with a parent directory.")
    return top, files


def verify(content, kind, expected=None):
    top, files = read_archive(content, kind)
    if MANIFEST not in files:
        raise ValueError("Release manifest is missing.")
    manifest = json.loads(files[MANIFEST][0])
    if (manifest.get("format") != 1 or manifest.get("project") != "fecimus"
            or manifest.get("platform") not in PLATFORMS or not isinstance(manifest.get("files"), list)):
        raise ValueError("Invalid release manifest.")
    listed = {}
    for entry in manifest["files"]:
        name = safe_path(entry["path"])
        if name == MANIFEST or name in listed:
            raise ValueError("Invalid or duplicate manifest path.")
        listed[name] = entry
    if set(files) != set(listed) | {MANIFEST}:
        raise ValueError("Archive file inventory does not match its manifest.")
    for name, entry in listed.items():
        data, mode = files[name]
        if len(data) != entry.get("size") or digest(data) != entry.get("sha256") or mode != entry.get("mode"):
            raise ValueError("Archive manifest mismatch: " + name)
    required = {"README.md", "START_HERE.md", "LICENSE", "package.json", "package-lock.json", "src/server.mjs", "scripts/install.sh", "scripts/install.ps1"}
    launcher = Path(PLATFORMS[manifest["platform"]][2]).name
    if not (required | {launcher}).issubset(files):
        raise ValueError("Incomplete release source.")
    if json.loads(files["package.json"][0]).get("version") != manifest.get("version"):
        raise ValueError("Release version does not match package.json.")
    label, _, _, expected_kind = PLATFORMS[manifest["platform"]]
    if top != "Fecimus-" + str(manifest["version"]) + "-" + label or kind != expected_kind:
        raise ValueError("Release directory or archive format does not match its platform manifest.")
    if expected is not None and files != expected:
        raise ValueError("Archive differs from the source snapshot used to build it.")
    # Write only already-validated regular files to a fresh directory, not extractall.
    with tempfile.TemporaryDirectory(prefix="fecimus-release-check-") as temporary:
        root = Path(temporary) / top
        root.mkdir()
        for name, (data, mode) in files.items():
            target = root.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output:
                output.write(data)
            target.chmod(mode)
        extracted = {target.relative_to(root).as_posix(): digest(target.read_bytes()) for target in root.rglob("*") if target.is_file()}
        if extracted != {name: digest(data) for name, (data, _) in files.items()}:
            raise ValueError("Extracted file inventory or hashes differ from the archive.")
        if os.name == "posix" and any(stat.S_IMODE((root / name).stat().st_mode) != mode for name, (_, mode) in files.items()):
            raise ValueError("Extracted file permissions differ from the archive.")
    return {"platform": manifest["platform"], "version": manifest["version"], "files": len(files), "sha256": digest(content), "verified": True}


def write_preserving_previous(target, data):
    if target.is_symlink():
        raise ValueError("Refusing to replace a symlinked output.")
    if target.exists():
        if not target.is_file():
            raise ValueError("Release output is not a regular file.")
        previous = target.read_bytes()
        if previous == data:
            return
        backups = target.parent / "backups"
        backups.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4)
        with (backups / (target.name + "." + stamp)).open("xb") as output:
            output.write(previous)
    fd, name = tempfile.mkstemp(prefix=target.name + ".tmp-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, target)
    finally:
        Path(name).unlink(missing_ok=True)


def self_test():
    source = {name: (b"synthetic fixture\n", 0o644) for name in
              ["README.md", "LICENSE", "package-lock.json", "src/server.mjs", "scripts/install.sh", "scripts/install.ps1"]}
    source["package.json"] = (b'{"version":"0.0.0"}', 0o644)
    for _, readme, launcher, _ in PLATFORMS.values():
        source[readme] = (b"[Source](../../README.md)\n", 0o644)
        source[launcher] = (b"synthetic launcher\n", 0o755 if launcher.endswith(".sh") else 0o644)
    for platform, (label, _, _, kind) in PLATFORMS.items():
        files = release_files(source, platform, "0.0.0")
        packed = pack(files, "Fecimus-0.0.0-" + label, kind)
        assert pack(files, "Fecimus-0.0.0-" + label, kind) == packed
        assert verify(packed, kind, files)["verified"]
        changed = dict(files)
        changed["README.md"] = (b"tampered", 0o644)
        try:
            verify(pack(changed, "Fecimus-0.0.0-" + label, kind), kind)
        except ValueError:
            pass
        else:
            raise AssertionError("Tampering was not rejected.")
        try:
            read_archive(pack({"source": (b"x", 0o644), "source/file": (b"x", 0o644)}, "Fecimus-test", kind), kind)
        except ValueError:
            pass
        else:
            raise AssertionError("File/directory collision was not rejected.")
    for name in ["../escape", "/absolute", "a/../b", "a\\b", "a:b", "a//b", "a/.", "a ", "CON", "a/NUL.txt"]:
        try:
            safe_path(name)
        except ValueError:
            pass
        else:
            raise AssertionError("Unsafe path was not rejected.")
    print("Release self-tests passed: both formats, deterministic builds, manifest/hash checks, extraction, and unsafe-path rejection.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--verify", type=Path, help="Verify an existing platform archive and a fresh extraction.")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.verify:
        kind = ".zip" if args.verify.name.endswith(".zip") else ".tar.gz"
        if args.verify.stat().st_size > MAX_ARCHIVE_BYTES:
            raise ValueError("Archive exceeds its size limit.")
        print(json.dumps(verify(args.verify.read_bytes(), kind), indent=2))
        return
    source = public_source()
    version = json.loads(source["package.json"][0])["version"]
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Invalid release version.")
    artifacts = []
    for platform, (label, _, _, kind) in PLATFORMS.items():
        name = "Fecimus-" + version + "-" + label
        files = release_files(source, platform, version)
        content = pack(files, name, kind)
        report = verify(content, kind, files)
        artifacts.append((name + kind, content, report))
    destination = args.output_dir.expanduser().absolute()
    destination.mkdir(parents=True, exist_ok=True)
    for name, content, report in artifacts:
        write_preserving_previous(destination / name, content)
        print(json.dumps({"archive": str(destination / name), **report}))
    checksums = "".join(digest(content) + "  " + name + "\n" for name, content, _ in artifacts).encode()
    write_preserving_previous(destination / "SHA256SUMS", checksums)
    print("Both platform archives were verified against their source snapshots and extracted manifests.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, zipfile.BadZipFile) as error:
        print("Release packaging failed: " + str(error), file=sys.stderr)
        sys.exit(1)
