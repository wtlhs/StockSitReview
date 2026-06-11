'use strict';

const Utils = {
  _audioContext: null,

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  },

  nowISO() {
    return new Date().toISOString();
  },

  formatDate(isoString) {
    const value = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate()) + ' ' + pad(value.getHours()) + ':' + pad(value.getMinutes());
  },

  esc(str) {
    if (str == null) return '';
    const el = document.createElement('div');
    el.textContent = String(str);
    return el.innerHTML;
  },

  normalizeBarcode(text) {
    if (typeof text !== 'string') return null;
    const normalized = text.replace(/\s+/g, '').toUpperCase();
    if (!/^\d{18}$/.test(normalized)) return null;
    return normalized;
  },

  parsePositiveInt(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.floor(number);
  },

  vibrate(pattern = 100) {
    if (navigator && typeof navigator.vibrate === 'function') {
      try {
        return navigator.vibrate(pattern);
      } catch (_) {
        return false;
      }
    }
    const kind = Array.isArray(pattern) ? 'error' : 'notice';
    this.beep(kind);
    return false;
  },

  flashElement(element, className = 'scan-target-hit', duration = 900) {
    if (!element) return;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration);
  },

  prepareFeedback() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      if (!this._audioContext) this._audioContext = new AudioContext();
      if (this._audioContext.state === 'suspended') {
        this._audioContext.resume().catch(() => {});
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  beep(kind = 'notice') {
    if (!this.prepareFeedback() || !this._audioContext) return false;
    try {
      const context = this._audioContext;
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === 'error' ? 'sawtooth' : 'sine';
      oscillator.frequency.setValueAtTime(kind === 'error' ? 220 : 660, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(kind === 'error' ? 0.08 : 0.04, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (kind === 'error' ? 0.18 : 0.1));
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + (kind === 'error' ? 0.2 : 0.12));
      return true;
    } catch (_) {
      return false;
    }
  },

  isIOS() {
    const platform = navigator.platform || '';
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(platform) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1) || /iPhone|iPad|iPod/i.test(ua);
  },

  isSafari() {
    const ua = navigator.userAgent || '';
    return /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  }
};
