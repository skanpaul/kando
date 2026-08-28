//////////////////////////////////////////////////////////////////////////////////////////
//   _  _ ____ _  _ ___  ____                                                           //
//   |_/  |__| |\ | |  \ |  |    This file belongs to Kando, the cross-platform         //
//   | \_ |  | | \| |__/ |__|    pie menu. Read more on github.com/kando-menu/kando     //
//                                                                                      //
//////////////////////////////////////////////////////////////////////////////////////////

// SPDX-FileCopyrightText: Simon Schneegans <code@simonschneegans.de>
// SPDX-License-Identifier: MIT

import React from 'react';

import * as classes from './Sidebar.module.scss';

type Props = {
  /** Position of the sidebar, either 'left' or 'right'. */
  readonly position: 'left' | 'right';

  /** The direction of the main axis. */
  readonly mainDirection: 'row' | 'column';

  /** Content to display in the main area of the sidebar. */
  readonly children: React.ReactNode;
};

/**
 * A customizable sidebar component. It features a resizer that allows the user to change
 * the width of the sidebar. The position of the resizer depends on the position of the
 * sidebar: If the sidebar is on the left, the resizer is on the right and vice versa.
 *
 * @param props - The properties for the sidebar component.
 * @returns A sidebar element.
 */
export default function Sidebar(props: Props) {
  const resizer = React.useRef<HTMLDivElement>(null);
  const sidebar = React.useRef<HTMLDivElement>(null);

  // Personal build: remember the sidebar's width across restarts, per side, in
  // localStorage. Kando upstream does not persist this.
  const widthStorageKey = 'kando-sidebar-width-' + props.position;

  React.useEffect(() => {
    // Function to handle the resizing of the sidebar.
    const resize = (e: MouseEvent) => {
      if (props.position === 'left') {
        sidebar.current.style.width = e.clientX + 'px';
      } else {
        sidebar.current.style.width = window.innerWidth - e.clientX + 'px';
      }
    };

    // Function to stop the resizing process. This is called when the user releases the
    // mouse button.
    const stopResize = () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResize);
      document.body.style.cursor = '';

      try {
        const width = sidebar.current.style.width;
        if (width) {
          localStorage.setItem(widthStorageKey, width);
        }
      } catch {
        // Ignore storage errors (e.g. private browsing contexts).
      }
    };

    // Add event listeners for the resizer. This is done in a useEffect hook to ensure
    // that the DOM elements are available when the script is executed.
    if (resizer && sidebar) {
      resizer.current.addEventListener('mousedown', function () {
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
        document.body.style.cursor = 'col-resize';
      });
    }

    // Restore a previously remembered width, clamped so that a width remembered on a
    // large window stays usable on a smaller one. 250px matches the sheet's min-width.
    try {
      const stored = localStorage.getItem(widthStorageKey);
      const width = stored ? parseFloat(stored) : NaN;
      if (stored && isFinite(width) && width > 0) {
        sidebar.current.style.width =
          Math.max(250, Math.min(width, 0.45 * window.innerWidth)) + 'px';
      }
    } catch {
      // Ignore storage errors (e.g. private browsing contexts).
    }
  }, []);

  const positionClass = props.position === 'left' ? classes.left : classes.right;
  const directionClass = props.mainDirection === 'row' ? classes.row : classes.column;
  const resizerClass = classes.resizer + ' ' + positionClass;

  return (
    <>
      {/* Render the resizer on the left if the sidebar is on the right. */}
      {props.position === 'right' && <div ref={resizer} className={resizerClass} />}
      <div ref={sidebar} className={classes.sidebar + ' ' + directionClass}>
        {props.children}
      </div>
      {/* Render the resizer on the right if the sidebar is on the left. */}
      {props.position === 'left' && <div ref={resizer} className={resizerClass} />}
    </>
  );
}
