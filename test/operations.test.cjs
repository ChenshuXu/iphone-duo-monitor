const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
const backupCommand = /```sh\n([\s\S]*?)```/.exec(
  readme.slice(readme.indexOf('备份时先暂停并停止服务')),
)[1];

function backup(t, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(
    path.join(dir, 'bin/docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$BACKUP_TEST_LOG"
case "$2" in
  stop) test "$BACKUP_TEST_MODE" != stop-fails ;;
  run) if test "$BACKUP_TEST_MODE" != empty; then printf 'NEW_BACKUP'; fi; test "$BACKUP_TEST_MODE" != backup-fails ;;
  start) exit 0 ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o700 },
  );
  const file = path.join(dir, 'monitor-backup.tar.gz');
  fs.writeFileSync(file, 'OLD_BACKUP', { mode: 0o600 });
  const result = spawnSync('sh', ['-c', backupCommand], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
      BACKUP_TEST_MODE: mode,
      BACKUP_TEST_LOG: path.join(dir, 'calls'),
    },
    encoding: 'utf8',
  });
  return {
    result,
    file,
    calls: fs.readFileSync(path.join(dir, 'calls'), 'utf8'),
    files: fs.readdirSync(dir),
  };
}

test('documented backup preserves the old archive and fails when Docker backup fails', (t) => {
  const { result, file, calls, files } = backup(t, 'backup-fails');
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'OLD_BACKUP');
  assert.ok(!calls.includes('compose start'));
  assert.deepEqual(
    files.filter((f) => f.startsWith('monitor-backup')),
    ['monitor-backup.tar.gz'],
  );
});
test('documented backup does not start copying if the service could not be stopped', (t) => {
  const { result, file, calls } = backup(t, 'stop-fails');
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'OLD_BACKUP');
  assert.ok(!calls.includes('compose run'));
  assert.ok(!calls.includes('compose start'));
});
test('documented backup rejects an empty successful output without replacing the old archive', (t) => {
  const { result, file, calls } = backup(t, 'empty');
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'OLD_BACKUP');
  assert.ok(!calls.includes('compose start'));
});
test('documented backup replaces the archive only after success and keeps private file permissions', (t) => {
  const { result, file, calls, files } = backup(t, 'success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), 'NEW_BACKUP');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(calls.indexOf('compose stop') < calls.indexOf('compose run'));
  assert.ok(calls.indexOf('compose run') < calls.indexOf('compose start'));
  assert.deepEqual(
    files.filter((f) => f.startsWith('monitor-backup')),
    ['monitor-backup.tar.gz'],
  );
});
