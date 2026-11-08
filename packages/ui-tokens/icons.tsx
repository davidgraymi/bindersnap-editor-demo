import type { AriaAttributes, SVGAttributes } from "react";
import {
  AArrowDown,
  AArrowUp,
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  CalendarDays,
  CaseSensitive,
  ClipboardPaste,
  ClipboardType,
  Code,
  Columns3,
  Ellipsis,
  Globe,
  Highlighter,
  Image,
  ImageMinus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Keyboard,
  Link,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  MessageSquareText,
  Minus,
  MoveHorizontal,
  PaintBucket,
  Paintbrush,
  Pilcrow,
  Printer,
  Quote,
  Redo2,
  RemoveFormatting,
  Replace,
  RotateCcw,
  Rows3,
  Scaling,
  ScanText,
  Scissors,
  SeparatorHorizontal,
  Sigma,
  SquareSplitHorizontal,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableCellsMerge,
  TableCellsSplit,
  Type,
  Underline,
  Undo2,
  WrapText,
  ZoomIn,
  ZoomOut,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bell,
  BookOpen,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleSlash,
  CircleX,
  ClipboardList,
  Clock,
  CloudCheck,
  Columns2,
  Combine,
  Copy,
  CornerDownLeft,
  CreditCard,
  Download,
  Eye,
  File,
  FileArchive,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  FolderUp,
  History,
  House,
  Layers,
  Loader2,
  Lock,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  MessageSquareCheck,
  MessageSquarePlus,
  MessageSquareWarning,
  Moon,
  NotebookTabs,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  SmilePlus,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  UserRoundCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/** A glyph from the vocabulary below. */
export type IconGlyph = LucideIcon;

/**
 * Every icon Bindersnap draws, named by what it means to the person reading
 * it rather than by what it looks like. **One glyph per idea, one idea per
 * glyph**: a compliance lead who opens the app a few times a month learns a
 * picture only if it never changes, and never means something else.
 *
 * Components draw these through `AppIcon` and never import `lucide-react`
 * themselves (`apps/app/icons.test.ts` fails if they do). A new icon is a
 * new entry here, under the idea it stands for — and if its glyph is already
 * taken, the idea is either the same one (reuse the entry) or needs a
 * different picture. `icons.test.ts` beside this file holds that line.
 *
 * Git's own symbols (branch, pull request, merge) are deliberately absent:
 * the words say "draft" and "change request", and so must the pictures.
 */
export const ICON = {
  // ── Places ─────────────────────────────────────────────────────────────
  home: House,
  organization: Building2,
  /** A ring binder with tab dividers: the thing a surveyor asks to see. */
  binder: NotebookTabs,
  folder: Folder,
  /** A document written in Bindersnap's editor. */
  document: FileText,
  /** A file uploaded from elsewhere — Word, PDF. Shown with its format. */
  uploadedFile: File,

  // ── The record's lifecycle: three shapes ───────────────────────────────
  /** Work in progress: only its author sees it, and it can still change. */
  draft: PencilLine,
  /** Sent out for sign-off: the clipboard passed round for signatures. */
  changeRequest: ClipboardList,
  /** The seal: approved and published. Nothing else wears it. */
  onRecord: BadgeCheck,
  /** Send a draft out for review. */
  propose: Send,
  history: History,

  // ── A change request's outcome ─────────────────────────────────────────
  open: CircleDot,
  /** Published puts a version on the record, so it wears the seal. */
  published: BadgeCheck,
  closed: CircleSlash,

  // ── A reviewer's verdict, and the rules it counts toward ───────────────
  approved: CircleCheck,
  /** A sign-off rule satisfied, a check that passed: the same "yes". */
  met: CircleCheck,
  changesRequested: CircleX,
  waiting: Clock,
  /** Someone whose approval counts, or who is asked to review. */
  approver: UserRoundCheck,

  // ── Comments and concerns ──────────────────────────────────────────────
  comment: MessageSquare,
  /** An unresolved thread — it can hold up publishing. */
  openConcern: MessageSquareWarning,
  resolvedConcern: MessageSquareCheck,
  addReaction: SmilePlus,
  feedback: MessageSquarePlus,

  // ── Working on documents ───────────────────────────────────────────────
  /** Change something's name or words: rename, edit a description. */
  edit: Pencil,
  newDocument: FilePlus2,
  newFolder: FolderPlus,
  moveToFolder: FolderInput,
  upload: Upload,
  uploadFolder: FolderUp,
  copy: Copy,
  /** Saved to your draft. */
  saved: CloudCheck,
  /** Archive a published document; its history stays. */
  archive: Archive,
  restore: ArchiveRestore,
  /** Only for something never published. */
  delete: Trash2,
  compareSideBySide: Columns2,
  compareInline: Layers,
  preview: Eye,
  /** Two edits to the same document brought together. */
  resolveConflicts: Combine,
  /** Take in what was published since the draft began. */
  bringUpToDate: RefreshCw,
  refresh: RefreshCw,
  download: Download,
  /** Every version and sign-off of a document, in one file for a surveyor. */
  auditPacket: FileArchive,

  // ── People and access ──────────────────────────────────────────────────
  people: Users,
  addPerson: UserPlus,
  account: UserRound,
  private: Lock,
  /** Who may approve, and the rules that say so. */
  rules: ShieldCheck,
  siteAdmin: Shield,
  billing: CreditCard,
  settings: Settings,

  // ── Interface ──────────────────────────────────────────────────────────
  notifications: Bell,
  markAllRead: CheckCheck,
  search: Search,
  enterKey: CornerDownLeft,
  add: Plus,
  help: CircleHelp,
  /** A help guide: how something works. */
  guide: BookOpen,
  tour: MapIcon,
  darkMode: Moon,
  signOut: LogOut,
  back: ArrowLeft,
  forward: ArrowRight,
  // A chevron means only its direction — a menu opens below, a closed
  // section opens to the right — so these three are named for it.
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  showPanel: PanelLeftOpen,
  hidePanel: PanelLeftClose,
  loading: Loader2,
  warning: AlertTriangle,
  /**
   * Chosen or ticked: the current item in a menu or picker, a finished
   * step, a file marked viewed, something a plan includes. Never a verdict.
   */
  selected: Check,
  /** Close, dismiss, or take something off a list. Never a verdict. */
  close: X,

  // ── The editor ─────────────────────────────────────────────────────────
  // Word's own pictures, so a person who has used Word knows each one.
  undo: Undo2,
  redo: Redo2,
  cut: Scissors,
  paste: ClipboardPaste,
  pastePlainText: ClipboardType,
  formatPainter: Paintbrush,
  font: Type,
  growFont: AArrowUp,
  shrinkFont: AArrowDown,
  clearFormatting: RemoveFormatting,
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strikethrough: Strikethrough,
  subscript: Subscript,
  superscript: Superscript,
  fontColor: Baseline,
  highlight: Highlighter,
  styles: Pilcrow,
  lineSpacing: WrapText,
  bulletList: List,
  numberedList: ListOrdered,
  checklist: ListChecks,
  decreaseIndent: IndentDecrease,
  increaseIndent: IndentIncrease,
  alignLeft: AlignLeft,
  alignCenter: AlignCenter,
  alignRight: AlignRight,
  justify: AlignJustify,
  /** A ribbon group folded away for want of room. */
  more: Ellipsis,
  matchCase: CaseSensitive,
  replace: Replace,
  selectAll: ScanText,
  pageBreak: SeparatorHorizontal,
  table: Table,
  picture: Image,
  link: Link,
  horizontalLine: Minus,
  quote: Quote,
  codeBlock: Code,
  dateAndTime: CalendarDays,
  symbol: Sigma,
  /** The document laid out as pages: the document itself. */
  printLayout: FileText,
  webLayout: Globe,
  outline: ListTree,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  actualSize: SquareSplitHorizontal,
  pageWidth: MoveHorizontal,
  print: Printer,
  shortcuts: Keyboard,
  insertRow: Rows3,
  insertColumn: Columns3,
  mergeCells: TableCellsMerge,
  splitCells: TableCellsSplit,
  shading: PaintBucket,
  pictureSize: Scaling,
  originalSize: RotateCcw,
  altText: MessageSquareText,
  removePicture: ImageMinus,
} as const satisfies Record<string, IconGlyph>;

export type IconName = keyof typeof ICON;

/**
 * Ideas that share a glyph on purpose, each with the one it shares it with.
 * `icons.test.ts` refuses any other pair, so a second meaning cannot creep
 * onto a picture without someone deciding it is the same meaning.
 */
export const SHARED_GLYPHS: ReadonlyArray<readonly [IconName, IconName]> = [
  // Publishing is what puts a version on the record.
  ["published", "onRecord"],
  // A person's approval and a rule it satisfies are the same "yes".
  ["approved", "met"],
  // Bringing a draft up to date is a refresh of what it is built on.
  ["bringUpToDate", "refresh"],
  // Print layout shows the document as the pages it is.
  ["document", "printLayout"],
];

/**
 * An icon at one of the four sizes on the icon scale, so two icons placed
 * side by side always match (docs/design/design-system-audit.md, Task 12).
 */
export type AppIconSize = "xs" | "sm" | "md" | "lg";

/**
 * A var() in an SVG presentation attribute resolves, but an *undefined*
 * one collapses the icon to 0x0 rather than falling back to lucide's
 * default — so every reference carries the scale value as a fallback.
 */
const ICON_SIZE_VAR: Record<AppIconSize, string> = {
  xs: "var(--brand-icon-xs, 12px)",
  sm: "var(--brand-icon-sm, 14px)",
  md: "var(--brand-icon-md, 16px)",
  lg: "var(--brand-icon-lg, 20px)",
};

export function AppIcon({
  icon: Icon,
  size = "sm",
  heavy = false,
  className,
  "aria-hidden": ariaHidden = "true",
  ...rest
}: {
  icon: IconGlyph;
  size?: AppIconSize;
  /** Use the heavier stroke for emphasis only — 1.75 is the default weight. */
  heavy?: boolean;
  className?: string;
  "aria-hidden"?: AriaAttributes["aria-hidden"];
} & Omit<SVGAttributes<SVGSVGElement>, "size" | "strokeWidth">) {
  return (
    <Icon
      size={ICON_SIZE_VAR[size]}
      strokeWidth={
        heavy
          ? "var(--brand-icon-stroke-heavy, 2)"
          : "var(--brand-icon-stroke, 1.75)"
      }
      className={className}
      aria-hidden={ariaHidden}
      {...rest}
    />
  );
}
