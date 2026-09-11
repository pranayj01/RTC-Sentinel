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
