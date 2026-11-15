/* Simple 24px stroke icons (original drawings). */
import type { ReactNode } from 'react';

const I = ({ children, label }: { children: ReactNode; label?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}>
    {children}
  </svg>
);

export const IconMic = () => <I><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></I>;
export const IconStop = () => <I><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></I>;
export const IconRoom = () => <I><path d="M4 21V5a2 2 0 0 1 2-2h9l5 3v15" /><path d="M2 21h20M14 12h.01" /></I>;
export const IconTake = () => <I><path d="M4 7h16l-1.5 12.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5L4 7z" /><path d="M9 7a3 3 0 0 1 6 0M12 11v6M9.5 14.5 12 17l2.5-2.5" /></I>;
export const IconReturn = () => <I><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></I>;
export const IconArrived = () => <I><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" /><path d="M3 7l9 4 9-4M12 11v10" /></I>;
export const IconSend = () => <I><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></I>;
export const IconReceive = () => <I><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-7z" /></I>;
export const IconBack = () => <I><path d="M15 18l-6-6 6-6" /></I>;
export const IconCheck = () => <I><path d="M20 6 9 17l-5-5" /></I>;
export const IconHome = () => <I><path d="M3 11l9-8 9 8M5 9.5V21h14V9.5" /></I>;
export const IconBag = () => <I><path d="M6 8h12l1 13H5L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></I>;
export const IconClock = () => <I><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>;
export const IconSpeaker = () => <I><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></I>;
export const IconRepeat = () => <I><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></I>;
export const IconAlert = () => <I><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></I>;
export const IconChart = () => <I><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></I>;
export const IconList = () => <I><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></I>;
export const IconCount = () => <I><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></I>;
export const IconSettings = () => <I><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></I>;
export const IconStore = () => <I><path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6" /></I>;
export const IconTruck = IconSend;
export const IconSignOut = () => <I><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></I>;
export const IconKeyboard = () => <I><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></I>;
export const IconHelp = () => <I><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01" /></I>;
