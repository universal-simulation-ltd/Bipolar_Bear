// node scripts/test-crisis-bot.js — checks functions/crisis-bot.js's matching.
'use strict';
const assert = require('assert');
const { looksLikeCrisis, crisisReplyText } = require('../functions/crisis-bot');

const yes = [
  'I need to talk to someone asap, I feel like this is the only thing that can help me..',
  'I want to die',
  "I don’t want to be here anymore",
  'thinking about suicide again',
  'I keep thinking about killing myself',
  "I can't go on like this",
  'been self-harming again',
  'I took an overdose last night',
  'Everyone would be better off without me',
  'I need help now',
  'voglio morire',
  'Ho bisogno di parlare con qualcuno',
  'Ich will sterben',
  'quiero morir',
  '我想死',
];
const no = [
  'Had a good day today, stable for a week 🙌',
  'Does anyone else get tired on quetiapine?',
  'I need to talk to my GP about my dose',
  'Talking to someone helped me a lot last year',
  'The diet is killing me lol',
  '',
];
yes.forEach((t) => assert.ok(looksLikeCrisis(t), 'should match: ' + t));
no.forEach((t) => assert.ok(!looksLikeCrisis(t), 'should not match: ' + t));
assert.ok(crisisReplyText('Marta').startsWith('Hi [Marta], it sounds'));
assert.ok(crisisReplyText('').startsWith('It sounds'));
assert.ok(/116 123/.test(crisisReplyText('x')) && /85258/.test(crisisReplyText('x')));
console.log(`crisis-bot: ${yes.length} matches, ${no.length} non-matches — all pass`);
