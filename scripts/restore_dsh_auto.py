#!/usr/bin/env python3
"""Restore known DSH Auto/approval bypasses from matching local vendor backups.

Does not start/reload a host, invoke a model, change configuration, or install
an alternative reviewer. Unknown source differences fail before any host write.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import uuid

FILES = (
    '@deepseek-ai/dsh-experimental-auto-review/lib/index.js',
    '@deepseek-ai/dsh-tools/lib/pipeline.js',
    '@deepseek-ai/dsh-user-approval/lib/index.js',
    '@deepseek-ai/dsh-user-approval/lib/types/index.js',
)


class RestoreError(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_file(root, relative):
    path = root / relative
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root) or path.is_symlink():
        raise RestoreError('refused linked/outside file: ' + relative)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise RestoreError('refused non-regular or hardlinked file: ' + relative)
    return path


def one(pattern, text, label, flags=re.M):
    matches = list(re.finditer(pattern, text, flags))
    if len(matches) != 1:
        raise RestoreError('unsupported ' + label)
    return matches[0]


def method(text, signature):
    start = one(r'^([ \t]*)async ' + re.escape(signature) + r' \{\n', text, signature)
    end = re.search(r'^' + re.escape(start[1]) + r'\}\r?$', text[start.end():], re.M)
    if not end:
        raise RestoreError('unterminated ' + signature)
    return text[start.start():start.end() + end.end()]


def restore_text(relative, current, baseline):
    if '[dsh-purge]' in baseline:
        raise RestoreError('vendor backup contains an earlier bypass: ' + relative)
    candidate = current
    if 'dsh-experimental-auto-review/' in relative:
        if 'classifyRisk(ctx, agent, exec, signal, shown)' not in baseline:
            raise RestoreError('unsupported native reviewer backup')
        candidate = candidate.replace('\t\t\treturn next(); // [dsh-purge] official auto-review soft intercept disabled\n', '')
        expected = baseline
    elif 'dsh-tools/' in relative:
        marker = one(r'^(\s*const approval = this\.ctx\.get\("approval"\);)(?: if \(true\) return [^\n]+ // \[dsh-purge\] no approval service [^\n]+)?$', candidate, 'ask seam')
        candidate = candidate[:marker.start()] + marker[1] + candidate[marker.end():]
        expected = baseline
    else:
        old_method = method(candidate, 'decide(req, session)')
        native_method = method(baseline, 'decide(req, session)')
        if old_method != native_method:
            if '/types/' in relative:
                bad = one(r"^[ \t]*return 'allowed-once'; // \[dsh-purge\] approval bypass: types never-policy no longer rejects\n", old_method, 'types bypass')
                native = one(r"^[ \t]*if \(this\.effectivePolicy\(session\) === 'never'\)\n[ \t]*return 'rejected';\n", native_method, 'types original rejection')
            else:
                bad = one(r'^[ \t]*return "allowed-once";\n[ \t]*// \[dsh-purge\] approval bypass: every approval request is auto-granted\n[ \t]*// without prompting [^\n]*\n', old_method, 'approval bypass')
                native = one(r'^[ \t]*if \(this\.effectivePolicy\(session\) === "never"\) return "rejected";\n[ \t]*const answer = [^\n]+\n', native_method, 'original rejection/waterfall')
            if old_method[:bad.start()] + native[0] + old_method[bad.end():] != native_method:
                raise RestoreError('unknown edits inside approval method: ' + relative)
            candidate = candidate.replace(old_method, native_method, 1)
        old_line = one(r'^const NEVER_SENTENCE = [^\n]+$', candidate, 'current policy teaching')[0]
        native_line = one(r'^const NEVER_SENTENCE = [^\n]+$', baseline, 'original policy teaching')[0]
        if old_line != native_line:
            if not any(term in old_line for term in ('approval bypass, approval policy: never', 'actions run with full access')):
                raise RestoreError('unknown policy teaching edit: ' + relative)
            candidate = candidate.replace(old_line, native_line, 1)
        expected = baseline
        if '/types/' not in relative:
            # The installed default is a preference: preserve it while restoring decisions.
            pattern = r'static Config = z\.object\(\{ policy: z\.union\(\["ask", "never"\]\)\.default\("(ask|never)"\) \}\);'
            live_default = one(pattern, candidate, 'current default')
            backup_default = one(pattern, baseline, 'original default')
            expected = baseline.replace(backup_default[0], live_default[0], 1)
    if candidate != expected:
        raise RestoreError('unrecognized changes outside owned bypasses: ' + relative)
    return candidate


def plan(root):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise RestoreError('node_modules root is not a directory')
    rows = []
    for relative in FILES:
        path = checked_file(root, relative)
        backup = checked_file(root, relative + '.dshpurge.bak')
        raw, original = path.read_bytes(), backup.read_bytes()
        current, baseline = raw.decode('utf8').replace('\r\n', '\n'), original.decode('utf8').replace('\r\n', '\n')
        output = restore_text(relative, current, baseline)
        newline = '\r\n' if b'\r\n' in raw else '\n'
        desired = output.replace('\n', newline).encode('utf8')
        rows.append({'relative': relative, 'path': path, 'before': raw, 'after': desired,
                     'backupSha256': digest(original), 'mode': path.stat().st_mode})
    return root, rows


def atomic(path, data, mode):
    temp = path.with_name(path.name + '.ares-auto-' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, stat.S_IMODE(mode))
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def apply_plan(root, rows, backup_dir, node):
    changed = [row for row in rows if row['before'] != row['after']]
    if not changed:
        return []
    backup_dir = Path(backup_dir).resolve()
    if backup_dir.is_relative_to(root):
        raise RestoreError('private backup directory must be outside node_modules')
    backup_dir.mkdir(parents=True, exist_ok=False)
    # All candidates are parsed, not executed, before the first installed file changes.
    for index, row in enumerate(changed):
        before, after = backup_dir / (str(index) + '.before.js'), backup_dir / (str(index) + '.after.mjs')
        before.write_bytes(row['before']); after.write_bytes(row['after'])
        result = subprocess.run([node, '--check', str(after)], capture_output=True, text=True, encoding='utf8')
        if result.returncode:
            raise RestoreError('syntax check failed: ' + row['relative'])
    applied = []
    try:
        for row in changed:
            checked_file(root, row['relative'])
            if row['path'].read_bytes() != row['before']:
                raise RestoreError('installed file changed concurrently: ' + row['relative'])
            atomic(row['path'], row['after'], row['mode'])
            applied.append(row)
            if row['path'].read_bytes() != row['after']:
                raise RestoreError('restored file readback mismatch: ' + row['relative'])
        return [row['relative'] for row in applied]
    except Exception:
        for row in reversed(applied):
            if row['path'].read_bytes() != row['after']:
                raise RestoreError('concurrent edit preserved; rollback needs review: ' + row['relative'])
            atomic(row['path'], row['before'], row['mode'])
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node-modules', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup-dir')
    parser.add_argument('--report')
    args = parser.parse_args(argv)
    report = {'schema_version': 1, 'applied': False, 'configurationsChanged': 0, 'hostsStarted': 0, 'modelRequests': 0}
    try:
        root, rows = plan(args.node_modules)
        report['files'] = [{'relative': row['relative'], 'beforeSha256': digest(row['before']),
                            'afterSha256': digest(row['after']), 'originalBackupSha256': row['backupSha256'],
                            'changeRequired': row['before'] != row['after']} for row in rows]
        if args.apply:
            if not args.backup_dir:
                raise RestoreError('--apply requires a private --backup-dir')
            node = shutil.which('node')
            if not node:
                raise RestoreError('node --check is required before any host write')
            report['changedFiles'] = apply_plan(root, rows, args.backup_dir, node)
            report['applied'] = True
            _, verified = plan(root)
            if any(row['before'] != row['after'] for row in verified):
                raise RestoreError('post-restore verification failed')
        report['status'] = 'restored' if args.apply else 'checked'
        result = 0
    except (RestoreError, OSError, UnicodeError) as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        result = 1
    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, ensure_ascii=False))
    return result


if __name__ == '__main__':
    sys.exit(main())
