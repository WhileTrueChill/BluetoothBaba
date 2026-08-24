// Backend bridge. In a real Tauri build this talks to the Rust mesh engine
// (invoke) and the native BLE plugin (addPluginListener). Run as a plain web
// page (e.g. `npm run dev` in a browser) it falls back to a lively MOCK so the
// UI can be developed and reviewed without an Android device.

import {
  addMessage,
  notify,
  state,
  upsertPeer,
  PUBLIC_ROOM,
  type Identity,
  type Peer,
} from "./state";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface MeshApi {
  init(): Promise<void>;
  getIdentity(): Promise<Identity>;
  setNickname(nick: string): Promise<void>;
  startMesh(): Promise<void>;
  stopMesh(): Promise<void>;
  sendBroadcast(text: string): Promise<void>;
  sendDirect(peerId: string, text: string): Promise<void>;
  getPeers(): Promise<Peer[]>;
}

const rid = (): string =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

function addLocalOutgoing(room: string, text: string): void {
  addMessage({
    id: rid(),
    text,
    ts: Date.now(),
    mine: true,
    nick: state.nickname || "Me",
    room,
  });
  notify();
}

/* ------------------------------------------------------------------ real */

// Wire-level event payloads emitted by the Rust side.
interface MessageEvent {
  id: string;
  nick: string;
  text: string;
  ts: number;
  fromPeerId: string | null; // null => Public room
}
interface PeersEvent {
  peers: Peer[];
}
interface MeshStateEvent {
  running: boolean;
  error: string | null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function realInit(): Promise<void> {
  const { listen } = await import("@tauri-apps/api/event");
  const { addPluginListener } = await import("@tauri-apps/api/core");

  await listen<MessageEvent>("message", (e) => {
    const p = e.payload;
    addMessage({
      id: p.id,
      text: p.text,
      ts: p.ts,
      mine: false,
      nick: p.nick,
      room: p.fromPeerId ?? PUBLIC_ROOM,
    });
    notify();
  });

  await listen<PeersEvent>("peer-updated", (e) => {
    state.peers.clear();
    for (const pr of e.payload.peers) upsertPeer(pr);
    notify();
  });

  await listen<MeshStateEvent>("mesh-state", (e) => {
    state.meshRunning = e.payload.running;
    state.meshError = e.payload.error;
    notify();
  });

  // Inbound BLE frames arrive from the native plugin as base64 on the
  // "packet" event; hand them straight to Rust for dedupe/relay/decrypt.
  await addPluginListener(
    "blemesh",
    "packet",
    (payload: { data: string }) => {
      invoke("on_packet", { data: payload.data }).catch((err) =>
        console.error("on_packet failed", err),
      );
    },
  );
}

const realApi: MeshApi = {
  init: realInit,
  getIdentity: () => invoke<Identity>("get_identity"),
  setNickname: (nick) => invoke<void>("set_nickname", { nick }),
  startMesh: () => invoke<void>("start_mesh"),
  stopMesh: () => invoke<void>("stop_mesh"),
  sendBroadcast: async (text) => {
    addLocalOutgoing(PUBLIC_ROOM, text);
    await invoke<void>("send_broadcast", { text });
  },
  sendDirect: async (peerId, text) => {
    addLocalOutgoing(peerId, text);
    await invoke<void>("send_direct", { peerId, text });
  },
  getPeers: () => invoke<Peer[]>("get_peers"),
};

/* ------------------------------------------------------------------ mock */

const MOCK_PEERS: Peer[] = [
  { peerId: "a1b2c3d4e5f6a1b2", nick: "Ava", rssi: -49, lastSeen: Date.now() },
  { peerId: "0f9e8d7c6b5a4938", nick: "Kai", rssi: -73, lastSeen: Date.now() },
];

function mockReply(t: string): string {
  const replies = [
    "Got it 👍",
    "On my way.",
    "haha nice",
    "Loud and clear over the mesh.",
    "Copy that.",
    "Where are you?",
  ];
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) | 0;
  return replies[Math.abs(hash) % replies.length];
}

function simulateReply(room: string, nick: string, text: string): void {
  window.setTimeout(() => {
    addMessage({
      id: rid(),
      text: mockReply(text),
      ts: Date.now(),
      mine: false,
      nick,
      room,
    });
    notify();
  }, 750 + Math.random() * 600);
}

const mockApi: MeshApi = {
  init: async () => {},
  getIdentity: async () => ({
    peerId: "7f3a9c1e5b2d8046",
    pubkey: "bW9jay1wdWJsaWMta2V5LWZvci1kZW1vLW9ubHk=",
  }),
  setNickname: async () => {},
  startMesh: async () => {
    state.meshRunning = true;
    state.meshError = null;
    notify();
    window.setTimeout(() => {
      for (const p of MOCK_PEERS) upsertPeer({ ...p, lastSeen: Date.now() });
      addMessage({
        id: rid(),
        text: "Anyone around? 👋",
        ts: Date.now(),
        mine: false,
        nick: "Ava",
        room: PUBLIC_ROOM,
      });
      notify();
    }, 700);
  },
  stopMesh: async () => {
    state.meshRunning = false;
    state.peers.clear();
    notify();
  },
  sendBroadcast: async (text) => {
    addLocalOutgoing(PUBLIC_ROOM, text);
    simulateReply(PUBLIC_ROOM, "Kai", text);
  },
  sendDirect: async (peerId, text) => {
    addLocalOutgoing(peerId, text);
    simulateReply(peerId, state.peers.get(peerId)?.nick || "Peer", text);
  },
  getPeers: async () => [...state.peers.values()],
};

export const api: MeshApi = isTauri ? realApi : mockApi;
