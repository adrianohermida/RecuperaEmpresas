'use strict';

function getMirrorEntries() {
  return [];
}

function syncRootMirrors(options = {}) {
  const { silent = false } = options;

  if (!silent) {
    console.log('Espelhos da raiz desativados.');
  }
}

if (require.main === module) {
  syncRootMirrors();
}

module.exports = {
  getMirrorEntries,
  syncRootMirrors,
};