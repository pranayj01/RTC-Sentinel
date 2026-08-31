import { mediaErrorMessage } from './mediaErrors';

test('reports microphone permission denial', () => {
  expect(mediaErrorMessage(new DOMException('denied', 'NotAllowedError'))).toBe('Microphone permission was denied.');
});

test('reports unavailable microphones', () => {
  expect(mediaErrorMessage(new DOMException('missing', 'NotFoundError'))).toBe('No microphone is available.');
});
