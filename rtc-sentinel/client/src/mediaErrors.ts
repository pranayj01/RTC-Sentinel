export function mediaErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone permission was denied.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone is available.';
  return 'Unable to access the microphone.';
}
