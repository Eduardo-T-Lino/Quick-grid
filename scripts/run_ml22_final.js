import { spawnSync } from 'node:child_process';

const commands = process.platform === 'win32'
  ? [
      [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run test:ml22:gate']],
      [process.execPath, ['scripts/test_ml22_final.js']]
    ]
  : [
      ['/bin/sh', ['-c', 'npm run test:ml22:gate']],
      [process.execPath, ['scripts/test_ml22_final.js']]
    ];

let regressionTotal = 0;
let finalTotal = 0;
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(output);
  const regression = output.match(/PASS_LOCAL_GATE:\s*(\d+) total,\s*(\d+) passed,\s*0 failed/);
  const final = output.match(/ML2\.2_FINAL_CHECKS:\s*(\d+) total,\s*(\d+) passed,\s*0 failed/);
  if (regression) regressionTotal = Number(regression[1]);
  if (final) finalTotal = Number(final[1]);
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!regressionTotal || !finalTotal) {
  console.error('FAIL: final gate could not verify both child-suite totals');
  process.exit(1);
}
console.log(`PASS_ML22_FINAL_GATE: ${regressionTotal + finalTotal} total checks; build included once in regression gate`);
