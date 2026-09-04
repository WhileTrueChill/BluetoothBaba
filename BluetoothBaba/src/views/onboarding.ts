import { h, icon, type View } from "../dom";
import { ICON } from "../icons";
import { api } from "../api";
import { navigate, setNickname, state } from "../state";

/** First-run screen: pick a nickname, then start the mesh. */
export function OnboardingView(): View {
  let value = state.nickname;

  const startBtn = h(
    "button",
    {
      class: "btn-primary",
      disabled: value.trim().length === 0,
      onclick: async () => {
        const nick = value.trim();
        if (!nick) return;
        setNickname(nick);
        await api.setNickname(nick).catch(() => {});
        navigate("home");
        // Starts BLE permissions, Bluetooth activation, advertising and scanning.
        api.startMesh().catch((err) => console.error("startMesh failed", err));
      },
    },
    "Start BluetoothBaba",
  ) as HTMLButtonElement;

  const input = h("input", {
    class: "field",
    type: "text",
    maxlength: "24",
    placeholder: "Your name",
    value,
    autocapitalize: "words",
    autocomplete: "off",
    autocorrect: "off",
    oninput: (e: Event) => {
      value = (e.target as HTMLInputElement).value;
      startBtn.disabled = value.trim().length === 0;
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === "Enter") startBtn.click();
    },
  }) as HTMLInputElement;

  const el = h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "onboard" },
      h("div", { class: "logo" }, icon(ICON.bluetooth, 46)),
      h("h1", null, "BluetoothBaba"),
      h(
        "p",
        null,
        "Text people near you over Bluetooth. No accounts, no servers, no internet — messages hop phone to phone.",
      ),
      input,
      startBtn,
      h(
        "p",
        { class: "hint" },
        "Pick a name others will see nearby. Bluetooth permissions will be requested when you start.",
      ),
    ),
  );

  return { el };
}
