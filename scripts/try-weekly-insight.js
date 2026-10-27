// ANTHROPIC_API_KEY=... node scripts/try-weekly-insight.js [lang] [week]
//
// Runs the weekly insight (functions/weekly-insight.js) on a made-up fortnight
// and prints what the app would show, so the wording can be judged before any
// of it ships. Costs about a cent a run. Never point it at real entries.
//   lang: en (default) or any of the ten app languages
//   week: steady (default) | short-sleep | low
'use strict';
const Anthropic = require('../functions/node_modules/@anthropic-ai/sdk').default;
const { sanitiseDays, weekCounts, writeInsight } = require('../functions/weekly-insight')._lib;

const lang = process.argv[2] || 'en';
const kind = process.argv[3] || 'steady';

function fortnight(thisWeek) {
  const out = [];
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const date = new Date(end.getTime() - i * 864e5).toISOString().slice(0, 10);
    const base = { date, mood: 'stable', energy: 5, sleep: 7.5, steps: 6000, medication: 'taken', anxiety: 'low' };
    out.push(i < 7 ? { ...base, ...thisWeek[6 - i] } : base);
  }
  return out;
}

const WEEKS = {
  steady: Array(7).fill({}).map((d, i) => (i === 3 ? { exercise: 'yes', outside: 'yes', steps: 11000 } : d)),
  'short-sleep': [
    {}, { sleep: 5 }, { mood: 'elevated', energy: 7, sleep: 5 }, { mood: 'elevated', energy: 10, sleep: 5, irritability: 'yes' },
    { sleep: 6.5 }, {}, { sleep: 8.5 },
  ],
  low: [
    { mood: 'low', energy: 3 }, { mood: 'depressed', energy: 0, outside: 'no', steps: 800 },
    { mood: 'depressed', energy: 0, medication: 'not-taken', steps: 400 }, { mood: 'depressed', energy: 3, sleep: 10 },
    { mood: 'low', energy: 3 }, { mood: 'low', energy: 3, outside: 'yes' }, {},
  ],
};

(async () => {
  if (!WEEKS[kind]) throw new Error(`week must be one of: ${Object.keys(WEEKS).join(', ')}`);
  const days   = sanitiseDays(fortnight(WEEKS[kind]));
  const counts = weekCounts(days);
  const insight = await writeInsight(new Anthropic(), days, counts, lang);
  console.log(JSON.stringify({ counts, insight }, null, 2));
  if (!insight) process.exitCode = 1;
})();
