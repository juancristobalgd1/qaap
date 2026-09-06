import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("restore_check", Path(__file__).with_name("qaap-backup-restore-check.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RestoreCheckTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="qaap-restore-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "backup.tar.gz"

    def make_archive(self, extra=None, roots=module.ROOTS):
        with tarfile.open(self.archive, "w:gz") as target:
            for name in roots:
                entry = tarfile.TarInfo(name)
                entry.type, entry.mode = tarfile.DIRTYPE, 0o700
                target.addfile(entry)
            entry = tarfile.TarInfo("workspace/example.txt")
            data = b"recoverable content"
            entry.size, entry.mode = len(data), 0o600
            target.addfile(entry, io.BytesIO(data))
            if extra:
                target.addfile(extra, io.BytesIO(b"x") if extra.isfile() else None)
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def test_round_trip(self):
        result = module.restore_check(self.archive, self.root / "restored", self.make_archive())
        self.assertTrue(result["ok"])
        self.assertEqual((self.root / "restored/workspace/example.txt").read_bytes(), b"recoverable content")

    def test_bad_checksum_and_existing_destination(self):
        sha = self.make_archive()
        with self.assertRaises(ValueError):
            module.restore_check(self.archive, self.root / "restored", "f" * 64)
        with self.assertRaises(ValueError):
            module.restore_check(self.archive, self.root, sha)

    def test_missing_state(self):
        sha = self.make_archive(roots=("workspace", "root/.qaap"))
        with self.assertRaises(ValueError):
            module.restore_check(self.archive, self.root / "restored", sha)

    def test_decompression_limit(self):
        sha = self.make_archive()
        with self.assertRaises(ValueError):
            module.restore_check(self.archive, self.root / "restored", sha, max_bytes=100)
        self.assertFalse((self.root / "restored").exists())

    def test_legacy_archive_requires_explicit_opt_in_and_reports_missing_runtime_state(self):
        sha = self.make_archive(roots=module.ROOTS[:3])
        with self.assertRaises(ValueError):
            module.restore_check(self.archive, self.root / "strict", sha)
        result = module.restore_check(self.archive, self.root / "legacy", sha, legacy=True)
        self.assertFalse(result["runtime_state_covered"])

    def test_traversal_absolute_and_duplicate(self):
        for index, name in enumerate(("workspace/../../escape", "/workspace/escape", "workspace/example.txt", "other/file")):
            entry = tarfile.TarInfo(name)
            entry.size = 1
            sha = self.make_archive(entry)
            with self.assertRaises(ValueError):
                module.restore_check(self.archive, self.root / f"restored-{index}", sha)
        self.assertFalse((self.root / "escape").exists())

    def test_escaping_link(self):
        entry = tarfile.TarInfo("workspace/link")
        entry.type, entry.linkname = tarfile.SYMTYPE, "../../escape"
        sha = self.make_archive(entry)
        with self.assertRaises((ValueError, tarfile.TarError)):
            module.restore_check(self.archive, self.root / "restored", sha)

    def test_truncated_archive_even_with_matching_checksum(self):
        self.make_archive()
        self.archive.write_bytes(self.archive.read_bytes()[:-12])
        sha = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        with self.assertRaises((EOFError, OSError, tarfile.TarError)):
            module.restore_check(self.archive, self.root / "restored", sha)


if __name__ == "__main__":
    unittest.main()
