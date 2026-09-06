#!/usr/bin/env python3
"""Rehearse extraction into a NEW scratch directory; never restore live volumes."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile


ROOTS = ("workspace", "root/.qaap", "root/.theia", "tmp/qaap-worktrees", "tmp/qaap-parallel", "home/qaap-tenants")


def digest(stream):
    result = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        result.update(chunk)
    return result.hexdigest()


def restore_check(archive, destination, expected_sha, max_bytes=20 * 1024**3, legacy=False):
    archive, destination = Path(archive), Path(destination)
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha):
        raise ValueError("A SHA-256 digest is required")
    if max_bytes <= 0:
        raise ValueError("A positive decompressed size limit is required")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Destination must not exist: use a new scratch directory")
    if not hasattr(tarfile, "data_filter"):
        raise RuntimeError("Python with tarfile.data_filter is required")
    with archive.open("rb") as stream:
        if digest(stream) != expected_sha:
            raise ValueError("Archive checksum mismatch")
    # Read through the gzip trailer too; tar may stop before noticing trailer damage.
    with gzip.open(archive, "rb") as stream:
        expanded = 0
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            expanded += len(chunk)
            if expanded > max_bytes:
                raise ValueError("Decompressed archive exceeds rehearsal limit")
    destination.mkdir(mode=0o700, parents=False)
    seen, files, directories = set(), {}, {}
    ownership = os.name == "posix" and os.geteuid() == 0

    def safe_member(member, target):
        name = member.name.rstrip("/")
        parts = PurePosixPath(name).parts
        if not name or name.startswith("/") or "\\" in name or ":" in name or ".." in parts or str(PurePosixPath(name)) != name:
            raise ValueError("Unsafe archive path")
        if not any(name == root or name.startswith(root + "/") for root in ROOTS):
            raise ValueError("Entry outside Qaap state roots")
        if name in seen:
            raise ValueError("Duplicate archive entry")
        seen.add(name)
        if len(seen) > 500_000:
            raise ValueError("Too many archive entries")
        if not (member.isdir() or member.isfile() or member.issym() or member.islnk()):
            raise ValueError("Unsupported special file")
        checked = tarfile.data_filter(member, target)
        # Preserve tenant uid/gid and permissions for the rehearsal; never restore
        # setuid/setgid/sticky bits or resolve owner names from the container passwd.
        return checked.replace(uid=member.uid, gid=member.gid, uname=None, gname=None, mode=member.mode & 0o777)

    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            source.extract(member, destination, numeric_owner=True, filter=safe_member)
            name = member.name.rstrip("/")
            if member.isfile():
                with source.extractfile(member) as original:
                    files[name] = (digest(original), member.uid, member.gid, member.mode & 0o777)
            elif member.isdir():
                directories[name] = (member.uid, member.gid, member.mode & 0o777)
    for root in (ROOTS[:3] if legacy else ROOTS):
        if root not in directories or not (destination / root).is_dir():
            raise ValueError("Backup is missing a required state directory")
    # Directory permissions are applied last, just as tar.extractall does.
    for name, (uid, gid, mode) in sorted(directories.items(), key=lambda item: len(item[0]), reverse=True):
        target = destination / name
        os.chmod(target, mode)
        if ownership:
            os.chown(target, uid, gid)
            info = target.stat()
            if (info.st_uid, info.st_gid, info.st_mode & 0o777) != (uid, gid, mode):
                raise ValueError("Restored directory ownership or permissions differ")
    for name, (expected, uid, gid, mode) in files.items():
        target = destination / name
        with target.open("rb") as restored:
            if digest(restored) != expected:
                raise ValueError("Restored file content differs")
        if ownership:
            info = target.stat()
            if (info.st_uid, info.st_gid, info.st_mode & 0o777) != (uid, gid, mode):
                raise ValueError("Restored file ownership or permissions differ")
    for name in ("workspace/.qaap/uid-registry.json", "workspace/.qaap/auth/sessions.json"):
        if name in files:
            with (destination / name).open(encoding="utf-8") as stream:
                if not isinstance(json.load(stream), dict):
                    raise ValueError("Invalid persisted registry/session object")
    with archive.open("rb") as stream:
        if digest(stream) != expected_sha:
            raise ValueError("Archive changed during rehearsal")
    return {"ok": True, "sha256": expected_sha, "files_verified": len(files),
            "entries_verified": len(seen), "ownership_verified": ownership,
            "runtime_state_covered": all(root in directories for root in ROOTS)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("destination")
    parser.add_argument("sha256")
    parser.add_argument("--max-bytes", type=int, default=20 * 1024**3)
    parser.add_argument("--legacy-three-roots", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(restore_check(args.archive, args.destination, args.sha256, args.max_bytes, args.legacy_three_roots)))
    except Exception as error:
        # Never print archive contents or secret-bearing JSON parse input.
        print(json.dumps({"ok": False, "error": type(error).__name__}))
        raise SystemExit(1)
