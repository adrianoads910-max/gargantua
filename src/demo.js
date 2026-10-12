'use strict';
// A fake galaxy with every state, for screenshots and for trying it without sessions.
const { build } = require('./collect');

const REPOS = [
  ['endurance-api', ['Fix the docking auth flow', 'Add rate limiting to /orbit', 'Migrate to Postgres 17']],
  ['miller-ocean-ui', ['Wave animation is janky on Safari', 'Dark theme tokens']],
  ['mann-ice-station', ['Find why the cryo job leaks memory']],
  ['edmunds-colony', ['Seed the habitat database', 'Write the README in Portuguese', 'Refactor the terraform module']],
  ['tars-firmware', ['Humour setting: 75%', 'Honesty parameter tests']],
  ['cooper-farm', ['Dust storm alerts via SMS']],
];
const TOOLS = [
  ['Edit', 'edit', 'docking.ts'], ['Read', 'read', 'orbit.go'], ['Bash', 'terminal', 'npm test'],
  ['Grep', 'read', 'TODO'], ['WebSearch', 'web', 'tesseract spec'], ['Agent', 'delegate', 'Explore the codebase'],
  ['Write', 'edit', 'README.md'], ['Bash', 'terminal', 'docker compose up'],
];
const PROMPTS = [
  'Can you check why the docking ring fails the handshake when the station rotates faster than 60 rpm?',
  'Faz o deploy em staging e roda os testes de integração, por favor.',
  'Plan B: write a migration that keeps the old colony ids working.',
  'Why is the wave component re-rendering on every scroll?',
];
const REPLIES = [
  'Found it. The handshake compares angular velocity in rpm against a value stored in rad/s, so above ~60 rpm the check always fails.\n\nI changed `docking.ts` to convert both sides to rad/s and added a test that spins the station at 67 rpm. All 142 tests pass.',
  'Deploy em staging concluído. Os testes de integração passaram (38/38). Um aviso: o endpoint /orbit está respondendo em 900ms no p95 — sugiro olhar o índice de `trajectories`.',
  'The migration is written. Old ids are mapped through a view, so nothing downstream breaks. Do you want me to run it against the copy of production first?',
];
const SUBS = [['Explore', 'Map the docking module'], ['code-reviewer', 'Review the migration'], ['general-purpose', 'Benchmark the wave renderer']];

function snapshot() {
  const now = Date.now(), slot = Math.floor(now / 40000); // states change slowly enough to watch the orbits react
  const sessions = [];
  let k = 0;
  for (const [repo, titles] of REPOS) {
    titles.forEach((title, i) => {
      const h = (k * 7 + slot * (k % 3 + 1)) % 11;
      const status = k === 2 ? (slot % 3 === 0 ? 'ask' : 'working') : k === 7 || k === 12 ? 'dormant' : h < 6 ? 'working' : h < 7 ? 'ask' : 'idle';
      const tool = TOOLS[(k + slot) % TOOLS.length];
      const subs = status === 'working' && (k % 3 === 0) ? SUBS.slice(0, 1 + (k + slot) % 3).map(([type, description], j) => ({
        id: 'demo' + k + j, type, description, active: true, activity: TOOLS[(k + j + slot) % TOOLS.length][1], doing: TOOLS[(k + j) % TOOLS.length][2], at: now,
        prompt: description + '. Report back with file paths and a short summary.', reply: j ? '' : 'The docking module lives in src/dock/*. Three entry points…', tools: [],
      })) : [];
      sessions.push({
        id: 'demo-' + k, planet: '/demo/' + repo, planetName: repo, cwd: '/demo/' + repo, title, status,
        activity: status === 'working' ? tool[1] : status, doing: status === 'working' ? tool[0] + ' · ' + tool[2] : status === 'ask' ? 'AskUserQuestion · Which environment should I deploy to?' : '',
        model: k % 4 === 3 ? 'claude-sonnet-5-5' : 'claude-opus-5-5', branch: 'main', entrypoint: 'cli',
        lastTs: status === 'idle' || status === 'dormant' ? now - (k % 4) * 45 * 60000 - 6 * 60000 : now - k * 30000, lastPromptAt: now - k * 61000 - (slot % 5) * 1000,
        prompt: PROMPTS[k % PROMPTS.length].slice(0, 160), turns: 3 + k * 2, tokensOut: 12000 + k * 7331, ctx: 40000 + k * 9000,
        subagents: subs,
        lastPrompt: PROMPTS[k % PROMPTS.length], reply: status === 'working' ? REPLIES[k % 3].split('\n\n')[0] : REPLIES[k % 3], lastReplyAt: now - 4000,
        tools: [0, 1, 2].map(j => { const t = TOOLS[(k + slot + j) % TOOLS.length]; return { name: t[0], what: t[2], kind: t[1], ts: now - (3 - j) * 9000, pending: j === 2 && status === 'working' }; }),
      });
      k++;
    });
  }
  const snap = build(sessions, now);
  snap.demo = true;
  return { snap, sessions };
}

module.exports = {
  snapshot: () => {
    const { snap } = snapshot();
    for (const p of snap.planets) p.sessions = p.sessions.map(s => { const c = Object.assign({}, s); delete c.lastPrompt; delete c.reply; delete c.tools; return c; });
    return snap;
  },
  details: id => snapshot().sessions.find(s => s.id === id) || null,
};
