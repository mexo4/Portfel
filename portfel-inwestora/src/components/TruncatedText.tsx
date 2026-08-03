"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";

type TruncatedTextProps = {
  text: string;
  as?: "span" | "p" | "div";
  className?: string;
  children?: ReactNode;
};

const TOOLTIP_MARGIN = 12;
const TOOLTIP_MAX_WIDTH = 420;

export default function TruncatedText({
  text,
  as = "span",
  className = "",
  children,
}: TruncatedTextProps) {
  const tooltipId = useId();
  const elementRef = useRef<HTMLElement | null>(null);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
    maxWidth: number;
  } | null>(null);

  const updateTooltipPosition = () => {
    const element = elementRef.current;

    if (!element || element.scrollWidth <= element.clientWidth + 1) {
      setTooltipPosition(null);
      return;
    }

    const rect = element.getBoundingClientRect();
    const maxWidth = Math.min(TOOLTIP_MAX_WIDTH, window.innerWidth - TOOLTIP_MARGIN * 2);
    const left = Math.min(
      Math.max(TOOLTIP_MARGIN, rect.left),
      Math.max(TOOLTIP_MARGIN, window.innerWidth - maxWidth - TOOLTIP_MARGIN)
    );
    const top = Math.min(rect.bottom + 8, window.innerHeight - TOOLTIP_MARGIN);

    setTooltipPosition({ left, top, maxWidth });
  };

  const showTooltip = () => {
    updateTooltipPosition();
    setIsTooltipVisible(true);
  };

  const hideTooltip = () => {
    setIsTooltipVisible(false);
  };

  useEffect(() => {
    if (!isTooltipVisible) {
      return;
    }

    const handleViewportChange = () => updateTooltipPosition();

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isTooltipVisible]);

  const Component = as as ElementType;
  const combinedClassName = ["truncate-text", className].filter(Boolean).join(" ");

  return (
    <>
      <Component
        ref={elementRef}
        className={combinedClassName}
        title={text}
        tabIndex={0}
        aria-label={text}
        aria-describedby={isTooltipVisible && tooltipPosition ? tooltipId : undefined}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        onClick={showTooltip}
        onTouchStart={showTooltip}
      >
        {children ?? text}
      </Component>

      {typeof document !== "undefined" && isTooltipVisible && tooltipPosition
        ? createPortal(
            <span
              id={tooltipId}
              className="truncate-tooltip"
              role="tooltip"
              style={{
                left: tooltipPosition.left,
                top: tooltipPosition.top,
                maxWidth: tooltipPosition.maxWidth,
              }}
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </>
  );
}
