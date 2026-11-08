/**
 * The app's way in to the icon vocabulary, which lives in
 * packages/ui-tokens/icons.tsx so the editor can draw from it too. Named
 * AppIcon rather than Icon because several components already use `Icon`
 * as a local variable name for a dynamically chosen glyph
 * (`const Icon = TONE_ICONS[tone]`) — pass that variable as the `icon` prop.
 */
export {
  AppIcon,
  ICON,
  type AppIconSize,
  type IconGlyph,
  type IconName,
} from "../../../packages/ui-tokens/icons";
