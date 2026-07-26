import { Direction } from "../api/types";

// app.js の Z = 1.1618 (行送り係数)
export const LINE_SPACING_FACTOR = 1.1618;

export const DEFAULT_FONT_FAMILY = "serif";
export const DEFAULT_FONT_SIZE = 32;
export const DEFAULT_LINE_HEIGHT = 0;
export const DEFAULT_COLOR = "#000000";
export const DEFAULT_DIRECTION = Direction.Horizon;

export interface Size {
  width: number;
  height: number;
}
