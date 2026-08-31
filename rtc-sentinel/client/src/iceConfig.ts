export interface IceConfigOverrides {
  stunUrl?: string;
  turnUrl?: string;
  turnTcpUrl?: string;
  turnUsername?: string;
  turnCredential?: string;
  transportPolicy?: RTCIceTransportPolicy;
}

export function createIceConfiguration(
  hostname: string,
  overrides: IceConfigOverrides = {},
  forceRelay = false,
): RTCConfiguration {
  return {
    iceServers: [
      { urls: overrides.stunUrl || `stun:${hostname}:3478` },
      {
        urls: [
          overrides.turnUrl || `turn:${hostname}:3478?transport=udp`,
          overrides.turnTcpUrl || `turn:${hostname}:3478?transport=tcp`,
        ],
        username: overrides.turnUsername || 'rtc-sentinel',
        credential: overrides.turnCredential || 'local-development-turn-secret',
      },
    ],
    iceTransportPolicy: forceRelay ? 'relay' : (overrides.transportPolicy ?? 'all'),
  };
}

export async function selectedCandidateType(peer: RTCPeerConnection): Promise<string> {
  const stats = await peer.getStats();
  let pair: RTCStats | undefined;
  stats.forEach((report) => {
    if (report.type === 'transport' && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId);
    if (!pair && report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') pair = report;
  });
  if (!pair) return 'unknown';
  const local = stats.get((pair as RTCIceCandidatePairStats).localCandidateId) as { candidateType?: string } | undefined;
  return local?.candidateType ?? 'unknown';
}
