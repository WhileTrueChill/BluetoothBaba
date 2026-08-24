import { h, icon, initials, type View } from "../dom";
import { ICON } from "../icons";
import { api } from "../api";
import {
  lastMessage,
  navigate,
  PUBLIC_ROOM,
  shortId,
  state,
  subscribe,
  unreadFor,
  type Peer,
} from "../state";
import { relativeTime, signalClass } from "../format";

/** Home: the Public room + a live list of nearby peers (DM conversations). */
export function HomeView(): View {
  const body = h("div", { class: "body" });
  const statusEl = h("span", { class: "navbar-sub" });

  const navbar = h(
    "div",
    { class: "navbar" },
    h(
      "div",
      { class: "navbar-row" },
      h("span", {}),
      h("span", {}),
      h(
        "button",
        {
          class: "nav-btn right",
          "aria-label": "Settings",
          onclick: () => navigate("settings"),
        },
        icon(ICON.gear, 24),
      ),
    ),
    h("div", { class: "large-title" }, "MeshChat"),
    h("div", { style: { padding: "0 16px 10px" } }, statusEl),
  );

  function cell(o: {
    avatar: HTMLElement;
    title: string;
    sub?: string;
    trailTop?: string;
    dot?: string;
    unread?: number;
    onclick: () => void;
  }): HTMLElement {
    const trail = h("div", { class: "cell-trail" });
    if (o.trailTop) trail.append(h("span", null, o.trailTop));
    const marks = h("div", {
      style: { display: "flex", alignItems: "center", gap: "6px" },
    });
    if (o.dot) marks.append(h("span", { class: `dot ${o.dot}` }));
    if (o.unread && o.unread > 0)
      marks.append(h("span", { class: "badge" }, String(o.unread)));
    if (marks.childNodes.length) trail.append(marks);

    const chev = icon(ICON.chevron, 15);
    chev.classList.add("chevron");

    return h(
      "button",
      { class: "cell", onclick: o.onclick },
      o.avatar,
      h(
        "div",
        { class: "cell-main" },
        h("div", { class: "cell-title" }, o.title),
        o.sub ? h("div", { class: "cell-sub" }, o.sub) : null,
      ),
      trail,
      chev,
    );
  }

  function publicCell(): HTMLElement {
    const last = lastMessage(PUBLIC_ROOM);
    const avatar = h("div", { class: "avatar public" }, icon(ICON.broadcast, 22));
    return h(
      "div",
      { class: "list" },
      cell({
        avatar,
        title: "Public",
        sub: last
          ? `${last.mine ? "You" : last.nick}: ${last.text}`
          : "Everyone in Bluetooth range",
        trailTop: last ? relativeTime(last.ts) : undefined,
        unread: unreadFor(PUBLIC_ROOM),
        onclick: () => navigate("chat", PUBLIC_ROOM),
      }),
    );
  }

  function peerCell(p: Peer): HTMLElement {
    const last = lastMessage(p.peerId);
    return cell({
      avatar: h("div", { class: "avatar" }, initials(p.nick)),
      title: p.nick,
      sub: last
        ? last.mine
          ? `You: ${last.text}`
          : last.text
        : `ID ${shortId(p.peerId)}`,
      trailTop: relativeTime(last?.ts ?? p.lastSeen),
      dot: signalClass(p.rssi),
      unread: unreadFor(p.peerId),
      onclick: () => navigate("chat", p.peerId),
    });
  }

  function meshOffState(): HTMLElement {
    return h(
      "div",
      { class: "empty" },
      h("div", { class: "pulse" }, icon(ICON.bluetooth, 30)),
      h("div", { class: "empty-title" }, "Mesh is off"),
      h(
        "div",
        { class: "empty-text" },
        "Turn on the mesh to discover people nearby over Bluetooth.",
      ),
      h(
        "button",
        {
          class: "btn-primary",
          style: { marginTop: "8px" },
          onclick: () => api.startMesh().catch(() => {}),
        },
        "Turn On Mesh",
      ),
    );
  }

  function searchingState(): HTMLElement {
    return h(
      "div",
      { class: "empty" },
      h("div", { class: "pulse" }, icon(ICON.bluetooth, 30)),
      h("div", { class: "empty-title" }, "Looking for people nearby…"),
      h(
        "div",
        { class: "empty-text" },
        "Open MeshChat on another phone within Bluetooth range to start chatting.",
      ),
    );
  }

  function render() {
    const peers = [...state.peers.values()].sort(
      (a, b) => b.lastSeen - a.lastSeen,
    );

    if (!state.meshRunning) statusEl.textContent = "Mesh off";
    else if (peers.length === 0) statusEl.textContent = "Meshing · searching…";
    else statusEl.textContent = `Meshing · ${peers.length} nearby`;

    body.replaceChildren();
    if (state.meshError) {
      body.append(h("div", { class: "banner" }, state.meshError));
    }
    body.append(publicCell());
    body.append(h("div", { class: "section-header" }, "Nearby"));

    if (!state.meshRunning) {
      body.append(meshOffState());
    } else if (peers.length === 0) {
      body.append(searchingState());
    } else {
      const list = h("div", { class: "list" });
      for (const p of peers) list.append(peerCell(p));
      body.append(list);
    }
  }

  render();
  const unsub = subscribe(render);
  return { el: h("div", { class: "screen" }, navbar, body), destroy: unsub };
}
