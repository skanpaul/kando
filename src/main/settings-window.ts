//////////////////////////////////////////////////////////////////////////////////////////
//   _  _ ____ _  _ ___  ____                                                           //
//   |_/  |__| |\ | |  \ |  |    This file belongs to Kando, the cross-platform         //
//   | \_ |  | | \| |__/ |__|    pie menu. Read more on github.com/kando-menu/kando     //
//                                                                                      //
//////////////////////////////////////////////////////////////////////////////////////////

// SPDX-FileCopyrightText: Simon Schneegans <code@simonschneegans.de>
// SPDX-License-Identifier: MIT

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { app, screen, BrowserWindow, shell, ipcMain, Rectangle } from 'electron';

import { GeneralSettings } from '../common';
import { Settings } from './settings';
import { Backend } from './backends';
import { WindowsBackend } from './backends/windows/backend';

declare const SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const SETTINGS_WINDOW_WEBPACK_ENTRY: string;

// Personal build: remember the settings window's size and position across restarts.
// Kando upstream does not persist this.
const boundsFilePath = () =>
  path.join(app.getPath('userData'), 'settings-window-bounds.json');

/**
 * Reads back the bounds saved by persistWindowBounds() below, if any, clamped onto a
 * display that is actually connected right now. Returns an empty object (letting Electron
 * fall back to the hard-coded defaults) if there is nothing usable to restore.
 */
function loadRestoredBounds(): Partial<Rectangle> {
  try {
    const bounds = JSON.parse(fs.readFileSync(boundsFilePath(), 'utf8'));
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) {
      return {};
    }
    if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
      return { width: bounds.width, height: bounds.height };
    }

    // Keep the window on a display that is actually connected: find the display it
    // overlaps the most, so a window that merely sticks out of one edge is pulled back
    // in rather than losing its remembered position outright.
    const overlap = (a: Rectangle, b: Rectangle) =>
      Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

    let best: Electron.Display | null = null;
    let bestOverlap = 0;
    for (const display of screen.getAllDisplays()) {
      const o = overlap(display.workArea, bounds);
      if (o > bestOverlap) {
        bestOverlap = o;
        best = display;
      }
    }

    // No overlap with any connected display: it has been disconnected. Keep the size
    // and let Electron place the window on the primary display.
    if (!best) {
      return { width: bounds.width, height: bounds.height };
    }

    const area = best.workArea;
    const width = Math.min(bounds.width, area.width);
    const height = Math.min(bounds.height, area.height);
    return {
      x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)),
      y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)),
      width,
      height,
    };
  } catch {
    return {};
  }
}

/** This is window which contains the settings of Kando. */
export class SettingsWindow extends BrowserWindow {
  /** This will resolve once the window has fully loaded. */
  public onWindowLoaded = new Promise<void>((resolve) => {
    ipcMain.on('settings-window.ready', () => {
      resolve();
    });
  });

  constructor(backend: Backend, settings: Settings<GeneralSettings>) {
    // The special 'auto' flavor is only used as an initial default value. We override it
    // with the preferred flavor of the backend.
    if (settings.get('settingsWindowFlavor') === 'auto') {
      settings.set({
        settingsWindowFlavor: backend.getBackendInfo().shouldUseTransparentSettingsWindow
          ? 'transparent-system'
          : 'sakura-system',
      });
    }

    const settingsWindowFlavor = settings.get('settingsWindowFlavor');
    const transparent =
      settingsWindowFlavor === 'transparent-light' ||
      settingsWindowFlavor === 'transparent-dark' ||
      settingsWindowFlavor === 'transparent-system';

    super({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        // Electron only allows loading local resources from apps loaded from the file
        // system. In development mode, the app is loaded from the webpack dev server.
        // Hence, we have to disable webSecurity in development mode.
        webSecurity: process.env.NODE_ENV !== 'development',
        preload: SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY,
        spellcheck: false,
      },
      backgroundColor: '#00000000',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#ffffff00',
        symbolColor: '#888',
        height: 36,
      },
      // Only on Linux we use a "real" transparent window. On Windows and macOS we use
      // an acrylic background. On Linux, the desktop environment will be responsible
      // for drawing a blurred background.
      transparent: transparent && os.platform() === 'linux',
      // For macOS.
      vibrancy: transparent ? 'menu' : undefined,
      // For Windows.
      backgroundMaterial: transparent ? 'acrylic' : undefined,
      fullscreenable: false,
      width: 1250,
      height: 850,
      minWidth: 1000,
      minHeight: 700,
      show: false,
      autoHideMenuBar: true,
      // Personal build: override the hard-coded size/position above with whatever was
      // last saved, if anything.
      ...loadRestoredBounds(),
    });

    // Personal build: persist the window's bounds (position and size) so they can be
    // restored on next launch. Debounced to avoid hammering disk during a drag/resize.
    let persistBoundsTimeout: ReturnType<typeof setTimeout>;
    const persistBounds = () => {
      clearTimeout(persistBoundsTimeout);
      persistBoundsTimeout = setTimeout(() => {
        try {
          const bounds = this.getNormalBounds();
          if (bounds.width > 0 && bounds.height > 0) {
            fs.writeFileSync(boundsFilePath(), JSON.stringify(bounds));
          }
        } catch {
          // Ignore write errors.
        }
      }, 500);
    };
    this.on('resize', persistBounds);
    this.on('move', persistBounds);

    // Due to an Electron issue, the acrylic effect on Windows is broken after maximizing
    // the window (https://github.com/electron/electron/issues/42393). We can fix this by
    // some direct calls to the Win32 API.
    if (transparent && os.platform() === 'win32') {
      (backend as WindowsBackend).fixAcrylicEffect(
        this.getNativeWindowHandle().readInt32LE(0)
      );
    }

    // If the user clicks on a link, we open the link in the default browser.
    this.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    this.loadURL(SETTINGS_WINDOW_WEBPACK_ENTRY);

    // Show the window when the renderer is ready.
    this.onWindowLoaded.then(() => this.show());
  }
}
