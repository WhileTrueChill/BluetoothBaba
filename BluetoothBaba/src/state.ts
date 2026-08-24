// Central app state + a minimal observer store. Views read from `state`,
// mutate through these helpers, and re-render when `notify()` fires.

export const PUBLIC_ROOM = "public";

export interface Identity {
  peerId: string;
  pubkey: string;
}

export interface Peer {
  peerId: string;
  nick: string;
  rssi?: number | null;
  lastSeen: number;
}

export interface Message {
  id: string;
  text: string;
  ts: number;
  mine: boolean;
  nick: string;
  room: string; // PUBLIC_ROOM or a peerId
}

export type Route = "onboarding" | "home" | "chat" | "settings";

export interface AppState {
  ready: boolean;
  identity: Identity | null;
  nickname: string;
  meshRunning: boolean;
  meshError: string | null;
  route: Route;
  activeRoom: string;
  peers: Map<string, Peer>;
  messages: Map<string, Message[]>;
  unread: Map<string, number>;
}

const NICK_KEY = "meshchat.nickname";

function loadNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) || "";
  } catch {
    return "";
  }
}

export const state: AppState = {
  ready: false,
  identity: null,
  nickname: loadNickname(),
  meshRunning: false,
  meshError: null,
  route: loadNickname() ? "home" : "onboarding",
  activeRoom: PUBLIC_ROOM,
  peers: new Map(),
  messages: new Map(),
  unread: new Map(),
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  for (const fn of listeners) fn();
}

export function setNickname(nick: string): void {
  state.nickname = nick;
  try {
    localStorage.setItem(NICK_KEY, nick);
  } catch {
    /* ignore */
  }
}

export function upsertPeer(p: Peer): void {
  const existing = state.peers.get(p.peerId);
  state.peers.set(p.peerId, { ...existing, ...p });
}

export function removePeer(peerId: string): void {
  state.peers.delete(peerId);
}

export function addMessage(msg: Message): void {
  const list = state.messages.get(msg.room) ?? [];
  if (list.some((m) => m.id === msg.id)) return; // dedupe by id
  list.push(msg);
  list.sort((a, b) => a.ts - b.ts);
  state.messages.set(msg.room, list);
  const viewing = state.route === "chat" && state.activeRoom === msg.room;
  if (!msg.mine && !viewing) {
    state.unread.set(msg.room, (state.unread.get(msg.room) ?? 0) + 1);
  }
}

export function messagesFor(room: string): Message[] {
  return state.messages.get(room) ?? [];
}

export function lastMessage(room: string): Message | undefined {
  const l = state.messages.get(room);
  return l && l.length ? l[l.length - 1] : undefined;
}

export function unreadFor(room: string): number {
  return state.unread.get(room) ?? 0;
}

export function clearUnread(room: string): void {
  state.unread.set(room, 0);
}

export function navigate(route: Route, room?: string): void {
  state.route = route;
  if (room !== undefined) state.activeRoom = room;
  if (route === "chat") clearUnread(state.activeRoom);
  notify();
}

export function shortId(peerId: string): string {
  return peerId.slice(0, 6).toUpperCase();
}

export function roomTitle(room: string): string {
  if (room === PUBLIC_ROOM) return "Public";
  return state.peers.get(room)?.nick || shortId(room);
}
