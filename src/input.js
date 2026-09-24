// Keyboard + touch/mouse swipe input. Actions are queued and consumed by the fixed-step
// simulation, so input handling never depends on the display frame rate.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', Space: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyE: 'board', ShiftLeft: 'board', ShiftRight: 'board',
  Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm',
};

export class Input {
  constructor(surface) {
    this.queue = [];
    this.listeners = [];
    this.gesture = null;
    this.lastTap = 0;

    window.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      // Let buttons keep keyboard activation when focused.
      if ((e.code === 'Space' || e.code === 'Enter') && e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      if (e.repeat) return;
      this.emit(action);
    });

    surface.addEventListener('pointerdown', (e) => this.onDown(e));
    surface.addEventListener('pointermove', (e) => this.onMove(e));
    surface.addEventListener('pointerup', (e) => this.onUp(e));
    surface.addEventListener('pointercancel', () => (this.gesture = null));
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onAction(fn) {
    this.listeners.push(fn);
  }

  emit(action) {
    this.queue.push(action);
    for (const fn of this.listeners) fn(action);
  }

  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  clear() {
    this.queue.length = 0;
  }

  threshold() {
    return Math.max(18, Math.min(window.innerWidth, window.innerHeight) * 0.045);
  }

  onDown(e) {
    this.gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), fired: false };
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  onMove(e) {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId || g.fired) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < this.threshold()) return;
    g.fired = true;
    if (Math.abs(dx) > Math.abs(dy)) this.emit(dx > 0 ? 'right' : 'left');
    else this.emit(dy > 0 ? 'down' : 'up');
  }

  onUp(e) {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.id !== e.pointerId || g.fired) return;
    const now = performance.now();
    const dist = Math.hypot(e.clientX - g.x, e.clientY - g.y);
    if (now - g.t > 300 || dist > this.threshold()) return;
    if (now - this.lastTap < 320) {
      this.lastTap = 0;
      this.emit('board');
    } else {
      this.lastTap = now;
      this.emit('tap');
    }
  }
}
