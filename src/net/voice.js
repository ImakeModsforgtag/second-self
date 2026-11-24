// Optional voice chat: a small WebRTC mesh (at most 3 peers each), signalled
// through the game server. Players who switch voice on can hear and talk to
// each other. Audio never touches the game server.

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

export class Voice {
  constructor(net) {
    this.net = net;
    this.on = false;
    this.muted = false;
    this.stream = null;
    this.peers = new Map();      // uid -> { pc, audio }
    this.myUid = null;
    net.on('rtc', (m) => this._signal(m.from, m.data));
  }

  get supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection); }

  async enable() {
    if (this.on) return true;
    if (!this.supported) throw new Error('Voice chat is not supported in this browser.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    this.on = true;
    this.setMuted(false);
    this.net.send({ type: 'voice', on: true });
    return true;
  }

  disable() {
    this.on = false;
    for (const uid of [...this.peers.keys()]) this._close(uid);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.net.send({ type: 'voice', on: false });
  }

  setMuted(m) {
    this.muted = m;
    if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = !m;
  }

  /** Call from every lobby update: connect to teammates who also have voice on. */
  sync(players, myUid) {
    this.myUid = myUid;
    const want = new Set(this.on ? players.filter((p) => p.uid !== myUid && p.voice && p.connected).map((p) => p.uid) : []);
    for (const uid of [...this.peers.keys()]) if (!want.has(uid)) this._close(uid);
    for (const uid of want) if (!this.peers.has(uid) && myUid < uid) this._call(uid);
  }

  _peer(uid) {
    let p = this.peers.get(uid);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = new Audio();
    audio.autoplay = true;
    p = { pc, audio };
    this.peers.set(uid, p);
    if (this.stream) for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ type: 'rtc', to: uid, data: { ice: e.candidate } }); };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this._close(uid); };
    return p;
  }

  async _call(uid) {
    const { pc } = this._peer(uid);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.net.send({ type: 'rtc', to: uid, data: { sdp: pc.localDescription } });
  }

  async _signal(from, data) {
    if (!this.on || !data) return;
    try {
      const { pc } = this._peer(from);
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          this.net.send({ type: 'rtc', to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.ice) await pc.addIceCandidate(data.ice);
    } catch (e) { console.warn('voice signal', e); }
  }

  _close(uid) {
    const p = this.peers.get(uid);
    if (!p) return;
    try { p.pc.close(); } catch { /* */ }
    p.audio.srcObject = null;
    this.peers.delete(uid);
  }
}
