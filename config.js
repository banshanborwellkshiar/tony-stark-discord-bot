'use strict';

/**
 * Per-guild runtime settings, set via Discord commands (no file editing).
 * Persisted to config.json so settings survive restarts.
 *
 * Currently stores: allowedRole (the role required to use Tony, if any).
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'config.json');

let store = load();

function load() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('config load failed:', err.message);
  }
  return {};
}

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('config save failed:', err.message);
  }
}

function getAllowedRole(guildId) {
  return store[guildId]?.allowedRole || null;
}

function setAllowedRole(guildId, roleName) {
  if (!store[guildId]) store[guildId] = {};
  store[guildId].allowedRole = roleName;
  save();
}

function clearAllowedRole(guildId) {
  if (store[guildId]) {
    delete store[guildId].allowedRole;
    save();
  }
}

module.exports = { getAllowedRole, setAllowedRole, clearAllowedRole };
