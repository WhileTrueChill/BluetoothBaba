import { h, icon, type View } from "../dom";
import { ICON } from "../icons";
import { api } from "../api";
import {
  clearUnread,
  messagesFor,
  navigate,
  PUBLIC_ROOM,
  roomTitle,
  state,
  subscribe,
  type Message,
} from "../state";
import { clockTime, dayLabel } from "../format";

/**
 * A single conversation — the Public room or a direct chat with one peer.
 * Only the message list re-renders on updates; the composer keeps its focus,
 * caret, and draft text across store notifications.
 */
export function ChatView(): View {
  const room = state.activeRoom;
  const messagesEl = h("div", { class: "messages" });
  const subtitleEl = h("span", { class: "navbar-sub" });

  const navbar = h(
    "div",
    { class: "navbar" },
    h(
      "div",
      { class: "navbar-row" },
      h(
        "button",
        { class: "nav-btn left", onclick: () => navigate("home") },
        icon(ICON.back, 24),
        "Chats",
      ),
      h(
        "div",
        { class: "navbar-center" },
        h("div", { class: "navbar-title" }, roomTitle(room)),
        subtitleEl,
      ),
      h("span", { class: "nav-btn right" }),
    ),
  );

  const input = h("textarea", {
    rows: "1",
    placeholder: "Message",
    autocapitalize: "sentences",
    oninput: autoGrow,
    onkeydown: onKey,
  }) as HTMLTextAreaElement;

  const sendBtn = h(
    "button",
    { class: "send-btn", disabled: true, "aria-label": "Send", onclick: send },
    icon(ICON.send, 20),
  ) as HTMLButtonElement;

  const composer = h("div", { class: "composer" }, input, sendBtn);

  function autoGrow(): void {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    sendBtn.disabled = input.value.trim().length === 0;
  }

  function onKey(e: KeyboardEvent): void {
    // Enter sends; Shift+Enter inserts a newline (desktop / hardware keyboard).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function send(): Promise<void> {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    autoGrow();
    input.focus();
    try {
      if (room === PUBLIC_ROOM) await api.sendBroadcast(text);
      else await api.sendDirect(room, text);
    } catch (err) {
      console.error("send failed", err);
    }
  }

  const nearBottom = (): boolean =>
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
    80;

  const scrollToBottom = (): void => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  function emptyState(): HTMLElement {
    const dm = room !== PUBLIC_ROOM;
    return h(
      "div",
      { class: "empty" },
      h(
        "div",
        { class: "empty-title" },
        dm ? `Message ${roomTitle(room)}` : "Say hello 👋",
      ),
      h(
        "div",
        { class: "empty-text" },
        dm
          ? "Direct messages are end-to-end encrypted and only sent to this peer."
          : "Messages here reach everyone within Bluetooth range.",
      ),
    );
  }

  function bubble(m: Message, showSender: boolean, first: boolean): HTMLElement {
    const row = h("div", {
      class: `msg-row ${m.mine ? "out" : "in"} ${first ? "first" : "grouped"}`,
    });
    if (showSender) row.append(h("div", { class: "msg-sender" }, m.nick));
    row.append(h("div", { class: "bubble" }, m.text));
    row.append(h("div", { class: "msg-time" }, clockTime(m.ts)));
    return row;
  }

  function updateSubtitle(): void {
    if (room === PUBLIC_ROOM) {
      const n = state.peers.size;
      subtitleEl.textContent = state.meshRunning
        ? `${n} ${n === 1 ? "person" : "people"} in range`
        : "Mesh off";
    } else {
      subtitleEl.textContent = state.peers.has(room)
        ? "Encrypted · in range"
        : "Encrypted · not in range";
    }
  }

  function renderMessages(): void {
    const stick = nearBottom();
    const msgs = messagesFor(room);
    messagesEl.replaceChildren();

    if (msgs.length === 0) {
      messagesEl.append(emptyState());
    }

    let lastDay = "";
    let lastSender = "";
    for (const m of msgs) {
      const day = dayLabel(m.ts);
      if (day !== lastDay) {
        messagesEl.append(h("div", { class: "day-sep" }, day));
        lastDay = day;
        lastSender = "";
      }
      const sender = m.mine ? "me" : m.nick;
      const first = sender !== lastSender;
      const showSender = room === PUBLIC_ROOM && !m.mine && first;
      messagesEl.append(bubble(m, showSender, first));
      lastSender = sender;
    }

    updateSubtitle();
    if (stick) scrollToBottom();
  }

  // Opening a chat clears its unread count.
  clearUnread(room);
  renderMessages();
  const unsub = subscribe(renderMessages);
  // Land at the newest message after the screen paints.
  requestAnimationFrame(scrollToBottom);

  return {
    el: h("div", { class: "screen" }, navbar, messagesEl, composer),
    destroy: unsub,
  };
}
