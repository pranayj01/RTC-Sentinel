export interface PcmAudioChunk {
  encoding: 'pcm_s16le';
  sampleRate: number;
  pcmBase64: string;
}

export function encodePcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767);
    view.setInt16(index * 2, value, true);
  });
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface AudioSampler {
  sample(): PcmAudioChunk;
  close(): void;
}

export function createAudioSampler(stream: MediaStream): AudioSampler {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 16_384;
  source.connect(analyser);
  void context.resume();

  return {
    sample() {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return {
        encoding: 'pcm_s16le',
        sampleRate: context.sampleRate,
        pcmBase64: encodePcm16(samples),
      };
    },
    close() {
      source.disconnect();
      analyser.disconnect();
      void context.close();
    },
  };
}
