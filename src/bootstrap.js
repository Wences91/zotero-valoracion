/* global Zotero, Services, APP_SHUTDOWN */

var Valoracion;

function install() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + 'valoracion.js');
  await Valoracion.init({ id, version, rootURI });
}

function onMainWindowLoad({ window }) {
  Valoracion?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  Valoracion?.removeFromWindow(window);
}

function shutdown(data, reason) {
  // Nothing to clean up when the whole application is closing
  if (reason === APP_SHUTDOWN) return;
  Valoracion?.shutdown();
  Valoracion = undefined;
}

function uninstall() {}
