import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  READER_FONTS,
  READER_FONT_SCALE_STEP,
  READER_MAX_FONT_SCALE,
  READER_MIN_FONT_SCALE,
  READER_SPACINGS,
  type ReaderFontId,
  type ReaderSpacingId,
  type ReaderTone,
} from "../lib/storage";

export const ReaderToneToggle = ({
  tone,
  onChange,
}: {
  tone: ReaderTone;
  onChange: (tone: ReaderTone) => void;
}) => (
  <div aria-label="Reader tone" className="view-toggle" role="group">
    {(["paper", "sepia", "night"] as const).map((option) => (
      <Button
        aria-pressed={tone === option}
        className={cn("view-toggle-button", tone === option && "active")}
        key={option}
        onClick={() => onChange(option)}
        size="sm"
        type="button"
        variant="ghost"
      >
        {option === "paper" ? "Paper" : option === "sepia" ? "Sepia" : "Night"}
      </Button>
    ))}
  </div>
);

export const ReaderFontSizeToggle = ({
  fontScale,
  onAdjust,
}: {
  fontScale: number;
  onAdjust: (delta: number) => void;
}) => (
  <div aria-label="Type size" className="view-toggle" role="group">
    <Button
      aria-label="Decrease type size"
      className="view-toggle-button"
      disabled={fontScale <= READER_MIN_FONT_SCALE}
      onClick={() => onAdjust(-READER_FONT_SCALE_STEP)}
      size="sm"
      type="button"
      variant="ghost"
    >
      A-
    </Button>
    <div className="stat-chip reader-type-scale">
      <strong>{Math.round(fontScale * 100)}%</strong>
    </div>
    <Button
      aria-label="Increase type size"
      className="view-toggle-button"
      disabled={fontScale >= READER_MAX_FONT_SCALE}
      onClick={() => onAdjust(READER_FONT_SCALE_STEP)}
      size="sm"
      type="button"
      variant="ghost"
    >
      A+
    </Button>
  </div>
);

export const ReaderFontSelect = ({
  fontFamily,
  onChange,
  tone,
}: {
  fontFamily: ReaderFontId;
  onChange: (font: ReaderFontId) => void;
  tone: ReaderTone;
}) => (
  <Select onValueChange={(value) => onChange(value as ReaderFontId)} value={fontFamily}>
    <SelectTrigger aria-label="Reading font" className="reader-font-trigger">
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="reader-tone-scope" data-reader-tone={tone}>
      {READER_FONTS.map((font) => (
        <SelectItem key={font.id} value={font.id}>
          <span style={{ fontFamily: font.stack }}>{font.label}</span>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const ReaderSpacingToggle = ({
  spacing,
  onChange,
}: {
  spacing: ReaderSpacingId;
  onChange: (spacing: ReaderSpacingId) => void;
}) => (
  <div aria-label="Line spacing" className="view-toggle" role="group">
    {READER_SPACINGS.map((option) => (
      <Button
        aria-pressed={spacing === option.id}
        className={cn("view-toggle-button", spacing === option.id && "active")}
        key={option.id}
        onClick={() => onChange(option.id)}
        size="sm"
        type="button"
        variant="ghost"
      >
        {option.label}
      </Button>
    ))}
  </div>
);
