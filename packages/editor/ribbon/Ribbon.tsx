import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/core";
import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  CalendarDays,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Ellipsis,
  Code,
  Columns3,
  Copy,
  FileText,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  ImageMinus,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  MessageSquareText,
  Minus,
  PaintBucket,
  Paintbrush,
  MoveHorizontal,
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
  Pilcrow,
  Search,
  SeparatorHorizontal,
  Sigma,
  SquareSplitHorizontal,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  WrapText,
  ZoomIn,
  ZoomOut,
  Upload,
  Keyboard,
} from "lucide-react";

import { LINE_SPACINGS } from "../documentSchema";
import { CASE_MODES } from "../extensions/ChangeCase";
import {
  PICTURE_TYPES,
  PictureError,
  describeFromFileName,
  pictureToDataUrl,
} from "../imageFiles";
import {
  DropButton,
  MenuChoice,
  RibbonButton,
  RibbonGroup,
  RibbonRow,
  keepSelection,
  shortcutLabel,
} from "./controls";
import { paste } from "../clipboard";
import { useFormatState, type FormatState } from "./formatState";
import {
  FONT_CHOICES,
  FONT_SIZES_PT,
  HIGHLIGHT_COLORS,
  PARAGRAPH_STYLES,
  SHADING_COLORS,
  SYMBOLS,
  TEXT_COLORS,
  ZOOM_STEP,
  clampZoom,
  dateChoices,
  stepFontSize,
  styleDefaults,
  type ParagraphStyleId,
} from "./options";

/**
 * Word's ribbon: Home, Insert and View, and a Table tab that appears while the
 * cursor is in one — Word's contextual tab, and the only way to reach table
 * commands without a right-click menu. A Picture tab appears the same way
 * while a picture is selected.
 */

export type RibbonTab = "home" | "insert" | "view" | "table" | "picture";

export type PageLayout = "print" | "web";

export interface ViewSettings {
  layout: PageLayout;
  /**
   * A percentage, or Word's Page Width: as large as the page can be drawn
   * without scrolling sideways, and never past 100%.
   */
  zoom: number | "page-width";
}

interface RibbonProps {
  editor: Editor;
  view: ViewSettings;
  /** The zoom the page is drawn at, Page Width resolved. */
  zoom: number;
  onViewChange: (next: ViewSettings) => void;
  /** Open the find bar, on Find or on Replace. */
  onFind: (replace: boolean) => void;
  /**
   * The document's headings, where the page around the editor shows them —
   * the file panel's Outline tab, in the app. Absent, View has no Outline.
   */
  outline?: { shown: boolean; onToggle: () => void };
  onPrint: () => void;
  /** Every keyboard shortcut, on one sheet (Ctrl+/). */
  onShortcuts?: () => void;
  /** Anything the page puts at the end of the tab row — Save, in practice. */
  end?: ReactNode;
  /**
   * Undo, when the page has something of its own to take back — archiving a
   * file, say. Answers whether it took that back; when it did not, Undo
   * undoes the page's last edit as usual.
   */
  onUndo?: () => boolean;
  /** Whether the page has such a thing to take back, which enables Undo. */
  outsideUndo?: boolean;
}

const TAB_LABELS: Record<RibbonTab, string> = {
  home: "Home",
  insert: "Insert",
  view: "View",
  table: "Table",
  picture: "Picture",
};

/** Where the ribbon's layout is kept, per browser: a habit, not a setting. */
const LAYOUT_KEY = "bindersnap:ribbon-layout";

export type RibbonLayout = "simple" | "classic";

function readLayout(): RibbonLayout {
  try {
    return globalThis.localStorage?.getItem(LAYOUT_KEY) === "classic"
      ? "classic"
      : "simple";
  } catch {
    return "simple";
  }
}

export function Ribbon({
  editor,
  view,
  zoom,
  onViewChange,
  onFind,
  onPrint,
  onShortcuts,
  end,
  onUndo,
  outsideUndo = false,
  outline,
}: RibbonProps) {
  const format = useFormatState(editor);
  const [chosen, setChosen] = useState<RibbonTab>("home");
  const [collapsed, setCollapsed] = useState(false);
  /**
   * **One row unless asked for more**, as Word's simplified ribbon is. The
   * classic ribbon is three rows of commands under its tabs, and on a laptop
   * the page started a third of the way down the screen; the people writing
   * here write all day, in that page. The classic ribbon is one press away,
   * and stays chosen once chosen.
   */
  const [layout, setLayoutState] = useState<RibbonLayout>(readLayout);
  const simple = layout === "simple";
  const setLayout = (next: RibbonLayout) => {
    setLayoutState(next);
    setFold(0);
    try {
      globalThis.localStorage?.setItem(LAYOUT_KEY, next);
    } catch {
      // A browser that keeps nothing still switches, for this sitting.
    }
  };

  /**
   * How far the Home tab is folded to fit, as Word's ribbon folds: the style
   * gallery narrows a style at a time and then becomes one Styles button,
   * then Editing becomes one Find button, then Cut and Copy lose their
   * words. Measured rather than set by breakpoints, because what the ribbon
   * has to fit beside — the file panel, the navigation pane — is not the
   * window's business. Every width change starts again from unfolded, and
   * each fold is taken before the browser paints.
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState(0);
  const [panelWidth, setPanelWidth] = useState(0);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry?.contentRect.width ?? 0);
      setPanelWidth((was) => {
        if (was !== width) setFold(0);
        return width;
      });
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [collapsed]);

  /**
   * **A font arriving is a width change too**, of the ribbon's contents
   * rather than its box. Measured with the fallback font — wider on Linux
   * than the one the page asked for — the ribbon folded, and the width never
   * changed again to unfold it, so the Styles gallery stayed one button for
   * as long as the page was open. Every font load starts again from unfolded.
   */
  const [fontsLoaded, setFontsLoaded] = useState(0);
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts) return;
    let live = true;
    const refit = () => {
      if (!live) return;
      setFold(0);
      setFontsLoaded((count) => count + 1);
    };
    fonts.addEventListener?.("loadingdone", refit);
    void fonts.ready?.then(refit);
    return () => {
      live = false;
      fonts.removeEventListener?.("loadingdone", refit);
    };
  }, []);

  const tabs: RibbonTab[] = [
    "home",
    "insert",
    "view",
    ...(format.inTable ? (["table"] as const) : []),
    ...(format.picture ? (["picture"] as const) : []),
  ];
  // Leaving a table or a picture takes its tab with it, and lands on Home.
  const tab = tabs.includes(chosen) ? chosen : "home";

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || tab !== "home" || simple) return;
    if (panel.scrollWidth > panel.clientWidth + 1 && fold < MAX_FOLD) {
      setFold(fold + 1);
    }
  }, [fold, tab, panelWidth, fontsLoaded, simple]);

  const pickTab = (next: RibbonTab) => {
    if (collapsed) setCollapsed(false);
    setChosen(next);
  };

  /** Undo and Redo: the toolbar's first group, before every tab's own. */
  const undoRedo = (
    <>
      <RibbonButton
        icon={Undo2}
        label="Undo"
        shortcut="Ctrl+Z"
        disabled={!format.canUndo && !outsideUndo}
        onClick={() => {
          if (onUndo?.()) return;
          editor.chain().focus().undo().run();
        }}
      />
      <RibbonButton
        icon={Redo2}
        label="Redo"
        shortcut="Ctrl+Y"
        disabled={!format.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      />
    </>
  );

  return (
    <div
      className={`bs-ribbon${collapsed ? " bs-ribbon--collapsed" : ""}${
        simple ? " bs-ribbon--simple" : ""
      }`}
    >
      <div className="bs-ribbon-bar">
        {/* Folded away with the rest, Undo and Redo stay to hand, as on
            Word's Quick Access Toolbar. */}
        {collapsed ? <div className="bs-ribbon-quick">{undoRedo}</div> : null}

        <div className="bs-ribbon-tabs" role="tablist" aria-label="Ribbon">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`bs-ribbon-tab-${id}`}
              aria-selected={tab === id && !collapsed}
              aria-controls="bs-ribbon-panel"
              className={`bs-ribbon-tab${tab === id ? " is-on" : ""}${
                id === "table" || id === "picture"
                  ? " bs-ribbon-tab--context"
                  : ""
              }`}
              onMouseDown={keepSelection}
              onClick={() => pickTab(id)}
              onDoubleClick={() => setCollapsed((was) => !was)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>

        <div className="bs-ribbon-end">{end}</div>
      </div>

      {collapsed ? null : (
        <div
          ref={panelRef}
          className="bs-ribbon-panel"
          id="bs-ribbon-panel"
          role="tabpanel"
          aria-labelledby={`bs-ribbon-tab-${tab}`}
        >
          {/* **In the toolbar, not beside the tabs**: the first thing in
              it on every tab, as the commands it takes back are. */}
          <RibbonGroup label="Undo" className="bs-rgroup--undo">
            {undoRedo}
          </RibbonGroup>
          {tab === "home" && simple ? (
            <SimpleHomeTab editor={editor} format={format} onFind={onFind} />
          ) : tab === "home" ? (
            <HomeTab
              editor={editor}
              format={format}
              onFind={onFind}
              fold={fold}
            />
          ) : tab === "insert" ? (
            <InsertTab
              editor={editor}
              // Word goes to Table Design the moment a table goes in: the
              // next thing anybody does to a new table is shape it.
              onTableInserted={() => setChosen("table")}
            />
          ) : tab === "view" ? (
            <ViewTab
              view={view}
              zoom={zoom}
              onViewChange={onViewChange}
              onPrint={onPrint}
              onShortcuts={onShortcuts}
              outline={outline}
            />
          ) : tab === "table" ? (
            <TableTab editor={editor} format={format} />
          ) : (
            <PictureTab editor={editor} format={format} />
          )}

          {/* One row, or Word's full ribbon. Double-clicking a tab still
              folds either away. */}
          <button
            type="button"
            className="bs-ribbon-collapse"
            aria-label={simple ? "Show the full ribbon" : "Show one row"}
            title={
              simple
                ? "Show the full ribbon"
                : "Show one row (double-click a tab to hide the ribbon)"
            }
            onMouseDown={keepSelection}
            onClick={() => setLayout(simple ? "classic" : "simple")}
          >
            {simple ? (
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Home ──────────────────────────────────────────────────────────────── */

/** How many styles the gallery shows before folding the rest into a menu. */
const GALLERY_SIZE = 5;

/**
 * Gallery 5 → 0 is five folds; then Editing and Clipboard grow compact; then
 * Paragraph and then Font fold into one button each, as Word's groups do.
 */
const MAX_FOLD = GALLERY_SIZE + 4;

/**
 * The Font box: the font the words are set in, named — the style's own when
 * they carry none, as Word names "Aptos" rather than "Default".
 */
function fontLabel(format: FormatState): string {
  if (format.fontFamily === null) return "";
  if (format.fontFamily === "") return styleDefaults(format.style).font;
  return (
    FONT_CHOICES.find((font) => font.value === format.fontFamily)?.label ??
    "Custom"
  );
}

/**
 * Whether a font in the list is the one the words are in: set on them, or
 * their style's own when they carry none — so Geist is ticked in a paragraph
 * nobody has set a font on, and Lora in a heading.
 */
function isFontInUse(
  format: FormatState,
  font: { label: string; value: string },
): boolean {
  if (format.fontFamily === "") {
    return styleDefaults(format.style).font === font.label;
  }
  return format.fontFamily === font.value;
}

/** Make the paragraph the cursor is in one of the styles, as Word's gallery does. */
function applyParagraphStyle(editor: Editor, id: ParagraphStyleId): void {
  const base = editor.chain().focus().clearNodes();
  switch (id) {
    case "normal":
      base
        .setParagraph()
        .updateAttributes("paragraph", { variant: null })
        .run();
      return;
    case "title":
    case "subtitle":
      base.setParagraph().updateAttributes("paragraph", { variant: id }).run();
      return;
    case "quote":
      base
        .setParagraph()
        .updateAttributes("paragraph", { variant: null })
        .toggleBlockquote()
        .run();
      return;
    case "code":
      base.setCodeBlock().run();
      return;
    default:
      base
        .setHeading({
          level: Number(id.replace("heading", "")) as 1 | 2 | 3 | 4,
        })
        .run();
  }
}

function HomeTab({
  editor,
  format,
  onFind,
  fold,
}: {
  editor: Editor;
  format: FormatState;
  onFind: (replace: boolean) => void;
  /** How folded to fit: see `Ribbon`. */
  fold: number;
}) {
  const gallery = Math.max(0, GALLERY_SIZE - fold);
  const compactEditing = fold > GALLERY_SIZE;
  const compactClipboard = fold > GALLERY_SIZE + 1;
  const foldParagraph = fold > GALLERY_SIZE + 2;
  const foldFont = fold > GALLERY_SIZE + 3;
  const chain = () => editor.chain().focus();
  const size = format.fontSizePt;

  const setSize = (pt: number) => chain().setFontSize(`${pt}pt`).run();

  const applyStyle = (id: ParagraphStyleId) => applyParagraphStyle(editor, id);

  return (
    <>
      <RibbonGroup label="Clipboard">
        {/* Word's split button: the top pastes, the arrow asks how. */}
        <div className="bs-rsplit">
          <RibbonButton
            icon={ClipboardPaste}
            label="Paste"
            shortcut="Ctrl+V"
            large
            onClick={() => void paste(editor, "source")}
          />
          <DropButton
            label="Paste options"
            className="bs-rdrop--split"
            panelClassName="bs-rpanel--list"
            panel={(close) => (
              <>
                <MenuChoice
                  hint="Ctrl+V"
                  onPick={() => {
                    close();
                    void paste(editor, "source");
                  }}
                >
                  Keep Source Formatting
                </MenuChoice>
                <MenuChoice
                  hint="Ctrl+Shift+V"
                  onPick={() => {
                    close();
                    void paste(editor, "text");
                  }}
                >
                  Keep Text Only
                </MenuChoice>
              </>
            )}
          >
            {null}
          </DropButton>
        </div>
        <div className="bs-rstack">
          <RibbonButton
            icon={Scissors}
            label="Cut"
            shortcut="Ctrl+X"
            showLabel={!compactClipboard}
            disabled={!format.hasSelection}
            onClick={() => {
              editor.commands.focus();
              document.execCommand("cut");
            }}
          />
          <RibbonButton
            icon={Copy}
            label="Copy"
            shortcut="Ctrl+C"
            showLabel={!compactClipboard}
            disabled={!format.hasSelection}
            onClick={() => {
              editor.commands.focus();
              document.execCommand("copy");
            }}
          />
          <RibbonButton
            icon={Paintbrush}
            label="Format Painter"
            shortcut="Ctrl+Alt+C"
            tip="Format Painter: click, then select the words to give this look to. Double-click to keep it on; Escape stops."
            showLabel={!compactClipboard}
            active={format.painting}
            onClick={() =>
              format.painting
                ? chain().putDownFormatPainter().run()
                : chain().pickUpFormatting("once").run()
            }
            onDoubleClick={() => chain().pickUpFormatting("sticky").run()}
          />
        </div>
      </RibbonGroup>

      <RibbonGroup
        label="Font"
        className="bs-rgroup--font"
        icon={Type}
        folded={foldFont}
      >
        <RibbonRow>
          <DropButton
            label="Font"
            className="bs-rdrop--font"
            panelClassName="bs-rpanel--list"
            panel={(close) =>
              FONT_CHOICES.map((font) => (
                <MenuChoice
                  key={font.label}
                  checked={isFontInUse(format, font)}
                  style={{ fontFamily: font.value }}
                  onPick={() => {
                    chain().setFontFamily(font.value).run();
                    close();
                  }}
                >
                  {font.label}
                </MenuChoice>
              ))
            }
          >
            <span className="bs-rdrop-value">{fontLabel(format)}</span>
          </DropButton>
          <DropButton
            label="Font size"
            className="bs-rdrop--size"
            panelClassName="bs-rpanel--list bs-rpanel--narrow"
            panel={(close) =>
              FONT_SIZES_PT.map((pt) => (
                <MenuChoice
                  key={pt}
                  checked={size === pt}
                  onPick={() => {
                    setSize(pt);
                    close();
                  }}
                >
                  {pt}
                </MenuChoice>
              ))
            }
          >
            <span className="bs-rdrop-value">{size ?? ""}</span>
          </DropButton>
          <RibbonButton
            icon={AArrowUp}
            label="Grow font"
            shortcut="Ctrl+]"
            onClick={() => setSize(stepFontSize(size ?? 11, 1))}
          />
          <RibbonButton
            icon={AArrowDown}
            label="Shrink font"
            shortcut="Ctrl+["
            onClick={() => setSize(stepFontSize(size ?? 11, -1))}
          />
          <RibbonButton
            icon={RemoveFormatting}
            label="Clear formatting"
            onClick={() => chain().unsetAllMarks().run()}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            icon={Bold}
            label="Bold"
            shortcut="Ctrl+B"
            active={format.bold}
            onClick={() => chain().toggleBold().run()}
          />
          <RibbonButton
            icon={Italic}
            label="Italic"
            shortcut="Ctrl+I"
            active={format.italic}
            onClick={() => chain().toggleItalic().run()}
          />
          <RibbonButton
            icon={UnderlineIcon}
            label="Underline"
            shortcut="Ctrl+U"
            active={format.underline}
            onClick={() => chain().toggleUnderline().run()}
          />
          <RibbonButton
            icon={Strikethrough}
            label="Strikethrough"
            active={format.strike}
            onClick={() => chain().toggleStrike().run()}
          />
          <RibbonButton
            icon={SubscriptIcon}
            label="Subscript"
            shortcut="Ctrl+,"
            active={format.subscript}
            onClick={() => chain().unsetSuperscript().toggleSubscript().run()}
          />
          <RibbonButton
            icon={SuperscriptIcon}
            label="Superscript"
            shortcut="Ctrl+."
            active={format.superscript}
            onClick={() => chain().unsetSubscript().toggleSuperscript().run()}
          />
          <ColorDrop
            label="Font color"
            icon={Baseline}
            current={format.color}
            colors={TEXT_COLORS}
            noneLabel="Automatic"
            onPick={(color) =>
              color === null
                ? chain().unsetColor().run()
                : chain().setColor(color).run()
            }
          />
          <ColorDrop
            label="Text highlight color"
            icon={Highlighter}
            current={format.highlight}
            colors={HIGHLIGHT_COLORS}
            noneLabel="No color"
            onPick={(color) =>
              color === null
                ? chain().unsetHighlight().run()
                : chain().setHighlight({ color }).run()
            }
          />
          {/* In the second row, where Word's font row has no room to spare:
              the first sets the group's width, and a wider group folds the
              Styles gallery sooner. */}
          <DropButton
            label="Change case"
            tip="Change case (Shift+F3)"
            className="bs-rdrop--icon"
            panelClassName="bs-rpanel--list bs-rpanel--narrow"
            panel={(close) =>
              CASE_MODES.map(({ mode, label }) => (
                <MenuChoice
                  key={mode}
                  onPick={() => {
                    chain().changeCase(mode).run();
                    close();
                  }}
                >
                  {label}
                </MenuChoice>
              ))
            }
          >
            <CaseSensitive size={16} strokeWidth={1.75} aria-hidden="true" />
          </DropButton>
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="Paragraph" icon={AlignLeft} folded={foldParagraph}>
        <RibbonRow>
          <RibbonButton
            icon={List}
            label="Bullets"
            active={format.bulletList}
            onClick={() => chain().toggleBulletList().run()}
          />
          <RibbonButton
            icon={ListOrdered}
            label="Numbering"
            active={format.orderedList}
            onClick={() => chain().toggleOrderedList().run()}
          />
          <RibbonButton
            icon={ListChecks}
            label="Checklist"
            active={format.taskList}
            onClick={() => chain().toggleTaskList().run()}
          />
          <RibbonButton
            icon={IndentDecrease}
            label="Decrease indent"
            shortcut="Shift+Tab"
            onClick={() => outdent(editor)}
          />
          <RibbonButton
            icon={IndentIncrease}
            label="Increase indent"
            shortcut="Tab"
            onClick={() => indent(editor)}
          />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            icon={AlignLeft}
            label="Align left"
            shortcut="Ctrl+Shift+L"
            active={format.align === "left"}
            onClick={() => chain().setTextAlign("left").run()}
          />
          <RibbonButton
            icon={AlignCenter}
            label="Center"
            shortcut="Ctrl+Shift+E"
            active={format.align === "center"}
            onClick={() => chain().setTextAlign("center").run()}
          />
          <RibbonButton
            icon={AlignRight}
            label="Align right"
            shortcut="Ctrl+Shift+R"
            active={format.align === "right"}
            onClick={() => chain().setTextAlign("right").run()}
          />
          <RibbonButton
            icon={AlignJustify}
            label="Justify"
            shortcut="Ctrl+Shift+J"
            active={format.align === "justify"}
            onClick={() => chain().setTextAlign("justify").run()}
          />
          <DropButton
            label="Line and paragraph spacing"
            className="bs-rdrop--icon"
            panelClassName="bs-rpanel--list bs-rpanel--narrow"
            panel={(close) =>
              LINE_SPACINGS.map((spacing) => (
                <MenuChoice
                  key={spacing}
                  checked={(format.lineSpacing ?? "1.15") === spacing}
                  onPick={() => {
                    if (spacing === "1.15") chain().unsetLineSpacing().run();
                    else chain().setLineSpacing(spacing).run();
                    close();
                  }}
                >
                  {spacing === "1" ? "1.0" : spacing}
                </MenuChoice>
              ))
            }
          >
            <WrapText size={16} strokeWidth={1.75} aria-hidden="true" />
          </DropButton>
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="Styles" className="bs-rgroup--styles">
        {gallery > 0 ? (
          <div className="bs-styles" role="listbox" aria-label="Styles">
            {PARAGRAPH_STYLES.slice(0, gallery).map((style) => (
              <button
                key={style.id}
                type="button"
                role="option"
                aria-selected={format.style === style.id}
                className={`bs-style bs-style--${style.id}${
                  format.style === style.id ? " is-on" : ""
                }`}
                title={
                  style.shortcut
                    ? `${style.label} (${shortcutLabel(style.shortcut)})`
                    : style.label
                }
                onMouseDown={keepSelection}
                onClick={() => applyStyle(style.id)}
              >
                <span className="bs-style-sample" aria-hidden="true">
                  AaBbCc
                </span>
                <span className="bs-style-name">{style.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        {/* Word's gallery shows a row and folds the rest behind its arrow;
            this one does the same, so the ribbon fits beside the page. With
            no room for a row at all, the arrow is the Styles button. */}
        <DropButton
          label={gallery > 0 ? "More styles" : "Styles"}
          className={
            gallery > 0 ? "bs-rdrop--icon bs-rdrop--gallery" : "bs-rdrop--large"
          }
          panelClassName="bs-rpanel--list"
          // Lit when the style in force is one the row does not show; as the
          // Styles button there is no row, and every style would light it.
          active={
            gallery > 0 &&
            format.style !== null &&
            PARAGRAPH_STYLES.findIndex((style) => style.id === format.style) >=
              gallery
          }
          panel={(close) => (
            <>
              {PARAGRAPH_STYLES.map((style) => (
                <MenuChoice
                  key={style.id}
                  checked={format.style === style.id}
                  hint={style.shortcut}
                  onPick={() => {
                    applyStyle(style.id);
                    close();
                  }}
                >
                  <span className={`bs-style-menu bs-style--${style.id}`}>
                    <span className="bs-style-sample">{style.label}</span>
                  </span>
                </MenuChoice>
              ))}
              {/* Word links numbering to the heading styles; so does this,
                  from the same menu, for the whole document at once. */}
              <div className="bs-rmenu-sep" role="separator" />
              <MenuChoice
                checked={format.numberedHeadings}
                hint="1. 1.1"
                onPick={() => {
                  chain().toggleHeadingNumbers().run();
                  close();
                }}
              >
                Number the headings
              </MenuChoice>
            </>
          )}
        >
          {gallery > 0 ? (
            <span className="sr-only">More styles</span>
          ) : (
            <>
              <Pilcrow size={22} strokeWidth={1.75} aria-hidden="true" />
              <span className="bs-rb-label">Styles</span>
            </>
          )}
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="Editing">
        {compactEditing ? (
          <DropButton
            label="Find"
            className="bs-rdrop--large"
            panelClassName="bs-rpanel--list"
            panel={(close) => (
              <>
                <MenuChoice
                  hint={shortcutLabel("Ctrl+F")}
                  onPick={() => {
                    close();
                    onFind(false);
                  }}
                >
                  Find
                </MenuChoice>
                <MenuChoice
                  hint={shortcutLabel("Ctrl+H")}
                  onPick={() => {
                    close();
                    onFind(true);
                  }}
                >
                  Replace
                </MenuChoice>
                <MenuChoice
                  hint={shortcutLabel("Ctrl+A")}
                  onPick={() => {
                    close();
                    chain().selectAll().run();
                  }}
                >
                  Select all
                </MenuChoice>
              </>
            )}
          >
            <Search size={22} strokeWidth={1.75} aria-hidden="true" />
            <span className="bs-rb-label">Find</span>
          </DropButton>
        ) : (
          <div className="bs-rstack">
            <RibbonButton
              icon={Search}
              label="Find"
              shortcut="Ctrl+F"
              showLabel
              onClick={() => onFind(false)}
            />
            <RibbonButton
              icon={Replace}
              label="Replace"
              shortcut="Ctrl+H"
              showLabel
              onClick={() => onFind(true)}
            />
            <RibbonButton
              icon={ScanText}
              label="Select all"
              shortcut="Ctrl+A"
              showLabel
              onClick={() => chain().selectAll().run()}
            />
          </div>
        )}
      </RibbonGroup>
    </>
  );
}

/* ─── Home, in one row ──────────────────────────────────────────────────── */

const ALIGNMENTS = [
  {
    align: "left",
    label: "Align left",
    shortcut: "Ctrl+Shift+L",
    icon: AlignLeft,
  },
  {
    align: "center",
    label: "Center",
    shortcut: "Ctrl+Shift+E",
    icon: AlignCenter,
  },
  {
    align: "right",
    label: "Align right",
    shortcut: "Ctrl+Shift+R",
    icon: AlignRight,
  },
  {
    align: "justify",
    label: "Justify",
    shortcut: "Ctrl+Shift+J",
    icon: AlignJustify,
  },
] as const;

/**
 * The Home tab as one row: Word's simplified ribbon.
 *
 * **What a policy is written with, in reach; the rest a press away.** A
 * policy's look is its styles — Normal, the headings, a list — so the style
 * comes first and is a field that says which one the cursor is in. Then the
 * marks and the lists. The font, its size and the rest of what makes one
 * policy look unlike the next are in More, where they are still one press
 * away and no longer the first thing offered. Cut, Copy and Paste are the
 * keyboard's: a browser's own, greyed out until there is a selection, and
 * nobody's way of copying.
 */
function SimpleHomeTab({
  editor,
  format,
  onFind,
}: {
  editor: Editor;
  format: FormatState;
  onFind: (replace: boolean) => void;
}) {
  const chain = () => editor.chain().focus();
  const size = format.fontSizePt;
  const setSize = (pt: number) => chain().setFontSize(`${pt}pt`).run();
  const style = PARAGRAPH_STYLES.find((entry) => entry.id === format.style);
  const alignment =
    ALIGNMENTS.find((entry) => entry.align === format.align) ?? ALIGNMENTS[0];

  return (
    <>
      <RibbonGroup label="Styles" className="bs-rgroup--simple">
        <DropButton
          label="Style"
          tip="The paragraph's style"
          className="bs-rdrop--font bs-rdrop--style"
          panelClassName="bs-rpanel--list"
          panel={(close) => (
            <>
              {PARAGRAPH_STYLES.map((entry) => (
                <MenuChoice
                  key={entry.id}
                  checked={format.style === entry.id}
                  hint={
                    entry.shortcut ? shortcutLabel(entry.shortcut) : undefined
                  }
                  onPick={() => {
                    applyParagraphStyle(editor, entry.id);
                    close();
                  }}
                >
                  <span className={`bs-style-menu bs-style--${entry.id}`}>
                    <span className="bs-style-sample">{entry.label}</span>
                  </span>
                </MenuChoice>
              ))}
              <div className="bs-rmenu-sep" role="separator" />
              <MenuChoice
                checked={format.numberedHeadings}
                hint="1. 1.1"
                onPick={() => {
                  chain().toggleHeadingNumbers().run();
                  close();
                }}
              >
                Number the headings
              </MenuChoice>
            </>
          )}
        >
          <span className="bs-rdrop-value">{style?.label ?? ""}</span>
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="Font" className="bs-rgroup--simple">
        <RibbonButton
          icon={Bold}
          label="Bold"
          shortcut="Ctrl+B"
          active={format.bold}
          onClick={() => chain().toggleBold().run()}
        />
        <RibbonButton
          icon={Italic}
          label="Italic"
          shortcut="Ctrl+I"
          active={format.italic}
          onClick={() => chain().toggleItalic().run()}
        />
        <RibbonButton
          icon={UnderlineIcon}
          label="Underline"
          shortcut="Ctrl+U"
          active={format.underline}
          onClick={() => chain().toggleUnderline().run()}
        />
        <RibbonButton
          icon={Strikethrough}
          label="Strikethrough"
          active={format.strike}
          onClick={() => chain().toggleStrike().run()}
        />
        <ColorDrop
          label="Font color"
          icon={Baseline}
          current={format.color}
          colors={TEXT_COLORS}
          noneLabel="Automatic"
          onPick={(color) =>
            color === null
              ? chain().unsetColor().run()
              : chain().setColor(color).run()
          }
        />
        <ColorDrop
          label="Text highlight color"
          icon={Highlighter}
          current={format.highlight}
          colors={HIGHLIGHT_COLORS}
          noneLabel="No color"
          onPick={(color) =>
            color === null
              ? chain().unsetHighlight().run()
              : chain().setHighlight({ color }).run()
          }
        />
        <RibbonButton
          icon={RemoveFormatting}
          label="Clear formatting"
          onClick={() => chain().unsetAllMarks().run()}
        />
      </RibbonGroup>

      <RibbonGroup label="Paragraph" className="bs-rgroup--simple">
        <RibbonButton
          icon={List}
          label="Bullets"
          active={format.bulletList}
          onClick={() => chain().toggleBulletList().run()}
        />
        <RibbonButton
          icon={ListOrdered}
          label="Numbering"
          active={format.orderedList}
          onClick={() => chain().toggleOrderedList().run()}
        />
        <RibbonButton
          icon={ListChecks}
          label="Checklist"
          active={format.taskList}
          onClick={() => chain().toggleTaskList().run()}
        />
        <RibbonButton
          icon={IndentDecrease}
          label="Decrease indent"
          shortcut="Shift+Tab"
          onClick={() => outdent(editor)}
        />
        <RibbonButton
          icon={IndentIncrease}
          label="Increase indent"
          shortcut="Tab"
          onClick={() => indent(editor)}
        />
        {/* One button for the four, showing the one in force — Word's
            simplified ribbon does the same. */}
        <DropButton
          label="Alignment"
          tip={`Alignment: ${alignment.label}`}
          className="bs-rdrop--icon"
          panelClassName="bs-rpanel--list"
          panel={(close) =>
            ALIGNMENTS.map((entry) => (
              <MenuChoice
                key={entry.align}
                checked={(format.align ?? "left") === entry.align}
                hint={shortcutLabel(entry.shortcut)}
                onPick={() => {
                  chain().setTextAlign(entry.align).run();
                  close();
                }}
              >
                {entry.label}
              </MenuChoice>
            ))
          }
        >
          <alignment.icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </DropButton>
        <DropButton
          label="Line and paragraph spacing"
          className="bs-rdrop--icon"
          panelClassName="bs-rpanel--list bs-rpanel--narrow"
          panel={(close) =>
            LINE_SPACINGS.map((spacing) => (
              <MenuChoice
                key={spacing}
                checked={(format.lineSpacing ?? "1.15") === spacing}
                onPick={() => {
                  if (spacing === "1.15") chain().unsetLineSpacing().run();
                  else chain().setLineSpacing(spacing).run();
                  close();
                }}
              >
                {spacing === "1" ? "1.0" : spacing}
              </MenuChoice>
            ))
          }
        >
          <WrapText size={16} strokeWidth={1.75} aria-hidden="true" />
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="More" className="bs-rgroup--simple">
        {/* Everything else the classic Home tab has, laid out as it is
            there: the font and its size, the rarer marks, Format Painter and
            pasting as plain text. */}
        <DropButton
          label="More formatting"
          tip="Font, size and more"
          className="bs-rdrop--icon"
          role="dialog"
          panelClassName="bs-rpanel--flyout"
          panel={(close) => (
            <div className="bs-rgroup-flyout">
              <div className="bs-rgroup-body">
                <RibbonRow>
                  <DropButton
                    label="Font"
                    className="bs-rdrop--font"
                    panelClassName="bs-rpanel--list"
                    panel={(closeFont) =>
                      FONT_CHOICES.map((font) => (
                        <MenuChoice
                          key={font.label}
                          checked={isFontInUse(format, font)}
                          style={{ fontFamily: font.value }}
                          onPick={() => {
                            chain().setFontFamily(font.value).run();
                            closeFont();
                          }}
                        >
                          {font.label}
                        </MenuChoice>
                      ))
                    }
                  >
                    <span className="bs-rdrop-value">{fontLabel(format)}</span>
                  </DropButton>
                  <DropButton
                    label="Font size"
                    className="bs-rdrop--size"
                    panelClassName="bs-rpanel--list bs-rpanel--narrow"
                    panel={(closeSize) =>
                      FONT_SIZES_PT.map((pt) => (
                        <MenuChoice
                          key={pt}
                          checked={size === pt}
                          onPick={() => {
                            setSize(pt);
                            closeSize();
                          }}
                        >
                          {pt}
                        </MenuChoice>
                      ))
                    }
                  >
                    <span className="bs-rdrop-value">{size ?? ""}</span>
                  </DropButton>
                  <RibbonButton
                    icon={AArrowUp}
                    label="Grow font"
                    shortcut="Ctrl+]"
                    onClick={() => setSize(stepFontSize(size ?? 11, 1))}
                  />
                  <RibbonButton
                    icon={AArrowDown}
                    label="Shrink font"
                    shortcut="Ctrl+["
                    onClick={() => setSize(stepFontSize(size ?? 11, -1))}
                  />
                </RibbonRow>
                <RibbonRow>
                  <RibbonButton
                    icon={SubscriptIcon}
                    label="Subscript"
                    shortcut="Ctrl+,"
                    active={format.subscript}
                    onClick={() =>
                      chain().unsetSuperscript().toggleSubscript().run()
                    }
                  />
                  <RibbonButton
                    icon={SuperscriptIcon}
                    label="Superscript"
                    shortcut="Ctrl+."
                    active={format.superscript}
                    onClick={() =>
                      chain().unsetSubscript().toggleSuperscript().run()
                    }
                  />
                  <DropButton
                    label="Change case"
                    tip="Change case (Shift+F3)"
                    className="bs-rdrop--icon"
                    panelClassName="bs-rpanel--list bs-rpanel--narrow"
                    panel={(closeCase) =>
                      CASE_MODES.map(({ mode, label }) => (
                        <MenuChoice
                          key={mode}
                          onPick={() => {
                            chain().changeCase(mode).run();
                            closeCase();
                          }}
                        >
                          {label}
                        </MenuChoice>
                      ))
                    }
                  >
                    <CaseSensitive
                      size={16}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </DropButton>
                  <RibbonButton
                    icon={Paintbrush}
                    label="Format Painter"
                    shortcut="Ctrl+Alt+C"
                    tip="Format Painter: click, then select the words to give this look to. Double-click to keep it on; Escape stops."
                    active={format.painting}
                    onClick={() => {
                      close();
                      if (format.painting) chain().putDownFormatPainter().run();
                      else chain().pickUpFormatting("once").run();
                    }}
                    onDoubleClick={() =>
                      chain().pickUpFormatting("sticky").run()
                    }
                  />
                  <RibbonButton
                    icon={ClipboardPaste}
                    label="Paste as plain text"
                    shortcut="Ctrl+Shift+V"
                    tip="Paste as plain text, keeping only the words"
                    onClick={() => {
                      close();
                      void paste(editor, "text");
                    }}
                  />
                </RibbonRow>
              </div>
            </div>
          )}
        >
          <Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" />
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="Editing" className="bs-rgroup--simple">
        <RibbonButton
          icon={Search}
          label="Find"
          shortcut="Ctrl+F"
          onClick={() => onFind(false)}
        />
        <RibbonButton
          icon={Replace}
          label="Replace"
          shortcut="Ctrl+H"
          onClick={() => onFind(true)}
        />
      </RibbonGroup>
    </>
  );
}

/** Tab in a list nests the item; anywhere else it indents the paragraph. */
export function indent(editor: Editor): boolean {
  const chain = editor.chain().focus();
  if (editor.isActive("taskItem")) return chain.sinkListItem("taskItem").run();
  if (editor.isActive("listItem")) return chain.sinkListItem("listItem").run();
  return chain.indentParagraph().run();
}

export function outdent(editor: Editor): boolean {
  const chain = editor.chain().focus();
  if (editor.isActive("taskItem")) return chain.liftListItem("taskItem").run();
  if (editor.isActive("listItem")) return chain.liftListItem("listItem").run();
  return chain.outdentParagraph().run();
}

function ColorDrop({
  label,
  icon: Icon,
  current,
  colors,
  noneLabel,
  onPick,
}: {
  label: string;
  icon: typeof Baseline;
  current: string | null;
  colors: Array<{ label: string; value: string }>;
  noneLabel: string;
  onPick: (color: string | null) => void;
}) {
  return (
    <DropButton
      label={label}
      className="bs-rdrop--icon"
      panelClassName="bs-rpanel--palette"
      panel={(close) => (
        <>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={current === null}
            className="bs-rmenu-item"
            onClick={() => {
              onPick(null);
              close();
            }}
          >
            <span className="bs-palette-none" aria-hidden="true" />
            {noneLabel}
          </button>
          <div className="bs-palette">
            {colors.map((color) => (
              <button
                key={color.value}
                type="button"
                role="menuitemradio"
                aria-checked={current?.toLowerCase() === color.value}
                aria-label={color.label}
                title={color.label}
                className={`bs-palette-swatch${
                  current?.toLowerCase() === color.value ? " is-on" : ""
                }`}
                style={{ background: color.value }}
                onClick={() => {
                  onPick(color.value);
                  close();
                }}
              />
            ))}
          </div>
        </>
      )}
    >
      <span className="bs-rb-icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.75} />
        <span
          className="bs-rb-swatch"
          style={{ background: current ?? "transparent" }}
        />
      </span>
    </DropButton>
  );
}

/* ─── Insert ────────────────────────────────────────────────────────────── */

function InsertTab({
  editor,
  onTableInserted,
}: {
  editor: Editor;
  onTableInserted: () => void;
}) {
  const chain = () => editor.chain().focus();

  return (
    <>
      <RibbonGroup label="Pages">
        <RibbonButton
          icon={SeparatorHorizontal}
          label="Page break"
          shortcut="Ctrl+Enter"
          large
          onClick={() => chain().setPageBreak().run()}
        />
        <RibbonButton
          icon={ListTree}
          label="Table of contents"
          large
          onClick={() => chain().insertTableOfContents().run()}
        />
      </RibbonGroup>

      <RibbonGroup label="Tables">
        <DropButton
          label="Table"
          className="bs-rdrop--large"
          role="dialog"
          panelClassName="bs-rpanel--grid"
          panel={(close) => (
            <TableGridPicker
              onPick={(rows, cols) => {
                chain().insertTable({ rows, cols, withHeaderRow: true }).run();
                onTableInserted();
                close();
              }}
            />
          )}
        >
          <TableIcon size={22} strokeWidth={1.75} aria-hidden="true" />
          <span className="bs-rb-label">Table</span>
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="Illustrations">
        <DropButton
          label="Picture"
          className="bs-rdrop--large"
          role="dialog"
          panelClassName="bs-rpanel--form"
          panel={(close) => (
            <PictureForm
              onInsert={(src, alt) => {
                chain().setImage({ src, alt }).run();
                close();
              }}
              onCancel={close}
            />
          )}
        >
          <ImageIcon size={22} strokeWidth={1.75} aria-hidden="true" />
          <span className="bs-rb-label">Picture</span>
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="Links">
        <DropButton
          label="Link"
          tip={`Link (${shortcutLabel("Ctrl+K")})`}
          className="bs-rdrop--large"
          role="dialog"
          panelClassName="bs-rpanel--form"
          active={editor.isActive("link")}
          panel={(close) => <LinkForm editor={editor} onDone={close} />}
        >
          <LinkIcon size={22} strokeWidth={1.75} aria-hidden="true" />
          <span className="bs-rb-label">Link</span>
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="Text">
        <div className="bs-rstack">
          <RibbonButton
            icon={Minus}
            label="Horizontal line"
            showLabel
            onClick={() => chain().setHorizontalRule().run()}
          />
          <RibbonButton
            icon={Quote}
            label="Quote"
            showLabel
            onClick={() => chain().toggleBlockquote().run()}
          />
          <RibbonButton
            icon={Code}
            label="Code block"
            showLabel
            onClick={() => chain().toggleCodeBlock().run()}
          />
        </div>
        <DropButton
          label="Date & Time"
          className="bs-rdrop--large"
          panelClassName="bs-rpanel--list"
          panel={(close) =>
            dateChoices(new Date()).map((text) => (
              <MenuChoice
                key={text}
                onPick={() => {
                  chain().insertContent({ type: "text", text }).run();
                  close();
                }}
              >
                {text}
              </MenuChoice>
            ))
          }
        >
          <CalendarDays size={22} strokeWidth={1.75} aria-hidden="true" />
          <span className="bs-rb-label">Date &amp; Time</span>
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="Symbols">
        <DropButton
          label="Symbol"
          className="bs-rdrop--large"
          panelClassName="bs-rpanel--symbols"
          panel={(close) => (
            <div className="bs-symbols">
              {SYMBOLS.map((symbol) => (
                <button
                  key={symbol.char}
                  type="button"
                  role="menuitem"
                  className="bs-symbol"
                  title={symbol.name}
                  aria-label={symbol.name}
                  onClick={() => {
                    chain().insertContent(symbol.char).run();
                    close();
                  }}
                >
                  {symbol.char}
                </button>
              ))}
            </div>
          )}
        >
          <Sigma size={22} strokeWidth={1.75} aria-hidden="true" />
          <span className="bs-rb-label">Symbol</span>
        </DropButton>
      </RibbonGroup>
    </>
  );
}

const GRID_SIZE = 8;

/** Word's table grid: hover to size it, click to insert. */
function TableGridPicker({
  onPick,
}: {
  onPick: (rows: number, cols: number) => void;
}) {
  const [hover, setHover] = useState({ rows: 1, cols: 1 });

  return (
    <div className="bs-tablegrid">
      <p className="bs-tablegrid-label" aria-live="polite">
        {hover.cols} × {hover.rows} table
      </p>
      <div
        className="bs-tablegrid-cells"
        style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
          const rows = Math.floor(index / GRID_SIZE) + 1;
          const cols = (index % GRID_SIZE) + 1;
          const lit = rows <= hover.rows && cols <= hover.cols;
          return (
            <button
              key={index}
              type="button"
              className={`bs-tablegrid-cell${lit ? " is-on" : ""}`}
              aria-label={`${cols} by ${rows} table`}
              onMouseEnter={() => setHover({ rows, cols })}
              onFocus={() => setHover({ rows, cols })}
              onClick={() => onPick(rows, cols)}
            />
          );
        })}
      </div>
    </div>
  );
}

function PictureForm({
  onInsert,
  onCancel,
}: {
  onInsert: (src: string, alt: string) => void;
  onCancel: () => void;
}) {
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valid = /^https?:\/\/\S+$/i.test(src.trim());

  // Word's Insert > Pictures > This Device: the picture goes into the
  // document itself, scaled to fit, so it is versioned with the policy.
  const fromDevice = async (file: File) => {
    setReading(true);
    setError(null);
    try {
      const url = await pictureToDataUrl(file);
      onInsert(url, alt.trim() || describeFromFileName(file.name));
    } catch (err) {
      setError(
        err instanceof PictureError
          ? err.message
          : "That picture could not be put in the document.",
      );
      setReading(false);
    }
  };

  return (
    <form
      className="bs-rform"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onInsert(src.trim(), alt.trim());
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept={PICTURE_TYPES.join(",")}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void fromDevice(file);
        }}
      />
      <button
        type="button"
        className="bs-btn bs-btn--sm bs-btn-secondary bs-rform-device"
        disabled={reading}
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={14} strokeWidth={1.75} aria-hidden="true" />
        {reading ? "Putting it in…" : "From this device…"}
      </button>
      <p className="bs-rform-note">
        Or paste a picture, or drag one onto the page. It is kept inside the
        policy, so it reads the same in every version.
      </p>
      {error ? (
        <p className="bs-rform-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="bs-rform-or" aria-hidden="true">
        <span>or from the web</span>
      </div>

      <label className="bs-rform-field">
        <span>Picture address</span>
        <input
          type="url"
          value={src}
          placeholder="https://"
          onChange={(event) => setSrc(event.target.value)}
        />
      </label>
      <label className="bs-rform-field">
        <span>Description, for screen readers</span>
        <input
          type="text"
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
        />
      </label>
      <div className="bs-rform-actions">
        <button
          type="button"
          className="bs-btn bs-btn--sm bs-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="bs-btn bs-btn--sm bs-btn-primary"
          disabled={!valid}
        >
          Insert
        </button>
      </div>
    </form>
  );
}

export function LinkForm({
  editor,
  onDone,
}: {
  editor: Editor;
  onDone: () => void;
}) {
  const existing = editor.getAttributes("link").href as string | undefined;
  const [href, setHref] = useState(existing ?? "");
  const empty = editor.state.selection.empty && !existing;
  const [text, setText] = useState("");

  const apply = () => {
    const url = href.trim();
    if (url === "") return;
    const chain = editor.chain().focus();
    if (empty) {
      const label = text.trim() || url;
      chain
        .insertContent({
          type: "text",
          text: label,
          marks: [{ type: "link", attrs: { href: url } }],
        })
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href: url }).run();
    }
    onDone();
  };

  return (
    <form
      className="bs-rform"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      {empty ? (
        <label className="bs-rform-field">
          <span>Text to display</span>
          <input
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      ) : null}
      <label className="bs-rform-field">
        <span>Address</span>
        <input
          type="text"
          value={href}
          placeholder="https://"
          onChange={(event) => setHref(event.target.value)}
        />
      </label>
      <div className="bs-rform-actions">
        {existing ? (
          <button
            type="button"
            className="bs-btn bs-btn--sm bs-btn-secondary"
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              onDone();
            }}
          >
            Remove link
          </button>
        ) : null}
        <button
          type="submit"
          className="bs-btn bs-btn--sm bs-btn-primary"
          disabled={href.trim() === ""}
        >
          {existing ? "Update" : "Insert"}
        </button>
      </div>
    </form>
  );
}

/* ─── View ──────────────────────────────────────────────────────────────── */

function ViewTab({
  view,
  zoom,
  onViewChange,
  onPrint,
  onShortcuts,
  outline,
}: {
  view: ViewSettings;
  zoom: number;
  onViewChange: (next: ViewSettings) => void;
  onPrint: () => void;
  onShortcuts?: () => void;
  outline?: { shown: boolean; onToggle: () => void };
}) {
  const zoomTo = (next: number) =>
    onViewChange({ ...view, zoom: clampZoom(next) });

  return (
    <>
      <RibbonGroup label="Views">
        <RibbonButton
          icon={FileText}
          label="Print layout"
          large
          active={view.layout === "print"}
          onClick={() => onViewChange({ ...view, layout: "print" })}
        />
        <RibbonButton
          icon={Columns3}
          label="Web layout"
          large
          active={view.layout === "web"}
          onClick={() => onViewChange({ ...view, layout: "web" })}
        />
      </RibbonGroup>

      {outline ? (
        <RibbonGroup label="Show">
          <RibbonButton
            icon={ListTree}
            label="Outline"
            large
            active={outline.shown}
            onClick={outline.onToggle}
          />
        </RibbonGroup>
      ) : null}

      <RibbonGroup label="Zoom">
        <RibbonButton
          icon={ZoomOut}
          label="Zoom out"
          large
          disabled={zoom <= 50}
          onClick={() => zoomTo(zoom - ZOOM_STEP)}
        />
        <RibbonButton
          icon={SquareSplitHorizontal}
          label="100%"
          large
          active={view.zoom === 100}
          onClick={() => zoomTo(100)}
        />
        <RibbonButton
          icon={MoveHorizontal}
          label="Page width"
          large
          active={view.zoom === "page-width"}
          onClick={() => onViewChange({ ...view, zoom: "page-width" })}
        />
        <RibbonButton
          icon={ZoomIn}
          label="Zoom in"
          large
          disabled={zoom >= 200}
          onClick={() => zoomTo(zoom + ZOOM_STEP)}
        />
      </RibbonGroup>

      <RibbonGroup label="Print">
        <RibbonButton
          icon={Printer}
          label="Print"
          shortcut="Ctrl+P"
          large
          onClick={onPrint}
        />
      </RibbonGroup>

      {onShortcuts ? (
        <RibbonGroup label="Help">
          <RibbonButton
            icon={Keyboard}
            label="Keyboard shortcuts"
            shortcut="Ctrl+/"
            large
            onClick={onShortcuts}
          />
        </RibbonGroup>
      ) : null}
    </>
  );
}

/* ─── Table (contextual) ────────────────────────────────────────────────── */

function TableTab({ editor, format }: { editor: Editor; format: FormatState }) {
  const chain = () => editor.chain().focus();

  return (
    <>
      <RibbonGroup label="Rows & columns">
        <div className="bs-rstack">
          <RibbonButton
            icon={Rows3}
            label="Insert row above"
            showLabel
            onClick={() => chain().addRowBefore().run()}
          />
          <RibbonButton
            icon={Rows3}
            label="Insert row below"
            showLabel
            onClick={() => chain().addRowAfter().run()}
          />
        </div>
        <div className="bs-rstack">
          <RibbonButton
            icon={Columns3}
            label="Insert column left"
            showLabel
            onClick={() => chain().addColumnBefore().run()}
          />
          <RibbonButton
            icon={Columns3}
            label="Insert column right"
            showLabel
            onClick={() => chain().addColumnAfter().run()}
          />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Merge">
        <div className="bs-rstack">
          <RibbonButton
            icon={TableCellsMerge}
            label="Merge cells"
            showLabel
            disabled={!format.canMergeCells}
            onClick={() => chain().mergeCells().run()}
          />
          <RibbonButton
            icon={TableCellsSplit}
            label="Split cell"
            showLabel
            disabled={!format.canSplitCell}
            onClick={() => chain().splitCell().run()}
          />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Header">
        <RibbonButton
          icon={TableIcon}
          label="Header row"
          large
          onClick={() => chain().toggleHeaderRow().run()}
        />
      </RibbonGroup>

      {/* Word's Table Design > Shading: the cells chosen, or the one the
          cursor is in. */}
      <RibbonGroup label="Shading">
        <ColorDrop
          label="Shading"
          icon={PaintBucket}
          current={format.cellShading}
          colors={SHADING_COLORS}
          noneLabel="No color"
          onPick={(color) =>
            chain().setCellAttribute("background", color).run()
          }
        />
      </RibbonGroup>

      <RibbonGroup label="Delete">
        <div className="bs-rstack">
          <RibbonButton
            icon={Trash2}
            label="Delete row"
            showLabel
            onClick={() => chain().deleteRow().run()}
          />
          <RibbonButton
            icon={Trash2}
            label="Delete column"
            showLabel
            onClick={() => chain().deleteColumn().run()}
          />
          <RibbonButton
            icon={Trash2}
            label="Delete table"
            showLabel
            onClick={() => chain().deleteTable().run()}
          />
        </div>
      </RibbonGroup>
    </>
  );
}

/* ─── Picture (contextual) ──────────────────────────────────────────────── */

/** The text's width on a Letter page with one-inch margins, at 96 dpi. */
export const TEXT_WIDTH_PX = 6.5 * 96;

/**
 * Word's Size group, in the words a policy author uses: a quarter, a half,
 * three quarters or the whole width of the text. Dragging a corner sets any
 * width in between.
 */
export const PICTURE_SIZES = [
  { label: "Small", width: Math.round(TEXT_WIDTH_PX / 4) },
  { label: "Medium", width: Math.round(TEXT_WIDTH_PX / 2) },
  { label: "Large", width: Math.round((TEXT_WIDTH_PX * 3) / 4) },
  { label: "Full width", width: TEXT_WIDTH_PX },
] as const;

const PICTURE_ALIGNS = [
  { align: "left", label: "Align left", icon: AlignLeft },
  { align: "center", label: "Center", icon: AlignCenter },
  { align: "right", label: "Align right", icon: AlignRight },
] as const;

function PictureTab({
  editor,
  format,
}: {
  editor: Editor;
  format: FormatState;
}) {
  /** Change the selected picture, and keep it selected so this tab stays. */
  const setPicture = (attrs: Record<string, unknown>) => {
    const at = editor.state.selection.from;
    editor
      .chain()
      .focus()
      .updateAttributes("image", attrs)
      .setNodeSelection(at)
      .run();
  };

  return (
    <>
      <RibbonGroup label="Size">
        <div className="bs-rstack">
          {PICTURE_SIZES.slice(0, 2).map((size) => (
            <RibbonButton
              key={size.label}
              icon={Scaling}
              label={size.label}
              showLabel
              active={format.pictureWidth === size.width}
              onClick={() => setPicture({ width: size.width, height: null })}
            />
          ))}
        </div>
        <div className="bs-rstack">
          {PICTURE_SIZES.slice(2).map((size) => (
            <RibbonButton
              key={size.label}
              icon={Scaling}
              label={size.label}
              showLabel
              active={format.pictureWidth === size.width}
              onClick={() => setPicture({ width: size.width, height: null })}
            />
          ))}
        </div>
        <RibbonButton
          icon={RotateCcw}
          label="Original size"
          large
          active={format.pictureWidth === null}
          onClick={() => setPicture({ width: null, height: null })}
        />
      </RibbonGroup>

      {/* Word's Arrange > Align. A picture sits in its line, so this is its
          paragraph's alignment — the same as Home's, but here beside the
          picture, and the picture stays selected. */}
      <RibbonGroup label="Arrange">
        <div className="bs-rstack">
          {PICTURE_ALIGNS.map((choice) => (
            <RibbonButton
              key={choice.align}
              icon={choice.icon}
              label={choice.label}
              showLabel
              active={format.align === choice.align}
              onClick={() => {
                const at = editor.state.selection.from;
                editor
                  .chain()
                  .focus()
                  .setTextAlign(choice.align)
                  .setNodeSelection(at)
                  .run();
              }}
            />
          ))}
        </div>
      </RibbonGroup>

      <RibbonGroup label="Accessibility">
        <DropButton
          label="Alt text"
          className="bs-rdrop--large"
          role="dialog"
          panelClassName="bs-rpanel--form"
          panel={(close) => (
            <AltTextForm
              alt={format.pictureAlt}
              onSave={(alt) => {
                setPicture({ alt: alt === "" ? null : alt });
                close();
              }}
              onCancel={close}
            />
          )}
        >
          <MessageSquareText size={22} strokeWidth={1.75} aria-hidden="true" />
          <span className="bs-rb-label">Alt text</span>
        </DropButton>
      </RibbonGroup>

      <RibbonGroup label="Delete">
        <RibbonButton
          icon={ImageMinus}
          label="Remove picture"
          large
          onClick={() => editor.chain().focus().deleteSelection().run()}
        />
      </RibbonGroup>
    </>
  );
}

function AltTextForm({
  alt,
  onSave,
  onCancel,
}: {
  alt: string;
  onSave: (alt: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(alt);
  return (
    <form
      className="bs-rform"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text.trim());
      }}
    >
      <label className="bs-rform-field">
        <span>Description, for screen readers</span>
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className="bs-rform-note">
        Say what the picture shows and why it is here, in a sentence. Leave it
        empty only for a picture that is decoration.
      </p>
      <div className="bs-rform-actions">
        <button
          type="button"
          className="bs-btn bs-btn--sm bs-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="submit" className="bs-btn bs-btn--sm bs-btn-primary">
          Save
        </button>
      </div>
    </form>
  );
}
