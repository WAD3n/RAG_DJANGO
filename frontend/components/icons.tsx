import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const icon = (paths: React.ReactNode, vb = '0 0 16 16') =>
  function Icon({ size = 16, className = '', style }: IconProps) {
    return (
      <svg
        width={size} height={size} viewBox={vb}
        fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        className={className} style={style}
      >
        {paths}
      </svg>
    );
  };

export const Plus        = icon(<><path d="M8 3.5v9M3.5 8h9"/></>);
export const Upload      = icon(<><path d="M8 10.5V2.5M5 5.5l3-3 3 3"/><path d="M3 11.5v1A1.5 1.5 0 0 0 4.5 14h7A1.5 1.5 0 0 0 13 12.5v-1"/></>);
export const File        = icon(<><path d="M3.5 2.5h6L13 6v7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z"/><path d="M9 2.5V6h4"/></>);
export const Folder      = icon(<><path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5Z"/></>);
export const Search      = icon(<><circle cx="7" cy="7" r="4"/><path d="m10 10 3 3"/></>);
export const Send        = icon(<><path d="M2.5 8 13.5 3 11 13.5 7.5 9 2.5 8Z"/><path d="m7.5 9 3-3"/></>);
export const Sparkle     = icon(<><path d="M8 2v3M8 11v3M2 8h3M11 8h3"/><path d="m4.5 4.5 1.7 1.7M9.8 9.8l1.7 1.7M4.5 11.5l1.7-1.7M9.8 6.2l1.7-1.7"/></>);
export const Sun         = icon(<><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1"/></>);
export const Moon        = icon(<><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5Z"/></>);
export const Settings    = icon(<><circle cx="8" cy="8" r="2"/><path d="M13.2 9.6a1 1 0 0 0 .2 1.1l.1.1a1.2 1.2 0 0 1-1.8 1.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V14a1.2 1.2 0 0 1-2.4 0v-.1a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a1.2 1.2 0 1 1-1.7-1.7l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H2.4a1.2 1.2 0 0 1 0-2.4h.1a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1A1.2 1.2 0 1 1 4.8 3.7l.1.1a1 1 0 0 0 1.1.2H6a1 1 0 0 0 .6-.9V3a1.2 1.2 0 1 1 2.4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.2 1.2 0 1 1 1.7 1.7l-.1.1a1 1 0 0 0-.2 1.1V6.7a1 1 0 0 0 .9.6H14a1.2 1.2 0 1 1 0 2.4h-.1a1 1 0 0 0-.7.6Z"/></>);
export const Close       = icon(<><path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/></>);
export const Check       = icon(<><path d="m3 8.5 3.5 3.5L13 4"/></>);
export const Chevron     = icon(<><path d="m5 4 4 4-4 4"/></>);
export const ChevronDown = icon(<><path d="m4 6 4 4 4-4"/></>);
export const More        = icon(<><circle cx="3.5" cy="8" r=".75"/><circle cx="8" cy="8" r=".75"/><circle cx="12.5" cy="8" r=".75"/></>);
export const Star        = icon(<><path d="m8 2 1.8 3.8L14 6.4l-3 2.9.7 4.1L8 11.6 4.3 13.4 5 9.3 2 6.4l4.2-.6L8 2Z"/></>);
export const Trash       = icon(<><path d="M3 4.5h10M6.5 4.5V3.5A1 1 0 0 1 7.5 2.5h1a1 1 0 0 1 1 1v1M4.5 4.5l.5 8.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5"/></>);
export const Pin         = icon(<><path d="m9 2 5 5-2 2-2-.5-3.5 3.5L5 11l-3 1 1-3-.5-1.5 3.5-3.5L5.5 2 9 2Z"/></>);
export const Link        = icon(<><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1"/></>);
export const Export      = icon(<><path d="M3 11.5v1A1.5 1.5 0 0 0 4.5 14h7A1.5 1.5 0 0 0 13 12.5v-1"/><path d="M5 6.5 8 3.5l3 3M8 3.5V11"/></>);
export const History     = icon(<><path d="M2.5 7.5A5.5 5.5 0 1 1 4 11.7"/><path d="M2 12V8.5h3.5"/><path d="M8 5v3.5L10 10"/></>);
export const Quote       = icon(<><path d="M3 9V7c0-1.5 1-2.5 2.5-3M9 9V7c0-1.5 1-2.5 2.5-3"/><path d="M3 9h2v3H3zM9 9h2v3H9z"/></>);
export const Layers      = icon(<><path d="m8 2 6 3-6 3-6-3 6-3Z"/><path d="m2 8 6 3 6-3M2 11l6 3 6-3"/></>);
export const Filter      = icon(<><path d="M2.5 3.5h11l-4 5v4l-3 1V8.5l-4-5Z"/></>);
export const Logo        = icon(<><path d="M3 12V4l5 4 5-4v8"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/></>);
export const LogOut      = icon(<><path d="M6 3H3.5A1 1 0 0 0 2.5 4v8a1 1 0 0 0 1 1H6M10.5 5.5 13.5 8l-3 2.5M7 8h6.5"/></>);
export const Pencil      = icon(<><path d="M10.5 3.5 12.5 5.5 5.5 12.5H3.5v-2L10.5 3.5Z"/><path d="M9.5 4.5l2 2"/></>);
