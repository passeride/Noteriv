import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { parseSlides, type Slide } from "@noteriv/core/slide-utils";
// Styles: `.slide-*` in packages/ui/styles/app.css.

// ── Types ──

export interface SlideLabels {
  exit: string;
  notes: string;
  overview: string;
  print: string;
  speakerNotes: string;
  overviewTitle: (n: number) => string;
  closeOverview: string;
  separatorHint: string;
}

interface SlidePresentationProps {
  content: string;
  onClose: () => void;
  labels: SlideLabels;
}

// ── Component ──

export function SlidePresentation({ content, onClose, labels }: SlidePresentationProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [slideKey, setSlideKey] = useState(0); // for re-triggering animation
  const overlayRef = useRef<HTMLDivElement>(null);

  const slides = useMemo(() => parseSlides(content), [content]);
  const totalSlides = slides.length;

  // Navigation helpers
  const goToSlide = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, totalSlides - 1));
      if (clamped !== currentIndex) {
        setCurrentIndex(clamped);
        setSlideKey((k) => k + 1);
      }
    },
    [currentIndex, totalSlides]
  );

  const goNext = useCallback(() => {
    goToSlide(currentIndex + 1);
  }, [currentIndex, goToSlide]);

  const goPrev = useCallback(() => {
    goToSlide(currentIndex - 1);
  }, [currentIndex, goToSlide]);

  const goFirst = useCallback(() => {
    goToSlide(0);
  }, [goToSlide]);

  const goLast = useCallback(() => {
    goToSlide(totalSlides - 1);
  }, [goToSlide, totalSlides]);

  // Keyboard navigation. Capture phase on window, and every key handled here stops there: the host closes plugin views
  // on Escape (and the app has its own shortcuts), but Escape with the overview open must only close the overview.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      let handled = true;
      switch (e.key) {
        case "Escape":
          if (showOverview) {
            setShowOverview(false);
          } else {
            onClose();
          }
          e.preventDefault();
          break;
        case "ArrowRight":
        case "ArrowDown":
          if (!showOverview) {
            goNext();
            e.preventDefault();
          }
          break;
        case "ArrowLeft":
        case "ArrowUp":
          if (!showOverview) {
            goPrev();
            e.preventDefault();
          }
          break;
        case " ":
          if (!showOverview) {
            goNext();
            e.preventDefault();
          }
          break;
        case "Home":
          if (!showOverview) {
            goFirst();
            e.preventDefault();
          }
          break;
        case "End":
          if (!showOverview) {
            goLast();
            e.preventDefault();
          }
          break;
        case "n":
        case "N":
          setShowNotes((v) => !v);
          e.preventDefault();
          break;
        case "o":
        case "O":
          setShowOverview((v) => !v);
          e.preventDefault();
          break;
        default:
          handled = false;
      }
      if (handled) e.stopPropagation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [goNext, goPrev, goFirst, goLast, onClose, showOverview]);

  // Print handler
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Current slide
  const currentSlide: Slide | undefined = slides[currentIndex];
  const progress =
    totalSlides > 1 ? ((currentIndex + 1) / totalSlides) * 100 : 100;

  if (!currentSlide) return null;

  return (
    <div className="slide-presentation-overlay" ref={overlayRef}>
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="slide-toolbar">
        <div className="slide-toolbar-group">
          <button className="slide-toolbar-btn" onClick={onClose}>
            {labels.exit}
            <span className="slide-toolbar-shortcut">Esc</span>
          </button>
        </div>
        <div className="slide-toolbar-group">
          <button
            className={`slide-toolbar-btn ${showNotes ? "active" : ""}`}
            onClick={() => setShowNotes((v) => !v)}
          >
            {labels.notes}
            <span className="slide-toolbar-shortcut">N</span>
          </button>
          <button
            className={`slide-toolbar-btn ${showOverview ? "active" : ""}`}
            onClick={() => setShowOverview((v) => !v)}
          >
            {labels.overview}
            <span className="slide-toolbar-shortcut">O</span>
          </button>
          <button className="slide-toolbar-btn" onClick={handlePrint}>
            {labels.print}
          </button>
        </div>
      </div>

      {/* ── Main Stage ──────────────────────────────────────────────── */}
      <div className="slide-stage">
        {/* Navigation zones */}
        <div className="slide-nav-zone slide-nav-zone--left" onClick={goPrev}>
          <div className="slide-nav-arrow">&lsaquo;</div>
        </div>
        <div className="slide-nav-zone slide-nav-zone--right" onClick={goNext}>
          <div className="slide-nav-arrow">&rsaquo;</div>
        </div>

        {/* Slide content */}
        <div className="slide-viewport">
          <div
            className="slide-content-wrapper"
            key={slideKey}
            dangerouslySetInnerHTML={{ __html: currentSlide.html }}
          />
        </div>
      </div>

      {/* ── Slide Counter ───────────────────────────────────────────── */}
      <div className="slide-counter">
        {currentIndex + 1} / {totalSlides}
        {totalSlides <= 1 && ` — ${labels.separatorHint}`}
      </div>

      {/* ── Progress Bar ────────────────────────────────────────────── */}
      <div
        className="slide-progress-bar"
        style={{ width: `${progress}%` }}
      />

      {/* ── Speaker Notes Panel ─────────────────────────────────────── */}
      {showNotes && currentSlide.notes && (
        <div className="slide-notes-panel">
          <div className="slide-notes-label">{labels.speakerNotes}</div>
          <div className="slide-notes-content">{currentSlide.notes}</div>
        </div>
      )}

      {/* ── Overview Mode ───────────────────────────────────────────── */}
      {showOverview && (
        <div className="slide-overview-overlay">
          <div className="slide-overview-header">
            <div className="slide-overview-title">{labels.overviewTitle(totalSlides)}</div>
            <button
              className="slide-overview-close"
              onClick={() => setShowOverview(false)}
            >
              {labels.closeOverview}
              <span className="slide-toolbar-shortcut" style={{ marginLeft: 6 }}>
                O
              </span>
            </button>
          </div>
          <div className="slide-overview-grid">
            {slides.map((slide) => (
              <div
                key={slide.index}
                className={`slide-overview-card ${
                  slide.index === currentIndex ? "active" : ""
                }`}
                onClick={() => {
                  goToSlide(slide.index);
                  setShowOverview(false);
                }}
              >
                <div className="slide-overview-card-number">
                  {slide.index + 1}
                </div>
                <div
                  className="slide-overview-card-content"
                  dangerouslySetInnerHTML={{ __html: slide.html }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Hidden Print Container ──────────────────────────────────── */}
      <div className="slide-print-container">
        {slides.map((slide) => (
          <div key={slide.index} className="slide-print-page">
            <div
              className="slide-content-wrapper"
              dangerouslySetInnerHTML={{ __html: slide.html }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
