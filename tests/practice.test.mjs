import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, GUIDED_NOTICE, guidedStart, guidedReply } from '../public/practice.js';

const assertReply = (reply) => {
  for (const key of ['reply', 'reading', 'translation', 'correction']) assert.equal(typeof reply[key], 'string', key);
  assert.equal(typeof reply.stage, 'number');
  assert.equal(typeof reply.complete, 'boolean');
  assert.equal(typeof reply.matched, 'boolean');
  assert.equal(reply.suggestions.length, 3);
  for (const item of reply.suggestions) {
    assert.equal(typeof item.text, 'string');
    assert.equal(typeof item.meaning, 'string');
    assert.ok(item.text && item.meaning);
  }
};

test('the scene catalog and opening replies expose the documented contract', () => {
  assert.deepEqual(SCENES.map(({ id }) => id), ['cafe', 'walk', 'home', 'travel']);
  assert.match(GUIDED_NOTICE, /scripted/i);
  assert.match(GUIDED_NOTICE, /not AI\/free chat/i);
  for (const scene of SCENES) {
    for (const key of ['id', 'label', 'title', 'description', 'goal', 'emoji', 'location', 'theme']) {
      assert.equal(typeof scene[key], 'string', `${scene.id}.${key}`);
      assert.ok(scene[key]);
    }
    const opening = guidedStart(scene.id);
    assertReply(opening);
    assert.equal(opening.stage, 0);
    assert.equal(opening.matched, false);
    assert.equal(opening.complete, false);
    assert.ok(opening.reading && opening.translation);
  }
});

test('every offered Japanese and English choice advances at the expected step', () => {
  for (const scene of SCENES) {
    for (const language of ['ja', 'en']) {
      let current = guidedStart(scene.id, language);
      for (let stage = 0; stage < 4; stage++) {
        for (const suggestion of current.suggestions) {
          const reply = guidedReply(scene.id, stage, suggestion.text, language);
          const context = `${scene.id}/${language}/${stage}: ${suggestion.text}`;
          assertReply(reply);
          assert.equal(reply.matched, true, context);
          assert.equal(reply.stage, stage + 1, context);
          assert.equal(reply.complete, stage === 3, context);
          if (language === 'en') {
            assert.equal(reply.reading, '');
            assert.equal(reply.translation, '');
            for (const item of reply.suggestions) assert.equal(item.text, item.meaning);
          }
        }
        current = guidedReply(scene.id, stage, current.suggestions[0].text, language);
      }
    }
  }
});

test('unrelated or empty input never advances or claims to match', () => {
  for (const { id } of SCENES) {
    for (const language of ['ja', 'en']) {
      for (let stage = 0; stage < 4; stage++) {
        for (const text of ['', 'pineapple moon dust', '宇宙の紫色のピアノ', 'zxqv 12345']) {
          const reply = guidedReply(id, stage, text, language);
          assertReply(reply);
          assert.equal(reply.stage, stage, `${id}/${stage}: ${text}`);
          assert.equal(reply.matched, false);
          assert.equal(reply.complete, false);
          assert.equal(reply.correction, '');
        }
      }
    }
  }
});

test('negative, ambiguous, and accidental substring inputs keep their current step', () => {
  const cases = [
    ['cafe', 0, "I don't want coffee"],
    ['cafe', 0, 'coffee or tea'],
    ['cafe', 0, 'What is coffee?'],
    ['cafe', 1, 'not hot'],
    ['cafe', 1, 'hot or cold'],
    ['cafe', 2, "it's sunny"],
    ['cafe', 2, 'small or large'],
    ['cafe', 3, 'all elephants are purple'],
    ['walk', 1, '春と夏'],
    ['walk', 3, 'not ready'],
    ['home', 0, 'good and busy'],
    ['home', 1, "I don't feel good"],
    ['travel', 1, 'Tokyo or Osaka'],
    ['travel', 2, 'one-way or return'],
    ['travel', 3, 'turn it off'],
  ];
  for (const [id, stage, text] of cases) {
    const reply = guidedReply(id, stage, text);
    assert.equal(reply.matched, false, `${id}/${stage}: ${text}`);
    assert.equal(reply.stage, stage);
    assert.equal(reply.complete, false);
  }
});

test('completion exposes one matched finish and safe restart or scene choices afterward', () => {
  for (const { id } of SCENES) {
    let current = guidedStart(id);
    for (let stage = 0; stage < 4; stage++) current = guidedReply(id, stage, current.suggestions[0].text);
    const events = [current];
    assert.equal(current.complete, true);
    for (const text of ['ありがとう', ...current.suggestions.map(({ text }) => text)]) {
      const repeated = guidedReply(id, 4, text);
      assertReply(repeated);
      assert.equal(repeated.stage, 4);
      assert.equal(repeated.complete, true);
      assert.equal(repeated.matched, false);
      assert.deepEqual(repeated.suggestions.map(({ meaning }) => meaning), ['Start again', 'Change scene', 'Take a break']);
      events.push(repeated);
    }
    assert.equal(events.filter((reply) => reply.complete && reply.matched).length, 1);
    assert.equal(guidedStart(id).stage, 0);
  }
});

test('only a known spelling gets a correction; invalid identifiers safely open the café', () => {
  assert.equal(guidedReply('cafe', 0, 'コーヒーをください。').correction, '');
  const typo = guidedReply('cafe', 0, 'コヒーをください。');
  assert.equal(typo.matched, true);
  assert.match(typo.correction, /コーヒー/);
  for (const id of [null, 'unknown', '__proto__', 'constructor']) {
    assert.deepEqual(guidedStart(id), guidedStart('cafe'));
  }
  assert.equal(guidedReply('cafe', -1, 'coffee').stage, 1);
  assert.equal(guidedReply('cafe', 'invalid', 'coffee').stage, 1);
});
