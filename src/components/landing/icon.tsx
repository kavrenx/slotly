import type { SVGProps } from "react";

export type IconName = "arrow" | "chevron" | "play" | "check" | "bolt" | "link" | "calendar" | "check-calendar" | "shield" | "graduation" | "person" | "laptop" | "coffee" | "clock" | "video" | "globe";
const paths: Record<IconName, React.ReactNode> = {
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
  link: <><path d="m10 13 4-4m-6 5-1 1a4 4 0 0 0 6 6l4-4a4 4 0 0 0 0-6m-1-1 1-1a4 4 0 0 0-6-6L7 7a4 4 0 0 0 0 6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></>,
  "check-calendar": <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 5 3 3 5-5" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  graduation: <><path d="m2 8 10-5 10 5-10 5-10-5Zm4 3v6c4 3 8 3 12 0v-6m4-3v9" /></>,
  person: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2Z" /></>,
  laptop: <><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M2 20h20l-2-4H4l-2 4Z" /></>,
  coffee: <><path d="M4 8h13v7a6 6 0 0 1-12 0V8m12 1h2a3 3 0 0 1 0 6h-2M3 22h17M8 2v2m5-2v2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  video: <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
};
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
