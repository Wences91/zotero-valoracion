/* global Zotero, Services, ChromeUtils, IOUtils, PathUtils, Components */

// Smoke test driver. It is installed next to the plugin in a throwaway Zotero profile by
// scripts/smoke-test.sh, exercises the plugin through Zotero's own UI, writes a report and
// quits Zotero. With the valoracionTest.shots preference set it takes screenshots instead.
var PLUGIN_ID = 'valoracion@wences91.github.io';
var checks = [];
var info = {};
var finished = false;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, what, timeout = 15000) {
  const start = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for ' + what);
    await delay(100);
  }
}
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push(ok ? { ok, name } : { ok, name, actual, expected });
}
function truthy(name, value, detail) {
  checks.push(value ? { ok: true, name } : { ok: false, name, actual: detail === undefined ? value : detail });
}
const clean = s => (s || '').replace(/[⁨⁩]/g, '');

async function finish(extra) {
  if (finished) return;
  finished = true;
  const out = Services.prefs.getStringPref('valoracionTest.out');
  const failed = checks.filter(c => !c.ok);
  let consoleErrors = [];
  try {
    consoleErrors = Services.console.getMessageArray()
      .map(m => String(m.message || m))
      .filter(m => /valoracion/i.test(m) && !/valoracion-test|Test Driver/i.test(m))
      .slice(0, 20);
  } catch (e) {}
  const report = Object.assign({ total: checks.length, failed: failed.length, failures: failed, info, consoleErrors }, extra || {});
  const lines = [info.shots ? 'Screenshot saved' : `${report.total} checks, ${report.failed} failed`];
  if (report.fatal) lines.push(`FATAL ${report.fatal}`);
  for (const f of failed) lines.push(`FAIL ${f.name}: got ${JSON.stringify(f.actual)}, expected ${JSON.stringify(f.expected)}`);
  for (const m of consoleErrors) lines.push(`CONSOLE ${m}`);
  try {
    await IOUtils.writeUTF8(out, JSON.stringify(report, null, 2));
    await IOUtils.writeUTF8(out.replace(/\.json$/, '.txt'), lines.join('\n') + '\n');
  }
  catch (e) { Zotero.logError(e); }
  await delay(300);
  Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
}

async function run() {
  await Zotero.uiReadyPromise;
  const win = await waitFor(() => {
    const w = Zotero.getMainWindow();
    return w && w.ZoteroPane && w.ZoteroPane.itemsView && w.ZoteroPane.itemPane
      && w.ZoteroPane.collectionsView && w.ZoteroPane.collectionsView.itemTreeView ? w : null;
  }, 'main window', 60000);
  await delay(1500);
  const doc = win.document;
  const ZP = win.ZoteroPane;
  info.zotero = Zotero.version;
  info.locale = Zotero.locale;

  // ---- add-on metadata
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addon = await waitFor(() => AddonManager.getAddonByID(PLUGIN_ID), 'add-on');
  info.addon = { name: addon.name, description: addon.description, version: addon.version,
    isActive: addon.isActive, appDisabled: addon.appDisabled, userDisabled: addon.userDisabled,
    homepage: addon.homepageURL };
  truthy('add-on active', addon.isActive, info.addon);

  const findColumn = () => Zotero.ItemTreeManager.getCustomColumns().find(c => c.pluginID === PLUGIN_ID);
  const col = await waitFor(findColumn, 'column registration');
  info.column = { dataKey: col.dataKey, label: col.label, sortReverse: col.sortReverse, width: col.width };

  // ---- data
  const mk = async (title, extra) => {
    const it = new Zotero.Item('journalArticle');
    it.setField('title', title);
    if (extra) it.setField('extra', extra);
    await it.saveTx();
    return it;
  };
  const a = await mk('A legacy seven', 'DOI: 10.1/x\nValoración: 7');
  const b = await mk('B unrated');
  const c = await mk('C ten', 'Rating: 10');
  const d = await mk('D two', 'Rating: 2');
  const e = await mk('E ten too', 'Rating: 10');
  const note = new Zotero.Item('note'); note.setNote('Rating: 5'); await note.saveTx();

  check('dataProvider legacy', col.dataProvider(a, col.dataKey), '07');
  check('dataProvider unrated', col.dataProvider(b, col.dataKey), '00');
  check('dataProvider ten', col.dataProvider(c, col.dataKey), '10');
  check('dataProvider note', col.dataProvider(note, col.dataKey), '00');

  // ---- window resources
  truthy('stylesheet linked', !!doc.getElementById('valoracion-stylesheet'));
  truthy('ftl linked', !!doc.querySelector('link[href="valoracion.ftl"]'));
  check('stylesheet link count', doc.querySelectorAll('#valoracion-stylesheet').length, 1);

  // ---- item pane section
  const sectionEl = () => ZP.itemPane.querySelector('item-pane-custom-section[data-pane*="valoracion"]');
  const q = sel => sectionEl() && sectionEl().querySelector(sel);
  const badgeText = () => q('.valoracion-badge-large') && q('.valoracion-badge-large').textContent;
  const select = async (item) => { await ZP.selectItem(item.id); await delay(150); };

  await select(a);
  await waitFor(() => badgeText() === '7', 'section showing 7');
  const cs = el => win.getComputedStyle(el);
  const badge = q('.valoracion-badge-large');
  const options = () => Array.from(sectionEl().querySelectorAll('.valoracion-option'));
  const clear = () => q('.valoracion-clear');
  const coll = () => sectionEl().querySelector('collapsible-section');

  info.header = await waitFor(() => coll().getAttribute('label'), 'header label').catch(() => null);
  info.sidenavTooltip = (() => {
    const btn = doc.querySelector('item-pane-sidenav [data-pane*="valoracion"], [data-pane*="valoracion"][tooltiptext]');
    return btn ? btn.getAttribute('tooltiptext') : null;
  })();
  info.description7 = q('.valoracion-description').textContent;
  info.clearLabel = clear().textContent;
  info.clearTitle = clear().title;
  info.rateTitle7 = clean(options()[6].title);
  info.groupLabel = q('.valoracion-scale').getAttribute('aria-label');
  check('badge level (7)', badge.dataset.level, 'high');
  check('badge bg', cs(badge).backgroundColor, 'rgb(102, 204, 51)');
  check('badge color', cs(badge).color, 'rgb(27, 27, 27)');
  check('badge height', Math.round(badge.getBoundingClientRect().height), 44);
  truthy('badge width >= 44', badge.getBoundingClientRect().width >= 44, badge.getBoundingClientRect().width);
  check('badge font-size', cs(badge).fontSize, '22px');
  check('option count', options().length, 10);
  check('option labels', options().map(o => o.textContent).join(','), '1,2,3,4,5,6,7,8,9,10');
  check('option bg colours', [0, 4, 8].map(i => cs(options()[i]).backgroundColor),
    ['rgb(255, 0, 0)', 'rgb(255, 204, 51)', 'rgb(102, 204, 51)']);
  check('option text colours', [0, 4, 8].map(i => cs(options()[i]).color),
    ['rgb(255, 255, 255)', 'rgb(27, 27, 27)', 'rgb(27, 27, 27)']);
  check('option heights', options().map(o => Math.round(o.getBoundingClientRect().height)), Array(10).fill(24));
  truthy('option widths >= 26', options().every(o => o.getBoundingClientRect().width >= 26),
    options().map(o => o.getBoundingClientRect().width));
  check('option borders', cs(options()[2]).borderTopWidth, '0px');
  check('pressed flags', options().map(o => o.getAttribute('aria-pressed')).join(','),
    'false,false,false,false,false,false,true,false,false,false');
  check('pressed opacity', cs(options()[6]).opacity, '1');
  check('unpressed opacity', cs(options()[0]).opacity, '0.45');
  truthy('pressed outline (box-shadow)', cs(options()[6]).boxShadow !== 'none', cs(options()[6]).boxShadow);
  check('unpressed box-shadow', cs(options()[0]).boxShadow, 'none');
  check('options enabled', options().every(o => !o.disabled), true);
  check('clear enabled', clear().disabled, false);
  check('summary 7', coll().summary, '7/10');
  info.optionRow = options().map(o => Math.round(o.getBoundingClientRect().top));
  {
    const br = badge.getBoundingClientRect(), cr = clear().getBoundingClientRect(),
      pr = q('.valoracion-panel').getBoundingClientRect(), or = options()[0].getBoundingClientRect();
    info.clearRect = { w: Math.round(cr.width), h: Math.round(cr.height) };
    truthy('remove button on the badge row', cr.top >= br.top && cr.bottom <= br.bottom, { cr: [cr.top, cr.bottom], br: [br.top, br.bottom] });
    truthy('remove button right-aligned', Math.abs(pr.right - cr.right) <= 1, { panel: pr.right, clear: cr.right });
    check('options on one row', new Set(info.optionRow).size, 1);
    truthy('options below badge', or.top >= br.bottom, { or: or.top, br: br.bottom });
  }
  info.panelWidth = Math.round(q('.valoracion-panel').getBoundingClientRect().width);

  // ---- rate by clicking
  let modifies = 0;
  const obsID = Zotero.Notifier.registerObserver({
    notify(event, type, ids) { if (type === 'item' && event === 'modify' && ids.includes(a.id)) modifies++; }
  }, ['item'], 'valoracion-test');

  options()[8].click();
  await waitFor(() => a.getField('extra') === 'DOI: 10.1/x\nRating: 9', 'extra after clicking 9');
  await waitFor(() => badgeText() === '9', 'badge 9');
  check('extra after 9', a.getField('extra'), 'DOI: 10.1/x\nRating: 9');
  check('pressed after 9', options().map(o => o.getAttribute('aria-pressed')).join(','),
    'false,false,false,false,false,false,false,false,true,false');
  check('summary 9', coll().summary, '9/10');
  info.description9 = q('.valoracion-description').textContent;
  check('cell data after 9', col.dataProvider(a, col.dataKey), '09');

  // same value again: nothing should be saved
  const before = modifies;
  options()[8].click();
  await delay(600);
  check('re-click same value saves nothing', modifies, before);

  // ---- undo and redo (Zotero 10)
  if (Zotero.UndoHistory) {
    check('rating can be undone', Zotero.UndoHistory.canUndo(), true);
    await Zotero.UndoHistory.undo();
    await waitFor(() => badgeText() === '7', 'section follows undo');
    check('extra after undo', a.getField('extra'), 'DOI: 10.1/x\nValoración: 7');
    await Zotero.UndoHistory.redo();
    await waitFor(() => badgeText() === '9', 'section follows redo');
    check('extra after redo', a.getField('extra'), 'DOI: 10.1/x\nRating: 9');
  }

  // ---- external change (what undo, sync or a manual Extra edit would do)
  a.setField('extra', 'DOI: 10.1/x\nRating: 3');
  await a.saveTx();
  await waitFor(() => badgeText() === '3', 'badge follows external change');
  check('badge level (3)', q('.valoracion-badge-large').dataset.level, 'low');
  check('badge bg (3)', cs(q('.valoracion-badge-large')).backgroundColor, 'rgb(255, 0, 0)');
  check('summary 3', coll().summary, '3/10');
  info.description3 = q('.valoracion-description').textContent;

  options()[0].click();
  await waitFor(() => badgeText() === '1', 'badge 1');
  info.description1 = q('.valoracion-description').textContent;
  options()[4].click();
  await waitFor(() => badgeText() === '5', 'badge 5');
  info.description5 = q('.valoracion-description').textContent;
  check('badge bg (5)', cs(q('.valoracion-badge-large')).backgroundColor, 'rgb(255, 204, 51)');

  // ---- remove
  clear().click();
  await waitFor(() => a.getField('extra') === 'DOI: 10.1/x', 'extra after remove');
  await waitFor(() => badgeText() === '–', 'badge dash');
  check('extra after remove', a.getField('extra'), 'DOI: 10.1/x');
  check('badge level (none)', q('.valoracion-badge-large').dataset.level, 'none');
  check('clear disabled when unrated', clear().disabled, true);
  check('summary empty', coll().summary || '', '');
  check('no option pressed', options().some(o => o.getAttribute('aria-pressed') === 'true'), false);
  info.descriptionNone = q('.valoracion-description').textContent;
  Zotero.Notifier.unregisterObserver(obsID);

  // ---- switching items
  await select(c);
  await waitFor(() => badgeText() === '10', 'item C');
  check('pressed for 10', options()[9].getAttribute('aria-pressed'), 'true');
  await select(e);
  await delay(300);
  check('item E (same value as C)', badgeText(), '10');
  options()[7].click();
  await waitFor(() => e.getField('extra') === 'Rating: 8', 'E rated 8');
  check('C untouched', c.getField('extra'), 'Rating: 10');
  await select(b);
  await waitFor(() => badgeText() === '–', 'item B');
  options()[5].click();
  await waitFor(() => b.getField('extra') === 'Rating: 6', 'B rated 6 from empty Extra');
  const att = new Zotero.Item('attachment');
  att.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;
  att.attachmentContentType = 'text/html';
  att.setField('title', 'Link');
  att.setField('url', 'https://example.com/');
  att.parentID = d.id;
  await att.saveTx();
  await select(att);
  await delay(500);
  check('item pane mode for attachment', ZP.itemPane.mode, 'item');
  check('section hidden for attachments', !!sectionEl().hidden, true);
  await select(d);
  await waitFor(() => badgeText() === '2' && !sectionEl().hidden, 'section back for regular item');
  await select(note);
  await delay(400);
  check('item pane mode for note', ZP.itemPane.mode, 'note');

  // ---- item tree column
  const view = ZP.itemsView;
  const cols = () => view._getColumns();
  const colIndex = () => cols().findIndex(x => x.dataKey === col.dataKey);
  truthy('column present in tree', colIndex() >= 0, cols().map(x => x.dataKey));
  info.columnHiddenByDefault = !!cols()[colIndex()].hidden;
  if (cols()[colIndex()].hidden) view.tree._columns.toggleHidden(colIndex());
  await select(a);
  const cells = await waitFor(() => {
    const list = Array.from(doc.querySelectorAll('#zotero-items-tree .valoracion-cell'));
    return list.length ? list : null;
  }, 'rendered cells');
  const badges = Array.from(doc.querySelectorAll('#zotero-items-tree .valoracion-cell .valoracion-badge'));
  info.treeCells = cells.length;
  info.treeBadges = badges.map(x => x.textContent).sort().join(',');
  check('tree badges', info.treeBadges, '10,2,6,8');
  const tb = badges.find(x => x.textContent === '10');
  check('tree badge bg', cs(tb).backgroundColor, 'rgb(102, 204, 51)');
  check('tree badge height', Math.round(tb.getBoundingClientRect().height), 16);
  check('tree badge font-size', cs(tb).fontSize, '11px');
  const cellRect = tb.parentElement.getBoundingClientRect(), tbRect = tb.getBoundingClientRect();
  const off = Math.abs((cellRect.left + cellRect.width / 2) - (tbRect.left + tbRect.width / 2));
  truthy('tree badge centred horizontally', off <= 1.5, { off, cell: cellRect.width, badge: tbRect.width });
  const offV = Math.abs((cellRect.top + cellRect.height / 2) - (tbRect.top + tbRect.height / 2));
  truthy('tree badge centred vertically', offV <= 1.5, { offV, cell: cellRect.height, badge: tbRect.height });
  info.headerLabel = (() => {
    const h = Array.from(doc.querySelectorAll('#zotero-items-tree .virtualized-table-header .cell'))
      .find(x => x.className.includes('valoracion') || x.textContent.trim() === col.label);
    return h ? h.textContent.trim() : null;
  })();

  // sort: first click = best first
  view.tree._columns.toggleSort(colIndex());
  await delay(800);
  const order = () => {
    const out = [];
    for (let i = 0; i < view.rowCount; i++) out.push(view.getRow(i).ref.getField('title') || 'note');
    return out;
  };
  info.sortFirstClick = order();
  check('first click sorts best first', info.sortFirstClick.slice(0, 4),
    ['C ten', 'E ten too', 'B unrated', 'D two']);
  view.tree._columns.toggleSort(colIndex());
  await delay(800);
  info.sortSecondClick = order();
  check('second click sorts worst first (rated part)',
    info.sortSecondClick.filter(t => /ten|two|unrated/.test(t)), ['D two', 'B unrated', 'E ten too', 'C ten']);

  // ---- disable / enable cycle
  await addon.disable();
  await waitFor(() => !findColumn(), 'column unregistered');
  await delay(500);
  truthy('stylesheet removed on disable', !doc.getElementById('valoracion-stylesheet'));
  truthy('ftl link removed on disable', !doc.querySelector('link[href="valoracion.ftl"]'));
  truthy('section removed on disable', !sectionEl() || !sectionEl().isConnected);
  check('cells gone on disable', doc.querySelectorAll('#zotero-items-tree .valoracion-cell').length, 0);

  await addon.enable();
  await waitFor(findColumn, 'column registered again');
  await select(c);
  await waitFor(() => badgeText() === '10', 'section back after enable');
  truthy('stylesheet back after enable', !!doc.getElementById('valoracion-stylesheet'));
  check('badge styled after enable', cs(q('.valoracion-badge-large')).backgroundColor, 'rgb(102, 204, 51)');
  options()[3].click();
  await waitFor(() => c.getField('extra') === 'Rating: 4', 'rating works after enable');
  check('rating works after enable', c.getField('extra'), 'Rating: 4');
}

async function snapshot(win, path, rect, scale) {
  const r = rect || new win.DOMRect(0, 0, win.innerWidth, win.innerHeight);
  const bitmap = await win.browsingContext.currentWindowGlobal.drawSnapshot(r, scale || 2, 'rgb(255,255,255)');
  const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
}

async function shots(dir) {
  await Zotero.uiReadyPromise;
  const win = await waitFor(() => {
    const w = Zotero.getMainWindow();
    return w && w.ZoteroPane && w.ZoteroPane.itemsView && w.ZoteroPane.itemPane
      && w.ZoteroPane.collectionsView && w.ZoteroPane.collectionsView.itemTreeView ? w : null;
  }, 'main window', 60000);
  await delay(1500);
  const doc = win.document, ZP = win.ZoteroPane;
  const es = Zotero.locale.startsWith('es');
  info.locale = Zotero.locale;
  const col = await waitFor(() => Zotero.ItemTreeManager.getCustomColumns().find(c => c.pluginID === PLUGIN_ID), 'column');
  const data = es ? [
    ['Referencia imprescindible', 'Doe', '2024', 10], ['Buena lectura de contexto', 'Roe', '2021', 8],
    ['Útil para la metodología', 'Poe', '2019', 7], ['Algunas ideas interesantes', 'Moe', '2022', 5],
    ['Relevancia marginal', 'Loe', '2018', 3], ['No merece citarse', 'Coe', '2016', 1],
    ['Pendiente de leer', 'Noe', '2025', null]
  ] : [
    ['A must-read reference', 'Doe', '2024', 10], ['Solid background reading', 'Roe', '2021', 8],
    ['Useful for the methods section', 'Poe', '2019', 7], ['Some interesting ideas', 'Moe', '2022', 5],
    ['Marginal relevance', 'Loe', '2018', 3], ['Not worth citing', 'Coe', '2016', 1],
    ['Still to be read', 'Noe', '2025', null]
  ];
  const items = [];
  for (const [title, author, year, rating] of data) {
    const it = new Zotero.Item('journalArticle');
    it.setField('title', title);
    it.setField('date', year);
    it.setCreators([{ lastName: author, firstName: 'J.', creatorType: 'author' }]);
    if (rating) it.setField('extra', 'Rating: ' + rating);
    await it.saveTx();
    items.push(it);
  }
  win.resizeTo(1180, 640);
  await delay(800);
  const view = ZP.itemsView;
  const idx = () => view._getColumns().findIndex(x => x.dataKey === col.dataKey);
  if (view._getColumns()[idx()].hidden) view.tree._columns.toggleHidden(idx());
  await delay(500);
  view.tree._columns.toggleSort(idx());
  await delay(800);
  await ZP.selectItem(items[1].id);
  const sectionEl = () => ZP.itemPane.querySelector('item-pane-custom-section[data-pane*="valoracion"]');
  await waitFor(() => sectionEl() && sectionEl().querySelector('.valoracion-badge-large')
    && sectionEl().querySelector('.valoracion-badge-large').textContent === '8', 'section');
  await delay(500);
  sectionEl().scrollIntoView({ block: 'center' });
  await delay(1200);
  await snapshot(win, PathUtils.join(dir, `screenshot-${es ? 'es' : 'en'}.png`), null, 2);
  info.shots = true;
}

function startup() {
  setTimeout(() => finish({ fatal: 'global timeout' }), 150000);
  const dir = Services.prefs.getStringPref('valoracionTest.shots', '');
  (dir ? shots(dir) : run()).then(() => finish(), e => finish({ fatal: String(e), stack: e && e.stack }));
}
function shutdown() {}
function install() {}
function uninstall() {}
