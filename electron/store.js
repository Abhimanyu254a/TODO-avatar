'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULTS = {
  todos: [],
  history: [],
  settings: {
    avatarSize: 96, // 32 .. 128
    skin: 'cat', // blob | cat | dog
    sound: true,
    reminders: true,
    alwaysOnTop: true,
    autoLaunch: false,
    passiveMinMinutes: 25,
    passiveMaxMinutes: 45,
    petPos: null,
  },
};

const HISTORY_LIMIT = 300;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'todo-avatar.json');
    this.data = clone(DEFAULTS);
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...clone(DEFAULTS),
        ...raw,
        settings: { ...clone(DEFAULTS.settings), ...(raw.settings || {}) },
      };
      this.data.todos = (Array.isArray(raw.todos) ? raw.todos : [])
        .filter((t) => t && typeof t.text === 'string' && t.text.trim().length > 0)
        .map((t) => ({
          id: t.id || randomUUID(),
          text: String(t.text).slice(0, 200),
          priority: ['low', 'med', 'high'].includes(t.priority) ? t.priority : 'med',
          createdAt: Number(t.createdAt) || Date.now(),
          dueAt: t.dueAt ? Number(t.dueAt) : null,
          remindedAt: t.remindedAt ? Number(t.remindedAt) : null,
        }));
      this.data.history = (Array.isArray(raw.history) ? raw.history : []).slice(0, HISTORY_LIMIT);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[store] could not load data, starting fresh:', err.message);
      }
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[store] save failed:', err.message);
    }
  }

  get settings() {
    return this.data.settings;
  }

  get todos() {
    return this.data.todos;
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.save();
  }

  add({ text, priority = 'med', dueAt = null }) {
    const todo = {
      id: randomUUID(),
      text: String(text).trim().slice(0, 200),
      priority: ['low', 'med', 'high'].includes(priority) ? priority : 'med',
      createdAt: Date.now(),
      dueAt: dueAt ? Number(dueAt) : null,
      remindedAt: null,
    };
    if (!todo.text) return null;
    this.data.todos.push(todo);
    this.save();
    return todo;
  }

  update(id, patch) {
    const todo = this.data.todos.find((t) => t.id === id);
    if (!todo) return null;
    if (typeof patch.text === 'string' && patch.text.trim()) todo.text = patch.text.trim().slice(0, 200);
    if (['low', 'med', 'high'].includes(patch.priority)) todo.priority = patch.priority;
    if (patch.dueAt !== undefined) {
      todo.dueAt = patch.dueAt ? Number(patch.dueAt) : null;
      todo.remindedAt = null; // new deadline deserves a new alarm
    }
    this.save();
    return todo;
  }

  remove(id) {
    const idx = this.data.todos.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const [todo] = this.data.todos.splice(idx, 1);
    this.save();
    return todo;
  }

  /** Removes the task from the active list and records it in history. */
  complete(id) {
    const todo = this.remove(id);
    if (!todo) return null;
    this.data.history.unshift({
      id: todo.id,
      text: todo.text,
      priority: todo.priority,
      completedAt: Date.now(),
    });
    this.data.history = this.data.history.slice(0, HISTORY_LIMIT);
    this.save();
    return todo;
  }

  topTask() {
    const weight = { high: 3, med: 2, low: 1 };
    return [...this.data.todos].sort((a, b) => {
      const byPriority = (weight[b.priority] || 2) - (weight[a.priority] || 2);
      if (byPriority) return byPriority;
      const aDue = a.dueAt || Infinity;
      const bDue = b.dueAt || Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return a.createdAt - b.createdAt;
    })[0] || null;
  }

  snappedToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.data.history.filter((h) => h.completedAt >= start.getTime()).length;
  }

  snapshot() {
    return {
      todos: this.data.todos,
      history: this.data.history.slice(0, 30),
      settings: this.data.settings,
      snappedToday: this.snappedToday(),
      pending: this.data.todos.length,
      now: Date.now(),
    };
  }
}

module.exports = { Store };
