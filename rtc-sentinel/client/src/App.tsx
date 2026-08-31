import { useState } from 'react';
import { useWebRtcCall } from './useWebRtcCall';

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
          <div><span>Call Status</span><strong data-status={call.status}>{call.statusLabel}</strong></div></div>
        <div className="controls"><button onClick={call.toggleMute}>{call.muted ? 'Unmute' : 'Mute'}</button>
          <button className="danger" onClick={call.endCall}>End Call</button></div>
      </div>}
      {call.error && <p role="alert" className="error">{call.error}</p>}
      <audio ref={call.remoteAudioRef} autoPlay />
    </section></main>
  );
}
