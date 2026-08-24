// Small date/time formatters for chat + list previews.

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact "when" for list rows: now / 5m / 3:04 PM / Aug 24. */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return clockTime(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Section header inside a conversation. */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Signal strength → dot class, from RSSI (dBm). null = connected/unknown. */
export function signalClass(rssi?: number | null): string {
  if (rssi == null) return "on";
  if (rssi >= -65) return "on";
  if (rssi >= -82) return "mid";
  return "off";
}
