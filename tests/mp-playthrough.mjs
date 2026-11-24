// Co-op playthrough: solves every multiplayer chamber with 2, 3 and 4 players.
// One bot controls each player in turn using only player actions (walk, jump,
// look, interact, grab, create clone). Clones move only by their own AI.
// Run: node tests/mp-playthrough.mjs [level] [players]

import { MP_LEVEL_LIST, mpStages } from '../src/mp/levels.js';
import { Bot } from './bot.mjs';
import { SOLVE } from './mp-solutions.mjs';

const onlyLevel = process.argv[2] ? Number(process.argv[2]) : null;
const onlyN = process.argv[3] ? Number(process.argv[3]) : null;

let failures = 0;
for (const level of MP_LEVEL_LIST) {
  if (onlyLevel && level.id !== onlyLevel) continue;
  for (const n of [2, 3, 4]) {
    if (onlyN && n !== onlyN) continue;
    const ids = Array.from({ length: n }, (_, i) => 'p' + i);
    const b = new Bot(level, { players: ids });
    const t0 = Date.now();
    try {
      SOLVE[level.name](b, n, mpStages(level, n));
      b.waitUntil(() => b.g.completed || b.g.finalSeq, 6, 'team on the exit');
      if (b.g.finalSeq) b.waitUntil(() => b.g.completed, 12, 'final lift');
      const clones = b.g.clonesCreated;
      console.log(`PASS  Co-op ${level.id} ${level.name.padEnd(24)} ${n} players  sim ${b.g.time.toFixed(1)}s  clones ${clones}  (${Date.now() - t0} ms)`);
    } catch (e) {
      failures++;
      console.log(`FAIL  Co-op ${level.id} ${level.name} ${n} players: ${e.message}`);
      for (const pl of b.g.players.values()) console.log(`   ${pl.id} ${pl.body.pos.x.toFixed(2)},${pl.body.pos.y.toFixed(2)},${pl.body.pos.z.toFixed(2)}`);
      console.log(b.log.slice(-12).map((l) => '   ' + l).join('\n'));
    }
  }
}
if (failures) { console.log(`\n${failures} co-op run(s) failed`); process.exit(1); }
console.log('\nEvery co-op chamber completed at 2, 3 and 4 players.');
