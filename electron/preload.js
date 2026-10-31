'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const PET_EVENTS = [
  'pet:size',
  'pet:count',
  'pet:state',
  'pet:surface',
  'pet:facing',
  'pet:land',
  'pet:bounce',
  'pet:snap',
  'pet:say',
  'pet:react',
  'pet:sound',
  'pet:sound-enabled',
  'pet:cursor',
  'pet:celebrate',
  'pet:pop',
  'pet:skin',
  'pet:do',
];

const PANEL_EVENTS = ['panel:state', 'panel:focus-input'];

function subscribe(channels, callback) {
  const handlers = [];
  for (const channel of channels) {
    const handler = (_event, payload) => callback(channel, payload);
    ipcRenderer.on(channel, handler);
    handlers.push([channel, handler]);
  }
  return () => {
    for (const [channel, handler] of handlers) ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('bridge', {
  pet: {
    ready: () => ipcRenderer.send('pet:ready'),
    pointer: (over) => ipcRenderer.send('pet:pointer', !!over),
    dragStart: (point) => ipcRenderer.send('pet:drag-start', point),
    dragMove: (point) => ipcRenderer.send('pet:drag-move', point),
    dragEnd: () => ipcRenderer.send('pet:drag-end'),
    click: () => ipcRenderer.send('pet:click'),
    context: () => ipcRenderer.send('pet:context'),
    asleep: (on) => ipcRenderer.send('pet:asleep', !!on),
    on: (channel, callback) => subscribe([channel], (_c, payload) => callback(payload)),
    onAny: (callback) => subscribe(PET_EVENTS, callback),
  },

  panel: {
    get: () => ipcRenderer.invoke('panel:get'),
    add: (payload) => ipcRenderer.invoke('panel:add', payload),
    complete: (id) => ipcRenderer.invoke('panel:complete', id),
    remove: (id) => ipcRenderer.invoke('panel:remove', id),
    update: (id, patch) => ipcRenderer.invoke('panel:update', { id, patch }),
    settings: (patch) => ipcRenderer.invoke('panel:settings', patch),
    remindNow: () => ipcRenderer.invoke('panel:remind-now'),
    kill: () => ipcRenderer.invoke('panel:kill'),
    close: () => ipcRenderer.send('panel:close'),
    onAny: (callback) => subscribe(PANEL_EVENTS, callback),
  },
});
