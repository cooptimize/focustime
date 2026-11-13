// RS-1: FocusTime's one icon family, by name. Every icon the app's own controls and marks use comes from here, drawn
// from one source (Lucide, ISC; lucide-react, only the icons named below end up in the bundle). 16 px at the Default
// text size and scaled with it (--icon), a 1.5 px stroke at every size, rounded ends, the color of the text beside it.
// Not here on purpose: the DevOps type icons (ui/TypeIcon.tsx, the project's own shapes and colors), the brand marks
// and Lumen (ui/brand/), and a person's photo.
import {
  Activity, Archive, Calendar, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Bell, Bold, BookOpen, CalendarClock, CalendarDays, CalendarOff, CalendarPlus,
  ChartNoAxesColumn, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleHelp, Clock, Code, Columns4, Command, Copy, Database, Download,
  Ellipsis, ExternalLink, Eye, EyeOff, File, FileText, Flag, Folder, FolderGit2, GanttChart, GripVertical, Handshake, History, Image, Inbox, Info, Italic,
  Keyboard, LayoutGrid, Link, List, ListFilter, ListOrdered, ListTree, LogOut, MessageCircle, MessageSquareText, MessagesSquare, Mic, Minus, Monitor, Move,
  Palette, Paperclip, Pause, Pencil, Phone, Pin, Play, Plug, Plus, RefreshCw, Repeat, Ruler, Search, Send, Shield, SlidersHorizontal, Smartphone, Sparkles,
  Square, SquarePlus, StickyNote, Sun, Target, Timer, Trash2, TreePalm, TriangleAlert, Type, Undo2, Upload, User, UserPlus, Users, Video, Volume2, WrapText, X,
  type LucideIcon,
} from "lucide-react";

/** The family, by FocusTime's own names (what the thing is, never the drawing). */
const ICONS = {
  // Tabs
  day: CalendarDays, week: Columns4, backlog: ListTree, status: ChartNoAxesColumn, inbox: Inbox,
  // Top bar
  focus: Target, capture: SquarePlus, ask: MessageCircle, more: Ellipsis, vm: Monitor, code: Code, settings: SlidersHorizontal,
  // Actions
  add: Plus, edit: Pencil, move: Move, copy: Copy, link: Link, search: Search, filter: ListFilter, refresh: RefreshCw, done: Check, close: X,
  loop: Send, time: Clock, open: ChevronDown, closed: ChevronRight, up: ChevronUp, back: ChevronLeft, next: ChevronRight, preview: Eye, ai: Sparkles,
  remove: Trash2, undo: Undo2, external: ExternalLink, hide: EyeOff, download: Download, sort: ArrowUpDown, minus: Minus, grip: GripVertical, pin: Pin,
  play: Play, pause: Pause, stop: Square, send: Send, assign: UserPlus, attach: Paperclip, mic: Mic,
  bold: Bold, italic: Italic, bullets: List, numbers: ListOrdered, wrap: WrapText,
  "arrow-up": ArrowUp, "arrow-down": ArrowDown, "arrow-left": ArrowLeft, "arrow-right": ArrowRight,
  // Things
  promise: Handshake, chats: MessagesSquare, "to-sort": StickyNote, meeting: Video, call: Phone, personal: User, "all-day": Sun, pto: TreePalm,
  holiday: CalendarOff, catchup: History, standing: Repeat, risk: TriangleAlert, folder: Folder, file: File, repo: FolderGit2, people: Users,
  flag: Flag, timer: Timer, size: Ruler, schedule: CalendarClock, "add-date": CalendarPlus, grid: LayoutGrid, gantt: GanttChart, archive: Archive, calendar: Calendar, deploy: Upload,
  // Places in menus
  guide: BookOpen, docs: FileText, keys: Keyboard, commands: Command, feedback: MessageSquareText, about: Info, help: CircleHelp, notices: Bell,
  "sign-out": LogOut, theme: Palette, "text-size": Type, sound: Volume2, data: Database, activity: Activity, connect: Plug, admin: Shield, phone: Smartphone,
  image: Image, dot: Circle,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/**
 * One icon. Beside a word it is decoration (hidden from screen readers); alone it needs `label`, its name. The size
 * and the stroke come from the stylesheet (.ft-icon), so an icon follows the text size and the color of its place.
 */
export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  const Drawn = ICONS[name];
  return (
    <Drawn
      className={`ft-icon${className ? ` ${className}` : ""}`}
      data-icon={name}
      strokeWidth={1.5}
      nonScalingStroke
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
