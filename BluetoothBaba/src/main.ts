// App bootstrap + a tiny router. Screens are plain functions returning a View;
// we re-mount only when the *screen identity* changes (route, or the room for a
// chat). Within a screen, views subscribe to the store and update themselves —
// so typing in the composer or scrolling never gets clobbered by a re-render.

import type { View } from "./dom";
import { api } from "./api";
import { notify, state, subscribe } from "./state";
import { OnboardingView } from "./views/onboarding";
import { HomeView } from "./views/home";
import { ChatView } from "./views/chat";
import { SettingsView } from "./views/settings";

const root = document.getElementById("app")!;
let current: View | null = null;
let currentKey = "";

function viewFor(): View {
  switch (state.route) {
    case "onboarding":
      return OnboardingView();
    case "chat":
      return ChatView();
    case "settings":
      return SettingsView();
    case "home":
    default:
      return HomeView();
  }
}

// A chat is keyed by its room so switching conversations rebuilds the view.
const keyFor = (): string =>
  state.route === "chat" ? `chat:${state.activeRoom}` : state.route;

function mount(): void {
  const key = keyFor();
  if (current && key === currentKey) return;
  current?.destroy?.();
  current?.el.remove();
  current = viewFor();
  currentKey = key;
  root.replaceChildren(current.el);
}

subscribe(mount);

async function boot(): Promise<void> {
  // Always paint the UI before any native/plugin work.
  mount();

  try {
    await api.init();
    state.identity = await api.getIdentity();
  } catch (err) {
    // A native/plugin initialization problem must never terminate the UI.
    console.error("mesh init failed", err);
  }

  // IMPORTANT: do not start Bluetooth automatically on application launch.
  // Android may require runtime Nearby Devices permissions, Bluetooth may be
  // disabled, or the adapter may be unavailable. Starting the native BLE
  // stack here could terminate the process on some devices. The user starts
  // the mesh explicitly from the Home screen after Android permissions are
  // available.
  notify();
}

void boot();
