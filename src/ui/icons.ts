/** Hand-drawn inline SVG icons (stroke = currentColor) so no icon font or asset licence is involved. */
const svg = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  soundOn: svg('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke-width="1.6"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke-width="1.6"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>'),
  pipe: svg('<rect x="6.5" y="4" width="11" height="4.2" rx="1.2" fill="currentColor" stroke="none"/><path d="M8.5 8.2V21M15.5 8.2V21"/><circle cx="12" cy="1.8" r="0" />'),
  pusher: svg('<path d="M3 5v14"/><rect x="5" y="9" width="9" height="6" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="6.5" width="3.2" height="11" rx="1" fill="currentColor" stroke="none"/><path d="M19.5 9.5l2 2.5-2 2.5"/>'),
  pusherLeft: svg('<path d="M21 5v14"/><rect x="10" y="9" width="9" height="6" rx="1" fill="currentColor" stroke="none"/><rect x="6.8" y="6.5" width="3.2" height="11" rx="1" fill="currentColor" stroke="none"/><path d="M4.5 9.5l-2 2.5 2 2.5"/>'),
  value: svg('<circle cx="12" cy="12" r="8.2"/><path d="M14.6 9.2c-.5-.9-1.5-1.4-2.7-1.4-1.6 0-2.7.8-2.7 2 0 2.8 5.7 1.4 5.7 4.3 0 1.2-1.2 2.1-2.9 2.1-1.3 0-2.4-.6-2.9-1.5M12 6.2v1.6M12 16.2v1.6"/>'),
  evolve: svg('<ellipse cx="10" cy="10" rx="5.6" ry="6.2" fill="currentColor" stroke="none"/><path d="M10 16.2l-1 2h2z" fill="currentColor"/><path d="M19 3.5v4M17 5.5h4M18.5 13v3M17 14.5h3"/>'),
  tap: svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10l4.3.9a2 2 0 0 1 1.6 2.2l-.6 4.6a3 3 0 0 1-3 2.6h-2.7a3 3 0 0 1-2.4-1.2L6 15.8a1.5 1.5 0 0 1 2.2-2L9 14.6"/><path d="M5.8 4.6a4.5 4.5 0 0 1 8.6-.2"/>'),
};
