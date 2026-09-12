import { encodePcm16 } from './audioCapture';

test('encodes clamped float samples as little-endian PCM16', () => {
  const encoded = encodePcm16(new Float32Array([-2, -1, 0, 1, 2]));
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);

  expect(view.getInt16(0, true)).toBe(-32768);
  expect(view.getInt16(2, true)).toBe(-32768);
  expect(view.getInt16(4, true)).toBe(0);
  expect(view.getInt16(6, true)).toBe(32767);
  expect(view.getInt16(8, true)).toBe(32767);
});
