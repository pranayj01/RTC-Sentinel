export interface QualityFeatures {
  rtt: number;
  jitter: number;
  packetLoss: number;
  bitrate: number;
  audioLevel?: number;
}

export type PredictedQuality =
  'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface QualityPrediction {
  quality: PredictedQuality;
  confidence: number;
}

export interface QualityPredictor {
  predict(features: QualityFeatures): Promise<QualityPrediction>;
}

export interface AudioChunk {
  encoding: 'pcm_s16le';
  sampleRate: number;
  pcmBase64: string;
}

export type AudioLabel = 'speech' | 'silence' | 'noise';

export interface AudioAnalysis {
  label: AudioLabel;
  confidence: number;
  durationMs: number;
  features: {
    rmsEnergy: number;
    zeroCrossingRate: number;
    spectralCentroidHz: number;
    mfcc: number[];
    melSpectrogram: number[];
  };
}

export interface AudioAnalyzer {
  analyze(chunk: AudioChunk): Promise<AudioAnalysis>;
}
