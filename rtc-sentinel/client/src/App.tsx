import { useState } from 'react';
import { useWebRtcCall } from './useWebRtcCall';

const duration = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
const milliseconds = (value: number | null) => value === null ? '—' : `${value.toFixed(0)} ms`;

function RttChart({ values }: { values: Array<number | null> }) {
  const samples = values.filter((value): value is number => value !== null);
  if (samples.length < 2) return <p className="chart-empty">Collecting RTT history…</p>;
  const maximum = Math.max(...samples, 1);
  const points = samples.map((value, index) => `${(index / (samples.length - 1)) * 320},${76 - (value / maximum) * 64}`).join(' ');
  return <svg className="rtt-chart" viewBox="0 0 320 80" role="img" aria-label="Recent round trip time">
    <title>Recent round trip time</title><polyline points={points} />
  </svg>;
}

export function App() {
  const call = useWebRtcCall(); const [roomInput, setRoomInput] = useState('');
  const active = call.status !== 'idle' && call.status !== 'ended' && call.status !== 'error';
  return (
    <main className="shell"><section className="call-card">
      <p className="eyebrow">WebRTC voice calling</p><h1>RTC Sentinel</h1>
      <p className="intro">Private peer-to-peer audio with real-time Socket.IO signaling.</p>
      {!active ? <div className="actions">
        <button className="primary" onClick={() => void call.createCall()}>Create Call</button>
        <div className="join-row"><label htmlFor="room">Room ID</label>
          <input id="room" maxLength={6} placeholder="ABC123" value={roomInput} onChange={(event) => setRoomInput(event.target.value.toUpperCase())} />
          <button disabled={roomInput.trim().length !== 6} onClick={() => void call.joinCall(roomInput)}>Join Call</button>
        </div>
      </div> : <div className="session">
        <div className="room-line"><span>Room</span><strong>{call.roomId}</strong>
          <button className="quiet" onClick={() => void navigator.clipboard.writeText(call.roomId)}>Copy Room ID</button></div>
        <div className="status-grid"><div><span>Microphone</span><strong>{call.muted ? 'MUTED' : 'ON'}</strong></div>
          <div><span>Call Status</span><strong data-status={call.status}>{call.statusLabel}</strong></div>
          <div><span>Network Path</span><strong>{call.candidateType.toUpperCase()}</strong></div></div>
        <section className="qos-panel" aria-label="Call quality metrics">
          <div className="qos-heading"><div><span>Live QoS monitoring</span><h2>{duration(call.durationSeconds)}</h2></div>
            <span className="live-indicator">● 3s samples</span></div>
          <div className="metric-grid">
            <div><span>Round Trip Time</span><strong>{milliseconds(call.qosMetric?.rtt ?? null)}</strong></div>
            <div><span>Jitter</span><strong>{milliseconds(call.qosMetric?.jitter ?? null)}</strong></div>
            <div><span>Packet Loss</span><strong>{call.qosMetric ? `${call.qosMetric.packetLoss.toFixed(2)}%` : '—'}</strong></div>
            <div><span>Bitrate</span><strong>{call.qosMetric ? `${(call.qosMetric.bitrate / 1000).toFixed(1)} kbps` : '—'}</strong></div>
            <div><span>Packets</span><strong>{call.qosMetric ? `${call.qosMetric.packetsSent} ↑ ${call.qosMetric.packetsReceived} ↓` : '—'}</strong></div>
            <div><span>Audio Level</span><strong>{call.qosMetric?.audioLevel == null ? '—' : `${Math.round(call.qosMetric.audioLevel * 100)}%`}</strong></div>
            <div className="wide"><span>Codec</span><strong>{call.qosMetric?.codec ?? 'Discovering'}</strong></div>
          </div>
          <div className="chart"><span>RTT history</span><RttChart values={call.qosHistory.map((metric) => metric.rtt)} /></div>
        </section>
        <div className="controls"><button onClick={call.toggleMute}>{call.muted ? 'Unmute' : 'Mute'}</button>
          <button className="danger" onClick={call.endCall}>End Call</button></div>
      </div>}
      {call.error && <p role="alert" className="error">{call.error}</p>}
      <audio ref={call.remoteAudioRef} autoPlay />
    </section></main>
  );
}
