/**
 * tabs.js
 * Handles nav tab switching between panels.
 */

const TAB_INITS = {};

/**
 * Register a tab initializer. Called once per tab on first activation.
 * @param {string} tabId
 * @param {function} initFn
 */
export function registerTab(tabId, initFn) {
  TAB_INITS[tabId] = { initFn, initialized: false };
}

/**
 * Switch to a tab by id (e.g. 'chat', 'compliance', 'analyzer').
 * Lazy-initializes the panel on first visit.
 * @param {string} tabId
 */
export function switchTab(tabId) {
  // Update nav buttons
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update panels
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabId}`);
  });

  // Lazy init
  const entry = TAB_INITS[tabId];
  if (entry && !entry.initialized) {
    const container = document.getElementById(`panel-${tabId}`);
    entry.initFn(container);
    entry.initialized = true;
  }
}

/**
 * Bind all nav tab click events.
 */
export function initTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}
