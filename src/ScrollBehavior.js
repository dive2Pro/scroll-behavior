/* eslint-disable no-underscore-dangle */

import off from 'dom-helpers/events/off';
import on from 'dom-helpers/events/on';
import scrollLeft from 'dom-helpers/query/scrollLeft';
import scrollTop from 'dom-helpers/query/scrollTop';
import requestAnimationFrame from 'dom-helpers/util/requestAnimationFrame';
import { readState, saveState } from 'history/lib/DOMStateStorage';

// Try at most this many times to scroll, to avoid getting stuck.
const MAX_SCROLL_ATTEMPTS = 2;

export default class ScrollBehavior {
  constructor(history, getCurrentLocation) {
    this._getCurrentLocation = getCurrentLocation;

    // This helps avoid some jankiness in fighting against the browser's
    // default scroll behavior on `POP` transitions.
    /* istanbul ignore if: not supported by any browsers on Travis */
    if ('scrollRestoration' in window.history) {
      this._oldScrollRestoration = window.history.scrollRestoration;
      window.history.scrollRestoration = 'manual';
    } else {
      this._oldScrollRestoration = null;
    }

    this._savePositionHandle = null;
    this._checkScrollHandle = null;
    this._scrollTarget = null;
    this._numScrollAttempts = 0;

    // We have to listen to each scroll update rather than to just location
    // updates, because some browsers will update scroll position before
    // emitting the location change.
    on(window, 'scroll', this._onScroll);

    this._unlistenBefore = history.listenBefore(() => {
      if (this._savePositionHandle !== null) {
        requestAnimationFrame.cancel(this._savePositionHandle);
        this._savePositionHandle = null;
      }
    });
  }

  stop() {
    /* istanbul ignore if: not supported by any browsers on Travis */
    if (this._oldScrollRestoration) {
      window.history.scrollRestoration = this._oldScrollRestoration;
    }

    off(window, 'scroll', this._onScroll);
    this._cancelCheckScroll();

    this._unlistenBefore();
  }

  updateScroll(scrollPosition) {
    // Whatever we were doing before isn't relevant any more.
    this._cancelCheckScroll();

    if (scrollPosition && !Array.isArray(scrollPosition)) {
      this._scrollTarget = this._getScrollPosition();
    } else {
      this._scrollTarget = scrollPosition;
    }

    // Check the scroll position to see if we even need to scroll.
    this._onScroll();

    if (!this._scrollTarget) {
      return;
    }

    this._numScrollAttempts = 0;
    this._checkScrollPosition();
  }

  _onScroll = () => {
    // It's possible that this scroll operation was triggered by what will be a
    // `POP` transition. Instead of updating the saved location immediately, we
    // have to enqueue the update, then potentially cancel it if we observe a
    // location update.
    if (this._savePositionHandle === null) {
      this._savePositionHandle = requestAnimationFrame(this._savePosition);
    }

    if (this._scrollTarget) {
      const [xTarget, yTarget] = this._scrollTarget;
      const x = scrollLeft(window);
      const y = scrollTop(window);

      if (x === xTarget && y === yTarget) {
        this._scrollTarget = null;
        this._cancelCheckScroll();
      }
    }
  };

  _savePosition = () => {
    this._savePositionHandle = null;

    const currentKey = this._getCurrentKey();
    const scrollPosition = [scrollLeft(window), scrollTop(window)];

    // We have to directly update `DOMStateStorage`, because actually updating
    // the location could cause e.g. React Router to re-render the entire page,
    // which would lead to observably bad scroll performance.
    const state = readState(currentKey);
    saveState(currentKey, { ...state, scrollPosition });
  };

  _getCurrentKey() {
    return this._getCurrentLocation().key;
  }

  _cancelCheckScroll() {
    if (this._checkScrollHandle !== null) {
      requestAnimationFrame.cancel(this._checkScrollHandle);
      this._checkScrollHandle = null;
    }
  }

  _getScrollPosition() {
    const state = readState(this._getCurrentKey());
    if (!state || !state.scrollPosition) {
      return [0, 0];
    }

    return state.scrollPosition;
  }

  _checkScrollPosition = () => {
    this._checkScrollHandle = null;

    // We can only get here if scrollTarget is set. Every code path that unsets
    // scroll target also cancels the handle to avoid calling this handler.
    // Still, check anyway just in case.
    /* istanbul ignore if: paranoid guard */
    if (!this._scrollTarget) {
      return;
    }

    const [x, y] = this._scrollTarget;
    window.scrollTo(x, y);

    ++this._numScrollAttempts;

    /* istanbul ignore if: paranoid guard */
    if (this._numScrollAttempts >= MAX_SCROLL_ATTEMPTS) {
      this._scrollTarget = null;
      return;
    }

    this._checkScrollHandle = requestAnimationFrame(this._checkScrollPosition);
  };
}
