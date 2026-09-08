import type { CSSProperties } from 'react'
const paths: Record<string, string> = {
  select: 'M5 3l14 9-7 1-3 7z', hand: 'M8 12V6a2 2 0 014 0v6M12 6V4a2 2 0 014 0v8M16 8a2 2 0 014 0v7c0 4-3 6-7 6-2 0-4-1-5-3l-4-5a2 2 0 013-2l2 2',
  draw: 'M4 20l1-5L16 4a2 2 0 013 3L8 18zM13 7l4 4', highlight: 'M5 16l10-12 5 5-10 12zM3 21h9M6 15l5 5',
  text: 'M4 5h16M12 5v15M8 20h8', rectangle: 'M4 5h16v14H4z', ellipse: 'M20 12a8 7 0 11-16 0 8 7 0 1116 0', diamond: 'M12 3l9 9-9 9-9-9z',
  line: 'M4 20L20 4', arrow: 'M4 20L20 4M9 4h11v11', frame: 'M5 3v18M19 3v18M3 5h18M3 19h18', eraser: 'M3 14l10-11 8 8-10 10H8zM8 9l8 8M11 21h10',
  home: 'M3 11l9-8 9 8M6 9v12h12V9M10 21v-7h4v7', fit: 'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',
  undo: 'M8 4L3 9l5 5M3 9h10a7 7 0 010 14', redo: 'M16 4l5 5-5 5M21 9H11a7 7 0 000 14',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  more: 'M4 6h16M4 12h16M4 18h16', close: 'M5 5l14 14M19 5L5 19', download: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
}
export function Icon({ name, style }: { name: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name] ?? paths.more} /></svg>
}
