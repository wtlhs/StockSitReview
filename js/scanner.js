'use strict';

const Scanner = {
  _scanner: null,
  _containerId: null,
  _isRunning: false,
  _lastCode: null,
  _lastTime: 0,
  _debounceMs: 1500,
  _highlightTimer: null,

  _createOverlay(container) {
    if (container.querySelector('.scan-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'scan-overlay';
    const frame = document.createElement('div');
    frame.className = 'scan-frame';
    ['tl', 'tr', 'bl', 'br'].forEach((pos) => {
      const corner = document.createElement('span');
      corner.className = 'scan-corner scan-corner-' + pos;
      frame.appendChild(corner);
    });
    const line = document.createElement('div');
    line.className = 'scan-line';
    frame.appendChild(line);
    overlay.appendChild(frame);
    container.appendChild(overlay);
  },

  _removeOverlay() {
    const container = document.getElementById(this._containerId);
    if (!container) return;
    const overlay = container.querySelector('.scan-overlay');
    if (overlay) overlay.remove();
  },

  _rememberScan(code, now) {
    this._lastCode = code;
    this._lastTime = now;
  },

  _isDuplicate(code, now) {
    return code === this._lastCode && (now - this._lastTime) < this._debounceMs;
  },

  _drawTargetHighlight() {
    this._feedbackOnMatch();
  },

  _canUseNativeVibrate() {
    return !!(navigator && typeof navigator.vibrate === 'function');
  },

  _feedbackOnMismatch() {
    if (this._canUseNativeVibrate()) {
      Utils.vibrate([70, 60, 70]);
      return;
    }
    const resultArea = document.getElementById('scan-result-area');
    if (resultArea) {
      Utils.flashElement(resultArea, 'scan-target-miss', 700);
    }
    Utils.vibrate([70, 60, 70]);
  },

  _feedbackOnMatch() {
    if (this._canUseNativeVibrate()) {
      Utils.vibrate(180);
      return;
    }
    const resultArea = document.getElementById('scan-result-area');
    if (resultArea) {
      Utils.flashElement(resultArea, 'scan-target-hit', 500);
    }
    Utils.vibrate(180);
  },

  _feedbackOnStart() {
    const resultArea = document.getElementById('scan-result-area');
    if (resultArea) {
      Utils.flashElement(resultArea, 'scan-target-hit', 300);
    }
  },

  _getFormats() {
    if (typeof Html5QrcodeSupportedFormats === 'undefined') return undefined;
    return [Html5QrcodeSupportedFormats.CODE_128];
  },

  _ensureScanner(containerId) {
    if (this._scanner) return this._scanner;
    const formats = this._getFormats();
    this._scanner = new Html5Qrcode(containerId, formats ? { formatsToSupport: formats } : undefined);
    return this._scanner;
  },

  async _pause() {
    this._isRunning = false;
    clearTimeout(this._highlightTimer);
    const scanner = this._scanner;
    if (scanner) {
      try {
        await scanner.stop();
      } catch (_) {}
    }
    this._removeOverlay();
  },

  async _recreateScanner(containerId) {
    const scanner = this._scanner;
    this._scanner = null;
    if (scanner) {
      try {
        await scanner.clear();
      } catch (_) {}
    }
    return this._ensureScanner(containerId);
  },

  async start(containerId, onSuccess) {
    this._containerId = containerId;
    if (this._isRunning) {
      await this._pause();
    }

    const container = document.getElementById(containerId);
    if (!container) return;

    const isIOS = Utils.isIOS();
    const isSafari = Utils.isSafari();
    container.classList.remove('collapsed');
    container.classList.toggle('ios-scanner', isIOS);
    const scanner = this._ensureScanner(containerId);

    const scanConfig = {
      fps: isIOS ? 12 : 14,
      aspectRatio: 1.0,
      disableFlip: true,
      experimentalFeatures: isIOS ? { useBarCodeDetectorIfSupported: true } : undefined,
      videoConstraints: isIOS
        ? { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        : undefined,
      qrbox(viewfinderWidth, viewfinderHeight) {
        const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * (isIOS ? 0.96 : 0.88));
        return { width: size, height: Math.floor(size * (isIOS ? 0.3 : 0.48)) };
      }
    };

    const cameraTarget = { facingMode: 'environment' };

    const successCallback = (decodedText) => this._onScanSuccess(decodedText, onSuccess);
    const errorCallback = () => {};

    let activeScanner = scanner;
    try {
      await activeScanner.start(cameraTarget, scanConfig, successCallback, errorCallback);
    } catch (firstError) {
      try {
        activeScanner = await this._recreateScanner(containerId);
        await activeScanner.start(cameraTarget, scanConfig, successCallback, errorCallback);
      } catch (recreateError) {
        try {
          await activeScanner.stop();
        } catch (_) {}
        try {
          const cameras = typeof Html5Qrcode.getCameras === 'function' ? await Html5Qrcode.getCameras() : [];
          const fallbackCamera = cameras.find((camera) => /back|rear|environment|后置|背面/i.test(camera.label || '')) || cameras[0];
          if (!fallbackCamera || !fallbackCamera.id) throw recreateError || firstError;
          await activeScanner.start(fallbackCamera.id, scanConfig, successCallback, errorCallback);
        } catch (secondError) {
          try {
            await activeScanner.clear();
          } catch (_) {}
          this._scanner = null;
          App.showToast('摄像头启动失败，请检查权限', true);
          await this.stop();
          throw secondError;
        }
      }
    }

    this._isRunning = true;
    this._createOverlay(container);
    this._feedbackOnStart();
    if (isIOS && isSafari) {
      setTimeout(() => this._feedbackOnStart(), 120);
    }
  },

  async stop() {
    this._isRunning = false;
    clearTimeout(this._highlightTimer);
    const scanner = this._scanner;
    this._scanner = null;
    if (scanner) {
      try {
        await scanner.stop();
      } catch (_) {}
      try {
        await scanner.clear();
      } catch (_) {}
    }
    this._removeOverlay();
    if (this._containerId) {
      const container = document.getElementById(this._containerId);
      if (container) {
        container.classList.remove('ios-scanner');
        container.innerHTML = '';
      }
    }
  },

  _onScanSuccess(decodedText, onSuccess) {
    if (!this._isRunning || typeof decodedText !== 'string') return;

    const rawText = decodedText.trim();
    if (!rawText) return;

    const now = Date.now();
    if (this._isDuplicate(rawText, now)) return;
    this._rememberScan(rawText, now);

    const normalizedCode = Utils.normalizeBarcode(rawText);
    if (!normalizedCode) {
      App.showToast('请扫描 18 位托盘条形码', true);
      this._feedbackOnMismatch();
      return;
    }

    this._feedbackOnMatch();
    this._pause().then(() => {
      if (typeof onSuccess === 'function') {
        onSuccess(normalizedCode, rawText);
      }
    });
  }
};
