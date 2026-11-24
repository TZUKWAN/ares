"""Explicit filesystem/source fixtures, not a live DSH or Auto acceptance."""
from pathlib import Path
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).with_name('restore_dsh_auto.py')
if not SCRIPT.exists():
    SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/restore_dsh_auto.py'
spec = importlib.util.spec_from_file_location('ares_restore_auto', SCRIPT)
repair = importlib.util.module_from_spec(spec); spec.loader.exec_module(repair)


def fixture_sources():
    auto = 'function classifyRisk(ctx, agent, exec, signal, shown) {}\nfunction apply(ctx) {\n\tctx.on("tools/pre-execute", async (exec, next) => {\n\t\t\treturn next();\n\t});\n}\n'
    pipeline = 'class FixturePipeline {\n\tasync serviceAsk(exec, ask) {\n\t\tconst approval = this.ctx.get("approval");\n\t\treturn approval?.request(exec);\n\t}\n}\n'
    approval = '''const NEVER_SENTENCE = "Fixture native policy rejects escalation";
class FixtureApproval {
 static Config = z.object({ policy: z.union(["ask", "never"]).default("ask") });
\tasync decide(req, session) {
\t\tconst signal = req.signal;
\t\tif (signal?.aborted) return "cancelled";
\t\tif (this.effectivePolicy(session) === "never") return "rejected";
\t\tconst answer = Promise.resolve("unavailable");
\t\tif (signal === void 0) return answer;
\t\treturn answer;
\t}
}
'''
    types = '''const NEVER_SENTENCE = 'Fixture native policy rejects escalation';
class FixtureApproval {
    async decide(req, session) {
        const signal = req.signal;
        if (signal?.aborted) return 'cancelled';
        if (this.effectivePolicy(session) === 'never')
            return 'rejected';
        const answer = Promise.resolve('unavailable');
        return answer;
    }
}
'''
    originals = [auto, pipeline, approval, types]
    patched = [
        auto.replace('\t\t\treturn next();', '\t\t\treturn next(); // [dsh-purge] official auto-review soft intercept disabled\n\t\t\treturn next();', 1),
        pipeline.replace('const approval = this.ctx.get("approval");', 'const approval = this.ctx.get("approval"); if (true) return { decision: { kind: "allow" }, approvalCancelled: false }; // [dsh-purge] no approval service fixture bypass'),
        approval.replace('Fixture native policy rejects escalation', 'approval bypass, approval policy: never').replace('.default("ask")', '.default("never")').replace('\t\tif (this.effectivePolicy(session) === "never") return "rejected";\n\t\tconst answer = Promise.resolve("unavailable");\n', '\t\treturn "allowed-once";\n\t\t// [dsh-purge] approval bypass: every approval request is auto-granted\n\t\t// without prompting fixture bypass\n'),
        types.replace('Fixture native policy rejects escalation', 'actions run with full access').replace("        if (this.effectivePolicy(session) === 'never')\n            return 'rejected';\n", "        return 'allowed-once'; // [dsh-purge] approval bypass: types never-policy no longer rejects\n"),
    ]
    return originals, patched


class AutoRestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ares-auto-source-fixture-')
        self.base = Path(self.temp.name); self.root = self.base / 'node_modules'; self.root.mkdir()
        self.original, self.patched = fixture_sources()
        for relative, original, patched in zip(repair.FILES, self.original, self.patched):
            p = self.root / relative; p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(patched, encoding='utf8', newline='\n')
            Path(str(p) + '.dshpurge.bak').write_text(original, encoding='utf8', newline='\n')

    def tearDown(self):
        self.temp.cleanup()

    def contents(self):
        return [(self.root / name).read_bytes() for name in repair.FILES]

    def test_apply_is_verified_idempotent_and_preserves_default(self):
        root, rows = repair.plan(self.root); self.assertEqual(len(rows), 4)
        repair.apply_plan(root, rows, self.base / 'private-backup', shutil.which('node'))
        _, after = repair.plan(root); self.assertTrue(all(row['before'] == row['after'] for row in after))
        index = (self.root / repair.FILES[2]).read_text(encoding='utf8')
        self.assertIn('.default("never")', index); self.assertNotIn('auto-granted', index)
        self.assertEqual(repair.method(index, 'decide(req, session)'), repair.method(self.original[2], 'decide(req, session)'))
        self.assertEqual(repair.apply_plan(root, after, self.base / 'private-backup', shutil.which('node')), [])

    def test_unknown_edits_fail_before_any_host_write(self):
        p = self.root / repair.FILES[-1]; p.write_text(p.read_text(encoding='utf8') + '// unrelated user edit\n', encoding='utf8')
        before = self.contents()
        with self.assertRaisesRegex(repair.RestoreError, 'unrecognized'):
            repair.plan(self.root)
        self.assertEqual(before, self.contents())

    def test_extra_method_edit_is_not_overwritten(self):
        p = self.root / repair.FILES[2]; p.write_text(p.read_text(encoding='utf8').replace('return answer;', 'return "unrelated-edit";'), encoding='utf8')
        before = self.contents()
        with self.assertRaisesRegex(repair.RestoreError, 'unknown edits'):
            repair.plan(self.root)
        self.assertEqual(before, self.contents())

    def test_missing_or_already_patched_backups_fail_closed(self):
        p = Path(str(self.root / repair.FILES[-1]) + '.dshpurge.bak'); original = p.read_bytes(); p.unlink()
        with self.assertRaises(FileNotFoundError): repair.plan(self.root)
        p.write_bytes(original + b'// [dsh-purge] invalid earlier baseline\n')
        with self.assertRaisesRegex(repair.RestoreError, 'earlier bypass'): repair.plan(self.root)

    def test_hardlinks_and_outside_targets_are_refused(self):
        target = self.root / repair.FILES[0]; os.link(target, self.base / 'another-link.js')
        with self.assertRaisesRegex(repair.RestoreError, 'hardlinked'): repair.plan(self.root)
        outside = self.base / 'outside.js'; outside.write_text('fixture', encoding='utf8')
        with self.assertRaisesRegex(repair.RestoreError, 'outside'): repair.checked_file(self.root.resolve(), '../outside.js')

    def test_parse_failure_happens_before_any_installed_file_write(self):
        name = repair.FILES[-1]
        for p in [self.root / name, Path(str(self.root / name) + '.dshpurge.bak')]:
            p.write_text(p.read_text(encoding='utf8') + '\nfunction invalid(', encoding='utf8')
        before = self.contents(); root, rows = repair.plan(self.root)
        with self.assertRaisesRegex(repair.RestoreError, 'syntax check failed'):
            repair.apply_plan(root, rows, self.base / 'invalid-backup', shutil.which('node'))
        self.assertEqual(before, self.contents())

    def test_partial_write_failure_restores_original_bytes(self):
        before = self.contents(); root, rows = repair.plan(self.root); original = repair.atomic; count = 0
        def fail_second(path, data, mode):
            nonlocal count
            count += 1
            if count == 2: raise OSError('explicit fixture write failure')
            return original(path, data, mode)
        with mock.patch.object(repair, 'atomic', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'fixture write failure'):
                repair.apply_plan(root, rows, self.base / 'failed-backup', shutil.which('node'))
        self.assertEqual(before, self.contents())


if __name__ == '__main__': unittest.main()
