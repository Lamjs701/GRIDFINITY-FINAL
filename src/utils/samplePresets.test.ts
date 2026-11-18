import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_A4_PRESETS,
  createParametricPresetTool,
  duplicatePlacedTool,
} from './samplePresets';

test('SAMPLE_A4_PRESETS exposes 3 distinct sample tools', () => {
  assert.equal(SAMPLE_A4_PRESETS.length, 3);
  const ids = new Set(SAMPLE_A4_PRESETS.map((p) => p.id));
  assert.equal(ids.size, 3);
});

test('createParametricPresetTool builds centered valid cutouts for all preset types', () => {
  const pill = createParametricPresetTool('pill-slot', 83.75, 41.75);
  assert.equal(pill.tool.contour.length, 0);
  assert.equal(pill.fingerPockets.length, 1);
  assert.equal(pill.x, 83.75);

  const tray = createParametricPresetTool('utility-tray', 83.75, 41.75);
  assert.ok(tray.tool.contour.length >= 12);
  assert.equal(tray.fingerPockets.length, 1);

  const hex = createParametricPresetTool('hex-bit-strip', 83.75, 41.75);
  assert.ok(hex.tool.contour.length >= 8);

  const sd = createParametricPresetTool('sd-usb-rack', 83.75, 41.75);
  assert.ok(sd.tool.contour.length >= 12);
});

test('duplicatePlacedTool creates a distinct instanceId and stays within bin bounds', () => {
  const original = createParametricPresetTool('utility-tray', 80, 40);
  const dup = duplicatePlacedTool(original, 167.5, 83.5);
  assert.notEqual(dup.instanceId, original.instanceId);
  assert.notEqual(dup.fingerPockets[0].id, original.fingerPockets[0].id);
  assert.ok(dup.x >= 12 && dup.x <= 167.5 - 12);
  assert.ok(dup.y >= 12 && dup.y <= 83.5 - 12);
});
