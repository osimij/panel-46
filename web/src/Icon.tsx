// Small inline icon set so the app needs nothing from the network.
const paths = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  "heart-fill": <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill="currentColor" />,
  play: <path d="M7 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />,
  image: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m20 16-4.5-4.5L7 19" /></>,
  drive: <><rect x="3" y="13" width="18" height="6" rx="2" /><path d="M5 13 7.5 6h9L19 13M7 16h.01" /></>,
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />,
  alert: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5M12 16h.01" /></>,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  "chevron-left": <path d="m14.5 6-6 6 6 6" />,
  "chevron-right": <path d="m9.5 6 6 6-6 6" />,
  external: <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />,
  folder: <path d="M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />,
  refresh: <path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  info: <><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8h.01" /></>,
  "chevron-down": <path d="m6 9.5 6 6 6-6" />,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5" /></>,
  "user-check": <><circle cx="10" cy="8.5" r="3.5" /><path d="M3.5 19.5c.7-3.3 3.3-5.5 6.5-5.5 1.3 0 2.5.4 3.5 1M15 17.5l2 2 4-4" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2" /></>,
  file: <><path d="M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="M14 4v4h4M9 13h6M9 16.5h4" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  "eye-off": <path d="M10.6 5.6a8.6 8.6 0 0 1 1.4-.1c6 0 9.5 6.5 9.5 6.5a16.4 16.4 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5a8.8 8.8 0 0 0 5.4-1.9M9.9 9.9a3 3 0 0 0 4.2 4.2M4 4l16 16" />,
  select: <><circle cx="12" cy="12" r="8" /><path d="m8.5 12.2 2.4 2.4 4.6-4.8" /></>,
  "arrow-up-right": <path d="M8 16 16 8M9.5 8H16v6.5" />,
  "arrow-left": <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  "arrow-right": <path d="M5 12h14m0 0-6-6m6 6-6 6" />,
  settings: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  pause: <path d="M8 5.5v13M16 5.5v13" strokeWidth={3} />,
  volume: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  "volume-x": <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" /><path d="m16 10 4 4m0-4-4 4" /></>,
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minimize: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  repeat: <path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" />,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></>,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 17.5h2" /></>,
  pencil: <path d="M14.5 6.5 17.5 9.5M5 19l1-4L15.5 5.5a2.1 2.1 0 0 1 3 3L9 18l-4 1Z" />,
  "arrow-up": <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
  "arrow-down": <path d="M12 5v14m0 0-6-6m6 6 6-6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none" />,
  history: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" /><path d="M4.5 4.5V9H9M12 8v4.2l2.8 1.8" /></>,
  ask: <path d="M5 7a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7v6a2.5 2.5 0 0 1-2.5 2.5H11L7 19v-3.5h-.5A1.5 1.5 0 0 1 5 14V7Z" />,
  reply: <path d="M9.5 7 5 11.5 9.5 16M5.5 11.5H14a5 5 0 0 1 5 5V18" />,
  sidebar: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M9.5 5v14" /></>,
  upload: <path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 19h14" />,
  point: <><path d="M5 4.5 11 19l2.2-6.3L19.5 10.5 5 4.5Z" /></>,
  branch: <><circle cx="7" cy="5.5" r="2" /><circle cx="7" cy="18.5" r="2" /><circle cx="17" cy="8.5" r="2" /><path d="M7 7.5v9M17 10.5c0 4-10 2.5-10 6" /></>,
  tablet: <><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M11 17.5h2" /></>,
  build: <path d="m9 7-5 5 5 5M15 7l5 5-5 5M13.5 4.5l-3 15" />,
  states: <><rect x="4" y="4" width="7" height="5" rx="1.5" /><rect x="13" y="15" width="7" height="5" rx="1.5" /><rect x="4" y="15" width="7" height="5" rx="1.5" /><path d="M7.5 9v6M7.5 12h9v3" /></>,
  terminal: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="m7.5 10 2.5 2-2.5 2M12.5 14.5h4" /></>,
  compose: <path d="M11.5 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5M17.2 4.8l2 2L12 14l-2.8.8.8-2.8 7.2-7.2Z" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="icon"
    >
      {paths[name]}
    </svg>
  );
}
