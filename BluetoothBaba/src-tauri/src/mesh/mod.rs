// The mesh engine: state, the controlled-flood relay, and the send/receive
// paths. Everything here is transport-agnostic — frames go out via
// `app.blemesh().send()` and come in via `handle_frame_b64` (called from the
// `on_packet` command). Events (`message`, `peer-updated`, `mesh-state`) are
// emitted to the webview.

pub mod crypto;
mod packet;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_blemesh::BleMeshExt;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crypto::Identity;
use packet::{Packet, DEFAULT_TTL, TYPE_ANNOUNCE, TYPE_BROADCAST, TYPE_DIRECT, VERSION};

/// Peers not heard from within this window are dropped from the roster.
const PEER_TTL_MS: u64 = 90_000;
/// How many recent message ids to remember for dedup.
const DEDUP_CAP: usize = 1024;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// -------------------------------------------------------------------- dedup

/// Fixed-capacity set of seen message ids (FIFO eviction) so relayed packets
/// don't loop forever across the mesh.
struct Dedup {
    set: HashSet<[u8; 16]>,
    order: VecDeque<[u8; 16]>,
    cap: usize,
}

impl Dedup {
    fn new(cap: usize) -> Self {
        Dedup {
            set: HashSet::new(),
            order: VecDeque::new(),
            cap,
        }
    }

    /// Record an id. Returns true if it was newly inserted (i.e. not a dupe).
    fn insert(&mut self, id: [u8; 16]) -> bool {
        if self.set.contains(&id) {
            return false;
        }
        self.set.insert(id);
        self.order.push_back(id);
        if self.order.len() > self.cap {
            if let Some(old) = self.order.pop_front() {
                self.set.remove(&old);
            }
        }
        true
    }
}

// -------------------------------------------------------------------- state

struct PeerEntry {
    nick: String,
    pub_bytes: [u8; 32],
    last_seen: u64,
}

pub struct MeshState {
    pub identity: Identity,
    pub running: AtomicBool,
    nickname: Mutex<String>,
    seen: Mutex<Dedup>,
    peers: Mutex<HashMap<String, PeerEntry>>,
}

impl MeshState {
    pub fn new(identity: Identity, nickname: String) -> Self {
        MeshState {
            identity,
            running: AtomicBool::new(false),
            nickname: Mutex::new(nickname),
            seen: Mutex::new(Dedup::new(DEDUP_CAP)),
            peers: Mutex::new(HashMap::new()),
        }
    }

    pub fn nickname(&self) -> String {
        self.nickname.lock().unwrap().clone()
    }

    pub fn set_nickname(&self, nick: String) {
        *self.nickname.lock().unwrap() = nick;
    }
}

// ------------------------------------------------------------ serialized I/O

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityOut {
    pub peer_id: String,
    pub pubkey: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerOut {
    peer_id: String,
    nick: String,
    rssi: Option<i32>,
    last_seen: u64,
}

#[derive(Serialize, Clone)]
struct PeersEvent {
    peers: Vec<PeerOut>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MessageOut {
    id: String,
    nick: String,
    text: String,
    ts: u64,
    from_peer_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct MeshStateEvent {
    running: bool,
    error: Option<String>,
}

// JSON packet bodies.
#[derive(Serialize, Deserialize)]
struct AnnounceBody {
    nick: String,
}

#[derive(Serialize, Deserialize)]
struct TextBody {
    nick: String,
    text: String,
    ts: u64,
}

// ------------------------------------------------------------------ helpers

fn peers_out(state: &MeshState) -> Vec<PeerOut> {
    let peers = state.peers.lock().unwrap();
    peers
        .iter()
        .map(|(id, p)| PeerOut {
            peer_id: id.clone(),
            nick: p.nick.clone(),
            rssi: None,
            last_seen: p.last_seen,
        })
        .collect()
}

pub fn peers_json(state: &MeshState) -> Vec<PeerOut> {
    peers_out(state)
}

pub fn identity_out(state: &MeshState) -> IdentityOut {
    IdentityOut {
        peer_id: state.identity.peer_id.clone(),
        pubkey: state.identity.pub_b64.clone(),
    }
}

fn emit_peers(app: &AppHandle, state: &MeshState) {
    let _ = app.emit("peer-updated", PeersEvent { peers: peers_out(state) });
}

pub fn emit_mesh_state(app: &AppHandle, running: bool, error: Option<String>) {
    let _ = app.emit("mesh-state", MeshStateEvent { running, error });
}

fn send_frame(app: &AppHandle, bytes: &[u8]) {
    let b64 = STANDARD.encode(bytes);
    if let Err(e) = app.blemesh().send(b64) {
        log::warn!("blemesh send failed: {e}");
    }
}

fn upsert_peer(state: &MeshState, pub_bytes: &[u8; 32], nick: &str) {
    let peer_id = crypto::peer_id_from_pub(pub_bytes);
    let mut peers = state.peers.lock().unwrap();
    let entry = peers.entry(peer_id).or_insert_with(|| PeerEntry {
        nick: String::new(),
        pub_bytes: *pub_bytes,
        last_seen: 0,
    });
    if !nick.is_empty() {
        entry.nick = nick.to_string();
    }
    entry.pub_bytes = *pub_bytes;
    entry.last_seen = now_ms();
}

fn relay(app: &AppHandle, pkt: &Packet) {
    if pkt.ttl <= 1 {
        return;
    }
    let mut fwd = pkt.clone();
    fwd.ttl -= 1;
    send_frame(app, &fwd.encode());
}

// ------------------------------------------------------------------- outbound

pub fn announce(app: &AppHandle, state: &MeshState) {
    let body = serde_json::to_vec(&AnnounceBody {
        nick: state.nickname(),
    })
    .unwrap_or_default();
    let pkt = Packet {
        version: VERSION,
        msg_type: TYPE_ANNOUNCE,
        ttl: DEFAULT_TTL,
        msg_id: crypto::rand_bytes::<16>(),
        sender_pub: state.identity.pub_bytes,
        recipient_id: None,
        body,
    };
    send_frame(app, &pkt.encode());
}

pub fn send_broadcast(app: &AppHandle, state: &MeshState, text: String) {
    let body = serde_json::to_vec(&TextBody {
        nick: state.nickname(),
        text,
        ts: now_ms(),
    })
    .unwrap_or_default();
    let pkt = Packet {
        version: VERSION,
        msg_type: TYPE_BROADCAST,
        ttl: DEFAULT_TTL,
        msg_id: crypto::rand_bytes::<16>(),
        sender_pub: state.identity.pub_bytes,
        recipient_id: None,
        body,
    };
    send_frame(app, &pkt.encode());
}

pub fn send_direct(
    app: &AppHandle,
    state: &MeshState,
    peer_id: &str,
    text: String,
) -> Result<(), String> {
    let their_pub = {
        let peers = state.peers.lock().unwrap();
        match peers.get(peer_id) {
            Some(p) => p.pub_bytes,
            None => return Err("Peer is not reachable right now.".into()),
        }
    };

    let plaintext = serde_json::to_vec(&TextBody {
        nick: state.nickname(),
        text,
        ts: now_ms(),
    })
    .map_err(|e| e.to_string())?;

    let sealed = crypto::seal(
        &state.identity.secret,
        &state.identity.pub_bytes,
        &their_pub,
        &plaintext,
    )
    .ok_or("Encryption failed.")?;

    let pkt = Packet {
        version: VERSION,
        msg_type: TYPE_DIRECT,
        ttl: DEFAULT_TTL,
        msg_id: crypto::rand_bytes::<16>(),
        sender_pub: state.identity.pub_bytes,
        recipient_id: Some(crypto::recipient_id_from_pub(&their_pub)),
        body: sealed,
    };
    send_frame(app, &pkt.encode());
    Ok(())
}

// -------------------------------------------------------------------- inbound

/// Handle one base64 frame delivered from the native BLE plugin.
pub fn handle_frame_b64(app: &AppHandle, state: &MeshState, data: &str) {
    let bytes = match STANDARD.decode(data) {
        Ok(b) => b,
        Err(_) => return,
    };
    let pkt = match Packet::decode(&bytes) {
        Some(p) => p,
        None => return,
    };
    if pkt.version != VERSION {
        return;
    }
    // Ignore anything that originated from us (our own relayed packets).
    if pkt.sender_pub == state.identity.pub_bytes {
        return;
    }
    // Dedup: first sighting wins; duplicates (from the flood) are dropped.
    let is_new = state.seen.lock().unwrap().insert(pkt.msg_id);
    if !is_new {
        return;
    }

    match pkt.msg_type {
        TYPE_ANNOUNCE => {
            if let Ok(body) = serde_json::from_slice::<AnnounceBody>(&pkt.body) {
                upsert_peer(state, &pkt.sender_pub, &body.nick);
                emit_peers(app, state);
            }
            relay(app, &pkt);
        }
        TYPE_BROADCAST => {
            if let Ok(body) = serde_json::from_slice::<TextBody>(&pkt.body) {
                upsert_peer(state, &pkt.sender_pub, &body.nick);
                let _ = app.emit(
                    "message",
                    MessageOut {
                        id: crypto::to_hex(&pkt.msg_id),
                        nick: body.nick,
                        text: body.text,
                        ts: body.ts,
                        from_peer_id: None,
                    },
                );
                emit_peers(app, state);
            }
            relay(app, &pkt);
        }
        TYPE_DIRECT => {
            let rid = match pkt.recipient_id {
                Some(r) => r,
                None => return,
            };
            let me = crypto::recipient_id_from_pub(&state.identity.pub_bytes);
            if rid == me {
                // Addressed to us: decrypt and surface. Terminal — don't relay.
                if let Some(pt) =
                    crypto::open(&state.identity.secret, &pkt.sender_pub, &rid, &pkt.body)
                {
                    if let Ok(body) = serde_json::from_slice::<TextBody>(&pt) {
                        upsert_peer(state, &pkt.sender_pub, &body.nick);
                        let _ = app.emit(
                            "message",
                            MessageOut {
                                id: crypto::to_hex(&pkt.msg_id),
                                nick: body.nick,
                                text: body.text,
                                ts: body.ts,
                                from_peer_id: Some(crypto::peer_id_from_pub(&pkt.sender_pub)),
                            },
                        );
                        emit_peers(app, state);
                    }
                }
            } else {
                // For someone else: forward it along.
                relay(app, &pkt);
            }
        }
        _ => {}
    }
}

// ------------------------------------------------------------------ lifecycle

pub fn clear_peers(app: &AppHandle, state: &MeshState) {
    state.peers.lock().unwrap().clear();
    emit_peers(app, state);
}

/// Drop stale peers; re-emit the roster if anything changed.
pub fn prune_and_emit(app: &AppHandle, state: &MeshState) {
    let now = now_ms();
    let changed = {
        let mut peers = state.peers.lock().unwrap();
        let before = peers.len();
        peers.retain(|_, p| now.saturating_sub(p.last_seen) < PEER_TTL_MS);
        peers.len() != before
    };
    if changed {
        emit_peers(app, state);
    }
}

pub fn persist_nickname(app: &AppHandle, state: &MeshState) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("nickname.txt"), state.nickname());
    }
}
