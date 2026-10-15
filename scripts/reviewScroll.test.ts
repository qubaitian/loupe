import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewScrollTop } from '../web/src/lib/reviewScroll.ts';

test('long notes align at their code anchors and interpolate within each interval', () => {
  const anchors = [{ code: 100, note: 300 }, { code: 200, note: 900 }];
  assert.equal(reviewScrollTop(100, 400, 1400, anchors), 300);
  assert.equal(reviewScrollTop(150, 400, 1400, anchors), 600);
  assert.equal(reviewScrollTop(200, 400, 1400, anchors), 900);
  assert.equal(reviewScrollTop(300, 400, 1400, anchors), 1150);
});

test('sparse notes keep the same scroll position when both sides have room', () => {
  const anchors = [{ code: 100, note: 100 }, { code: 400, note: 400 }];
  assert.equal(reviewScrollTop(250, 600, 600, anchors), 250);
});

test('both scroll limits remain reachable, including anchors at or beyond the code limit', () => {
  const anchors = [{ code: 100, note: 200 }, { code: 400, note: 800 }, { code: 500, note: 1000 }];
  assert.equal(reviewScrollTop(-20, 400, 1400, anchors), 0);
  assert.equal(reviewScrollTop(400, 400, 1400, anchors), 1400);
  assert.equal(reviewScrollTop(450, 400, 1400, anchors), 1400);
});

test('folded or repeated line anchors do not cause jumps or division by zero', () => {
  const anchors = [{ code: 0, note: 20 }, { code: 100, note: 300 }, { code: 100, note: 600 }];
  assert.equal(reviewScrollTop(100, 400, 1400, anchors), 300);
  assert.equal(reviewScrollTop(250, 400, 1400, anchors), 850);
});

test('short content leaves independent note scrolling available', () => {
  assert.equal(reviewScrollTop(0, 0, 1000, []), 0);
  assert.equal(reviewScrollTop(200, 400, 0, []), 0);
});

test('mapping stays bounded and monotonic when note anchors reach the pane bottom', () => {
  const anchors = [{ code: 100, note: 900 }, { code: 200, note: 1200 }];
  let previous = 0;
  for (let position = 0; position <= 400; position++) {
    const next = reviewScrollTop(position, 400, 1000, anchors);
    assert.ok(next >= previous && next <= 1000);
    previous = next;
  }
});
