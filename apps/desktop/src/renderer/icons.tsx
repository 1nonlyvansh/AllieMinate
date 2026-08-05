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
