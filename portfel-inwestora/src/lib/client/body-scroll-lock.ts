type BodyScrollLockState = {
  count: number;
  previousBodyOverflow: string;
  previousBodyPaddingRight: string;
  previousRootOverflow: string;
};

const activeLocks = new WeakMap<Document, BodyScrollLockState>();

/**
 * Locks page scrolling while an overlay is open without moving the layout.
 * A shared, reference-counted lock is important because overlays can open a
 * second picker/modal; each consumer must not restore overflow while another
 * overlay is still active.
 */
export function acquireBodyScrollLock(documentRef: Document): () => void {
  const existing = activeLocks.get(documentRef);
  if (existing) {
    existing.count += 1;
    return createRelease(documentRef, existing);
  }

  const body = documentRef.body;
  const root = documentRef.documentElement;
  const view = documentRef.defaultView;
  const state: BodyScrollLockState = {
    count: 1,
    previousBodyOverflow: body.style.overflow,
    previousBodyPaddingRight: body.style.paddingRight,
    previousRootOverflow: root.style.overflow,
  };

  // Hiding a classic viewport scrollbar widens the layout viewport. Reserve
  // the same space on body so fixed navigation and page content do not shift.
  const scrollbarWidth = Math.max(0, (view?.innerWidth ?? 0) - root.clientWidth);
  const computedPaddingRight = Number.parseFloat(view?.getComputedStyle(body).paddingRight ?? "0") || 0;

  activeLocks.set(documentRef, state);
  body.style.overflow = "hidden";
  root.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
  }

  return createRelease(documentRef, state);
}

function createRelease(documentRef: Document, state: BodyScrollLockState): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeLocks.get(documentRef) !== state) return;

    state.count -= 1;
    if (state.count > 0) return;

    documentRef.body.style.overflow = state.previousBodyOverflow;
    documentRef.body.style.paddingRight = state.previousBodyPaddingRight;
    documentRef.documentElement.style.overflow = state.previousRootOverflow;
    activeLocks.delete(documentRef);
  };
}
