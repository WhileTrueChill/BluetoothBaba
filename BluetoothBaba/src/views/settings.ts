import { h, icon, type View } from "../dom";
import { ICON } from "../icons";
import { api } from "../api";
import { navigate, setNickname, shortId, state, subscribe } from "../state";

const APP_VERSION = "1.0.0";

/** Settings: nickname, identity, mesh on/off, and an "about" blurb. */
export function SettingsView(): View {
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
        "MeshChat",
      ),
      h("div", { class: "navbar-center" }, h("div", { class: "navbar-title" }, "Settings")),
      h("span", { class: "nav-btn right" }),
    ),
  );

  const body = h("div", { class: "body" });

  // ---- Profile: editable nickname -----------------------------------------
  const nickInput = h("input", {
    class: "cell-input",
    type: "text",
    maxlength: "24",
    placeholder: "Your name",
    value: state.nickname,
    autocapitalize: "words",
    autocomplete: "off",
    autocorrect: "off",
    onchange: (e: Event) => {
      const nick = (e.target as HTMLInputElement).value.trim();
      if (!nick) {
        (e.target as HTMLInputElement).value = state.nickname;
        return;
      }
      setNickname(nick);
      api.setNickname(nick).catch(() => {});
    },
  }) as HTMLInputElement;

  const profile = h(
    "div",
    { class: "list" },
    h(
      "div",
      { class: "cell static" },
      h("div", { class: "cell-title" }, "Name"),
      nickInput,
    ),
  );

  // ---- Identity: peer id (tap to copy) ------------------------------------
  const peerId = state.identity?.peerId ?? "";
  const idValue = h(
    "span",
    { class: "cell-value mono" },
    peerId ? shortId(peerId) : "—",
  );
  const idCell = h(
    "button",
    {
      class: "cell",
      disabled: !peerId,
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(peerId);
          idValue.textContent = "Copied";
          window.setTimeout(() => {
            idValue.textContent = shortId(peerId);
          }, 1200);
        } catch {
          /* clipboard unavailable */
        }
      },
    },
    h("div", { class: "cell-title" }, "Your ID"),
    idValue,
  );

  // ---- Mesh: on/off toggle ------------------------------------------------
  const toggle = h("input", { type: "checkbox" }) as HTMLInputElement;
  toggle.checked = state.meshRunning;
  toggle.addEventListener("change", () => {
    if (toggle.checked) api.startMesh().catch(() => {});
    else api.stopMesh().catch(() => {});
  });
  const meshCell = h(
    "div",
    { class: "cell static" },
    h("div", { class: "cell-title" }, "Bluetooth Mesh"),
    h(
      "label",
      { class: "switch" },
      toggle,
      h("span", { class: "track" }),
      h("span", { class: "knob" }),
    ),
  );

  function render(): void {
    // Keep controls in sync when the mesh state changes elsewhere.
    toggle.checked = state.meshRunning;
    if (document.activeElement !== nickInput) nickInput.value = state.nickname;
    if (peerId) idValue.textContent = shortId(peerId);
  }

  body.append(
    h("div", { class: "section-header" }, "Profile"),
    profile,
    h("div", { class: "section-header" }, "Identity"),
    h("div", { class: "list" }, idCell),
    h(
      "div",
      { class: "section-hint" },
      "Your ID is derived from your device's public key. Share it so people can recognise you nearby.",
    ),
    h("div", { class: "section-header" }, "Network"),
    h("div", { class: "list" }, meshCell),
    h(
      "div",
      { class: "section-hint" },
      "MeshChat works entirely over Bluetooth Low Energy. Messages hop from phone to phone — no Wi-Fi, mobile data, servers, or accounts.",
    ),
    h("div", { class: "section-header" }, "About"),
    h(
      "div",
      { class: "list" },
      h(
        "div",
        { class: "cell static" },
        h("div", { class: "cell-title" }, "Version"),
        h("span", { class: "cell-value" }, APP_VERSION),
      ),
    ),
    h("div", { class: "footer-note" }, "MeshChat — offline, serverless, private."),
  );

  render();
  const unsub = subscribe(render);
  return { el: h("div", { class: "screen" }, navbar, body), destroy: unsub };
}
