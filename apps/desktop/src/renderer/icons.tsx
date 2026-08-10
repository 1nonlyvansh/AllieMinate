import React from 'react';

type P = { size?: number };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconHome = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9" /></svg>
);
export const IconFiles = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.5h7A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z" /></svg>
);
export const IconFolder = ({ size }: P) => (
  <svg {...base(size)}><path d="M17 30" /><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2.5h6.5A1.5 1.5 0 0 1 20 10v7.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" /></svg>
);
export const IconDevices = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="4" width="13" height="9" rx="1.5" /><path d="M8 17h6" /><rect x="17.5" y="9" width="4" height="8" rx="1" /></svg>
);
export const IconShare = ({ size }: P) => (
  <svg {...base(size)}><circle cx="6" cy="12" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="18" cy="18" r="2.2" /><path d="m8 11 8-4M8 13l8 4" /></svg>
);
export const IconTrash = ({ size }: P) => (
  <svg {...base(size)}><path d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m2 0v11.5A1.5 1.5 0 0 1 15.5 20h-7A1.5 1.5 0 0 1 7 18.5V7" /></svg>
);
export const IconSettings = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
);
export const IconUpload = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 16V5M7 9l5-5 5 5" /><path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" /></svg>
);
export const IconDownload = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 4v11M7 11l5 5 5-5" /><path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" /></svg>
);
export const IconCopy = ({ size }: P) => (
  <svg {...base(size)}><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></svg>
);
export const IconSearch = ({ size }: P) => (
  <svg {...base(size)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.35-4.35" /></svg>
);
export const IconGrid = ({ size }: P) => (
  <svg {...base(size)}><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></svg>
);
export const IconList = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const IconChevronLeft = ({ size }: P) => (
  <svg {...base(size)}><path d="m14 6-6 6 6 6" /></svg>
);
export const IconMac = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></svg>
);
export const IconWindows = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 6.5 11 5.3V11.6H3ZM12.2 5.1 21 3.7v7.9h-8.8ZM3 12.6h8v6.3L3 17.7ZM12.2 12.6H21V20l-8.8-1.3Z" /></svg>
);
export const IconPhone = ({ size }: P) => (
  <svg {...base(size)}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></svg>
);
export const IconBell = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" /><path d="M10 18.5a2 2 0 0 0 4 0" /></svg>
);
export const IconStar = ({ size, filled }: P & { filled?: boolean }) => (
  <svg {...base(size)} fill={filled ? 'currentColor' : 'none'}><path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8Z" /></svg>
);
export const IconLock = ({ size }: P) => (
  <svg {...base(size)}><rect x="5" y="10.5" width="14" height="9" rx="1.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
);
export const IconAdd = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconCloud = ({ size }: P) => (
  <svg {...base(size)}><path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5.5 5.5 0 0 1 17.4 8.06 4 4 0 0 1 17 18H7Z" /></svg>
);
export const IconSync = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 12a8 8 0 0 1 13.66-5.66L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.66 5.66L4 16" /><path d="M4 20v-4h4" /></svg>
);
export const IconImage = ({ size }: P) => (
  <svg {...base(size)}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="9" cy="10" r="1.5" /><path d="m4 17 5-5 4 4 3-3 4 4" /></svg>
);
export const IconVideo = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="6" width="13" height="12" rx="1.5" /><path d="m16 10 5-3v10l-5-3Z" /></svg>
);
export const IconAudio = ({ size }: P) => (
  <svg {...base(size)}><path d="M9 18V6l10-2v12" /><circle cx="7" cy="18" r="2.5" /><circle cx="17" cy="16" r="2.5" /></svg>
);
export const IconDocument = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 3.5h8l4 4v13H6Z" /><path d="M14 3.5v4h4" /></svg>
);
export const IconArchive = ({ size }: P) => (
  <svg {...base(size)}><rect x="3.5" y="4" width="17" height="16" rx="1.5" /><path d="M9 4v16M9 7h3M9 11h3M9 15h3" /></svg>
);
export const IconZoomIn = ({ size }: P) => (
  <svg {...base(size)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M10.5 8v5M8 10.5h5" /><path d="m20 20-4.35-4.35" /></svg>
);
export const IconZoomOut = ({ size }: P) => (
  <svg {...base(size)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M8 10.5h5" /><path d="m20 20-4.35-4.35" /></svg>
);
export const IconRotateLeft = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 12a8 8 0 1 1 2.34 5.66" /><path d="M4 8v4h4" /></svg>
);
export const IconRotateRight = ({ size }: P) => (
  <svg {...base(size)}><path d="M20 12a8 8 0 1 0-2.34 5.66" /><path d="M20 8v4h-4" /></svg>
);
export const IconInfo = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" /></svg>
);
export const IconExternalLink = ({ size }: P) => (
  <svg {...base(size)}><path d="M9 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V15" /><path d="M13 4h6v6M20 4l-9.5 9.5" /></svg>
);
export const IconPlay = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none"><path d="M7 5.5v13l11-6.5Z" /></svg>
);
export const IconPause = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>
);
export const IconVolume = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5Z" /><path d="M16.5 9a4 4 0 0 1 0 6" /></svg>
);
export const IconVolumeMuted = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5Z" /><path d="m15.5 10 4 4M19.5 10l-4 4" /></svg>
);
export const IconClose = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);

// Brand marks below are filled solid glyphs (not the stroke-based style above) — recognizable brand icons
// read as line art at this size, so these match each service's own simplified monochrome icon convention
// instead of forcing the stroke style onto shapes it doesn't suit.
export const IconGithub = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.6.23 2.77.11 3.06.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.51 10.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
  </svg>
);
export const IconInstagram = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.55.22.95.47 1.37.89.42.42.67.82.89 1.37.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23a3.7 3.7 0 0 1-.89 1.37 3.7 3.7 0 0 1-1.37.89c-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.37-.89 3.7 3.7 0 0 1-.89-1.37c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.55.47-.95.89-1.37.42-.42.82-.67 1.37-.89.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07c-1.28.06-2.15.26-2.91.56a5.9 5.9 0 0 0-2.13 1.39A5.9 5.9 0 0 0 .62 4.15C.32 4.9.12 5.77.06 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.31.79.72 1.46 1.39 2.13a5.9 5.9 0 0 0 2.13 1.39c.76.3 1.63.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.28-.06 2.15-.26 2.91-.56a5.9 5.9 0 0 0 2.13-1.39 5.9 5.9 0 0 0 1.39-2.13c.3-.76.5-1.63.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.39-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.63-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84Zm0 10.16A4 4 0 1 1 16 12a4 4 0 0 1-4 4Zm6.41-10.4a1.44 1.44 0 1 1-1.44-1.44 1.44 1.44 0 0 1 1.44 1.44Z" />
  </svg>
);
export const IconLinkedin = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.11 20.45H3.56V9h3.55Z" />
  </svg>
);
export const IconWhatsapp = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.47 14.38c-.29-.15-1.71-.85-1.98-.94-.27-.1-.46-.15-.66.15-.2.29-.76.94-.93 1.13-.17.2-.34.22-.63.07-.29-.15-1.23-.45-2.35-1.45-.87-.77-1.45-1.73-1.63-2.02-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.49.1-.2.05-.37-.02-.51-.08-.15-.66-1.6-.91-2.19-.24-.58-.48-.5-.66-.51h-.56c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.44s1.05 2.83 1.19 3.03c.15.2 2.06 3.14 4.98 4.4.7.3 1.24.48 1.66.61.7.22 1.34.19 1.84.12.56-.08 1.71-.7 1.96-1.38.24-.68.24-1.26.17-1.38-.07-.12-.27-.2-.56-.34ZM12.02 2C6.5 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.06L2 22l5.08-1.33A9.96 9.96 0 0 0 12.02 22C17.53 22 22 17.52 22 12S17.53 2 12.02 2Zm0 18.13c-1.7 0-3.28-.5-4.61-1.34l-.33-.2-3.02.79.8-2.94-.21-.34a8.13 8.13 0 0 1-1.24-4.4c0-4.48 3.65-8.13 8.14-8.13 4.48 0 8.13 3.65 8.13 8.13 0 4.49-3.65 8.14-8.14 8.14Z" />
  </svg>
);
export const IconMail = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="m4 6.5 8 6 8-6" /></svg>
);
