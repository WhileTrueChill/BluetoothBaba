// Inline SVG icon markup (stroke uses currentColor). Rendered via dom.icon().

export const ICON = {
  back: `<path d="M15 4L7 12l8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  chevron: `<path d="M8.5 4l7.5 8-7.5 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  send: `<path d="M12 19V6M6.5 11.5L12 5l5.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  bluetooth: `<path d="M6.5 8.5l11 7-5.5 4.5V4l5.5 4.5-11 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`,
  broadcast: `<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/><path d="M7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4M5 5a9.9 9.9 0 000 14M19 5a9.9 9.9 0 010 14"/></g>`,
  gear: `<path fill="currentColor" d="M19.14 12.94a7.5 7.5 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.61-.22l-2.39.96a7.3 7.3 0 00-1.62-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 00-.61.22L2.68 8.84a.5.5 0 00.12.64l2.03 1.58a7.5 7.5 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.14.24.42.32.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.19.1.47.02.61-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/>`,
} as const;
