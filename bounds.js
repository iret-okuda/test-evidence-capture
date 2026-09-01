(function exposeBounds(global) {
  "use strict";

  function calculateBounds(elements, viewportWidth, viewportHeight, padding = 8) {
    const rects = Array.from(elements, (element) => element.getBoundingClientRect())
      .filter(isUsableRect);

    if (rects.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) {
      return null;
    }

    const left = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - padding);
    const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - padding);
    const right = Math.min(
      viewportWidth,
      Math.max(...rects.map((rect) => rect.right)) + padding,
    );
    const bottom = Math.min(
      viewportHeight,
      Math.max(...rects.map((rect) => rect.bottom)) + padding,
    );

    if (right <= left || bottom <= top) {
      return null;
    }

    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function calculateCrop(bounds, imageWidth, imageHeight, viewportWidth, viewportHeight) {
    if (
      !bounds ||
      imageWidth <= 0 ||
      imageHeight <= 0 ||
      viewportWidth <= 0 ||
      viewportHeight <= 0
    ) {
      return null;
    }

    // The captured bitmap is authoritative. This handles Retina displays and
    // also avoids assuming that devicePixelRatio equals Chrome's capture scale.
    const scaleX = imageWidth / viewportWidth;
    const scaleY = imageHeight / viewportHeight;
    const left = clamp(Math.floor(bounds.left * scaleX), 0, imageWidth);
    const top = clamp(Math.floor(bounds.top * scaleY), 0, imageHeight);
    const right = clamp(Math.ceil(bounds.right * scaleX), 0, imageWidth);
    const bottom = clamp(Math.ceil(bounds.bottom * scaleY), 0, imageHeight);

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
      scaleX,
      scaleY,
    };
  }

  function calculateScrollPositions(start, end, viewportSize, maximumScroll, currentScroll) {
    if (
      ![start, end, viewportSize, maximumScroll, currentScroll].every(Number.isFinite) ||
      end <= start ||
      viewportSize <= 0 ||
      maximumScroll < 0
    ) {
      return [];
    }
    if (start >= currentScroll && end <= currentScroll + viewportSize) {
      return [currentScroll];
    }

    const positions = [clamp(Math.floor(start), 0, maximumScroll)];
    while (positions.at(-1) + viewportSize < end) {
      const next = Math.min(maximumScroll, positions.at(-1) + viewportSize);
      if (next <= positions.at(-1)) {
        break;
      }
      positions.push(next);
    }
    return positions;
  }

  function calculatePseudoElementRect(containerRect, style) {
    const containingWidth = containerRect.width;
    const containingHeight = containerRect.height;
    const width = calculateBorderBoxSize(style, "width", containingWidth);
    const height = calculateBorderBoxSize(style, "height", containingHeight);
    if (width === null || height === null || width <= 0 || height <= 0) {
      return null;
    }

    const leftInset = parseLength(style.left, containingWidth);
    const rightInset = parseLength(style.right, containingWidth);
    const topInset = parseLength(style.top, containingHeight);
    const bottomInset = parseLength(style.bottom, containingHeight);
    const marginLeft = parseLength(style.marginLeft, containingWidth) || 0;
    const marginRight = parseLength(style.marginRight, containingWidth) || 0;
    const marginTop = parseLength(style.marginTop, containingHeight) || 0;
    const marginBottom = parseLength(style.marginBottom, containingHeight) || 0;
    const containingLeft = containerRect.left;
    const containingTop = containerRect.top;

    let left;
    if (leftInset !== null) {
      left = containingLeft + leftInset + marginLeft;
    } else if (rightInset !== null) {
      left = containingLeft + containingWidth - rightInset - width - marginRight;
    } else {
      return null;
    }

    let top;
    if (topInset !== null) {
      top = containingTop + topInset + marginTop;
    } else if (bottomInset !== null) {
      top = containingTop + containingHeight - bottomInset - height - marginBottom;
    } else {
      return null;
    }

    const matrix = parseTransform(style.transform);
    const [originXValue = "50%", originYValue = "50%"] = String(
      style.transformOrigin || "50% 50%",
    ).split(/\s+/);
    const originX = parseLength(originXValue, width) ?? width / 2;
    const originY = parseLength(originYValue, height) ?? height / 2;
    const corners = [
      transformPoint(0, 0, matrix, originX, originY),
      transformPoint(width, 0, matrix, originX, originY),
      transformPoint(0, height, matrix, originX, originY),
      transformPoint(width, height, matrix, originX, originY),
    ];
    const transformedLeft = left + Math.min(...corners.map((point) => point.x));
    const transformedTop = top + Math.min(...corners.map((point) => point.y));
    const transformedRight = left + Math.max(...corners.map((point) => point.x));
    const transformedBottom = top + Math.max(...corners.map((point) => point.y));

    return {
      left: transformedLeft,
      top: transformedTop,
      right: transformedRight,
      bottom: transformedBottom,
      width: transformedRight - transformedLeft,
      height: transformedBottom - transformedTop,
    };
  }

  function calculateBorderBoxSize(style, property, relativeSize) {
    const size = parseLength(style[property], relativeSize);
    if (size === null) {
      return null;
    }
    if (style.boxSizing === "border-box") {
      return size;
    }

    const horizontal = property === "width";
    const start = horizontal ? "Left" : "Top";
    const end = horizontal ? "Right" : "Bottom";
    return (
      size +
      (parseLength(style[`padding${start}`], relativeSize) || 0) +
      (parseLength(style[`padding${end}`], relativeSize) || 0) +
      (parseLength(style[`border${start}Width`], relativeSize) || 0) +
      (parseLength(style[`border${end}Width`], relativeSize) || 0)
    );
  }

  function parseLength(value, relativeSize) {
    const text = String(value ?? "").trim();
    if (!text || text === "auto" || text === "none" || text === "normal") {
      return null;
    }
    if (text.endsWith("%")) {
      const percentage = Number.parseFloat(text);
      return Number.isFinite(percentage) ? (percentage / 100) * relativeSize : null;
    }
    if (text.startsWith("calc(") && !text.includes("var(")) {
      const terms = [...text.matchAll(/([+-]?)\s*(\d*\.?\d+)\s*(%|px)/g)];
      if (terms.length > 0) {
        return terms.reduce((sum, [, sign, rawNumber, unit]) => {
          const number = Number(rawNumber) * (sign === "-" ? -1 : 1);
          return sum + (unit === "%" ? (number / 100) * relativeSize : number);
        }, 0);
      }
    }
    const number = Number.parseFloat(text);
    return Number.isFinite(number) ? number : null;
  }

  function parseTransform(value) {
    const text = String(value || "none");
    if (text === "none") {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }

    const contents = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
    const values = contents.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number) || [];
    if (text.startsWith("matrix3d(") && values.length === 16) {
      return { a: values[0], b: values[1], c: values[4], d: values[5], e: values[12], f: values[13] };
    }
    if (text.startsWith("matrix(") && values.length === 6) {
      return { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };
    }
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }

  function transformPoint(x, y, matrix, originX, originY) {
    const shiftedX = x - originX;
    const shiftedY = y - originY;
    return {
      x: matrix.a * shiftedX + matrix.c * shiftedY + matrix.e + originX,
      y: matrix.b * shiftedX + matrix.d * shiftedY + matrix.f + originY,
    };
  }

  function isUsableRect(rect) {
    return (
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.right) &&
      Number.isFinite(rect.bottom) &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  global.TestEvidenceBounds = Object.freeze({
    calculateBounds,
    calculateCrop,
    calculateScrollPositions,
    calculatePseudoElementRect,
  });
})(globalThis);
