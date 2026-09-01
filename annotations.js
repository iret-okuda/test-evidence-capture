(function exposeAnnotations(global) {
  "use strict";

  const FRAME_PADDING_CSS_PX = 4;
  const FRAME_BORDER_CSS_PX = 3;
  const FRAME_COLOR = "#ff3b30";

  function calculateFrameRect(
    rect,
    viewportWidth,
    viewportHeight,
    padding = FRAME_PADDING_CSS_PX,
    borderWidth = FRAME_BORDER_CSS_PX,
  ) {
    if (
      !rect ||
      ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      viewportWidth <= 0 ||
      viewportHeight <= 0
    ) {
      return null;
    }

    // CSS borders are drawn inside their border box. Expanding by both the
    // requested gap and border width keeps the inner border edge 4px away.
    const expansion = Math.max(0, padding) + Math.max(0, borderWidth);
    const left = clamp(rect.left - expansion, 0, viewportWidth);
    const top = clamp(rect.top - expansion, 0, viewportHeight);
    const right = clamp(rect.right + expansion, 0, viewportWidth);
    const bottom = clamp(rect.bottom + expansion, 0, viewportHeight);
    if (right <= left || bottom <= top) {
      return null;
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function mapFrameToCrop(frameRect, crop, borderWidth = FRAME_BORDER_CSS_PX) {
    if (
      !frameRect ||
      !crop ||
      ![crop.left, crop.top, crop.width, crop.height, crop.scaleX, crop.scaleY].every(
        Number.isFinite,
      ) ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.scaleX <= 0 ||
      crop.scaleY <= 0
    ) {
      return null;
    }

    const left = clamp(frameRect.left * crop.scaleX - crop.left, 0, crop.width);
    const top = clamp(frameRect.top * crop.scaleY - crop.top, 0, crop.height);
    const right = clamp(frameRect.right * crop.scaleX - crop.left, 0, crop.width);
    const bottom = clamp(frameRect.bottom * crop.scaleY - crop.top, 0, crop.height);
    if (right <= left || bottom <= top) {
      return null;
    }
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      borderWidthX: Math.max(1, borderWidth * crop.scaleX),
      borderWidthY: Math.max(1, borderWidth * crop.scaleY),
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  global.TestEvidenceAnnotations = Object.freeze({
    FRAME_PADDING_CSS_PX,
    FRAME_BORDER_CSS_PX,
    FRAME_COLOR,
    calculateFrameRect,
    mapFrameToCrop,
  });
})(globalThis);
