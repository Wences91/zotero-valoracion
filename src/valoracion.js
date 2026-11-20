/* global Zotero, Localization */

Valoracion = {
  id: null,
  version: null,
  rootURI: null,

  columnKey: null,
  paneID: null,
  notifierID: null,
  strings: null,
  // Item pane sections currently alive, keyed by their body element
  sections: new Map(),

  MIN: 1,
  MAX: 10,
  // A rating is stored as its own line in the item's Extra field: "Rating: 7".
  // "Valoración: 7" (written by version 1.0.0) is still read, and is rewritten
  // with the current key the next time that item is rated.
  EXTRA_KEY: 'Rating',
  // Matches the rating line, either within the whole Extra text or in a single line of it
  LINE_RE: /^[ \t]*(?:rating|valoraci[oó]n)[ \t]*:[ \t]*(\d{1,2})[ \t\r]*$/im,

  HTML_NS: 'http://www.w3.org/1999/xhtml',
  FTL: 'valoracion.ftl',
  STYLE_ID: 'valoracion-stylesheet',

  async init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;

    this.loadStrings();
    for (const win of Zotero.getMainWindows()) {
      this.addToWindow(win);
    }
    await this.registerColumn();
    this.registerSection();
    // Keeps open sections in sync with changes made elsewhere (undo, sync, manual edits to Extra)
    this.notifierID = Zotero.Notifier.registerObserver(this, ['item'], 'valoracion');
  },

  shutdown() {
    if (this.notifierID) Zotero.Notifier.unregisterObserver(this.notifierID);
    if (this.columnKey) Zotero.ItemTreeManager.unregisterColumn(this.columnKey);
    if (this.paneID) Zotero.ItemPaneManager.unregisterSection(this.paneID);
    for (const win of Zotero.getMainWindows()) {
      this.removeFromWindow(win);
    }
    this.sections.clear();
  },

  addToWindow(window) {
    const doc = window.document;
    // Used by the section header and sidenav button, which Zotero localizes itself
    window.MozXULElement.insertFTLIfNeeded(this.FTL);
    if (!doc.getElementById(this.STYLE_ID)) {
      const link = doc.createElementNS(this.HTML_NS, 'link');
      link.id = this.STYLE_ID;
      link.rel = 'stylesheet';
      link.href = this.rootURI + 'valoracion.css';
      doc.documentElement.appendChild(link);
    }
  },

  removeFromWindow(window) {
    const doc = window.document;
    doc.getElementById(this.STYLE_ID)?.remove();
    doc.querySelector(`link[href="${this.FTL}"]`)?.remove();
  },

  // ---------- Strings ----------

  // The locale cannot change while Zotero is running, so every string is resolved once
  loadStrings() {
    const l10n = new Localization([this.FTL], true);
    const get = (id, args) => l10n.formatValueSync(`valoracion-${id}`, args) || id;
    const rate = [];
    for (let n = this.MIN; n <= this.MAX; n++) {
      rate[n] = get('rate-tooltip', { value: n });
    }
    this.strings = {
      label: get('label'),
      unrated: get('level-unrated'),
      excellent: get('level-excellent'),
      good: get('level-good'),
      fair: get('level-fair'),
      poor: get('level-poor'),
      veryPoor: get('level-very-poor'),
      clear: get('clear'),
      clearTooltip: get('clear-tooltip'),
      rate
    };
  },

  // ---------- Data ----------

  getValue(item) {
    if (!item || !item.isRegularItem()) return null;
    const extra = item.getField('extra');
    if (!extra) return null;
    const match = this.LINE_RE.exec(extra);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    return value >= this.MIN && value <= this.MAX ? value : null;
  },

  // Returns the Extra text with the rating line set to `value`, or removed if `value` is null.
  // An existing line keeps its position; a new one goes at the end.
  buildExtra(extra, value) {
    const rating = value ? `${this.EXTRA_KEY}: ${value}` : null;
    const lines = [];
    let placed = false;
    for (const line of extra ? extra.split('\n') : []) {
      if (!this.LINE_RE.test(line)) {
        lines.push(line);
      }
      else if (rating && !placed) {
        lines.push(rating);
        placed = true;
      }
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (rating && !placed) lines.push(rating);
    return lines.join('\n');
  },

  // Resolves to false when the item already had that rating and nothing was saved
  async setValue(item, value) {
    if (this.getValue(item) === value) return false;
    item.setField('extra', this.buildExtra(item.getField('extra'), value));
    // The undo options are used from Zotero 10 on and ignored by earlier versions
    await item.saveTx({
      undoAction: 'undo-action-edit-metadata',
      undoActionArgs: { count: 1 }
    });
    return true;
  },

  // ---------- Appearance ----------

  // Color band, matched by the [data-level] rules in valoracion.css
  level(value) {
    if (!value) return 'none';
    if (value >= 7) return 'high';
    if (value >= 4) return 'mid';
    return 'low';
  },

  describe(value) {
    const s = this.strings;
    if (!value) return s.unrated;
    if (value >= 9) return s.excellent;
    if (value >= 7) return s.good;
    if (value >= 4) return s.fair;
    if (value >= 2) return s.poor;
    return s.veryPoor;
  },

  el(doc, tag, className) {
    const node = doc.createElementNS(this.HTML_NS, tag);
    node.className = className;
    return node;
  },

  setBadge(badge, value) {
    badge.dataset.level = this.level(value);
    badge.textContent = value ? String(value) : '–';
  },

  // ---------- Item tree column ----------

  async registerColumn() {
    this.columnKey = await Zotero.ItemTreeManager.registerColumn({
      dataKey: 'valoracion',
      label: this.strings.label,
      pluginID: this.id,
      // The first click on the header sorts from best to worst
      sortReverse: true,
      width: '100',
      minWidth: 40,
      staticWidth: true,
      zoteroPersist: ['width', 'hidden', 'sortDirection'],
      // The tree sorts cells as text, so the value is zero-padded (02 < 10). Unrated items
      // return "00" rather than an empty string because Zotero puts empty cells first when
      // sorting in descending order, which would bury the best items under the unrated ones.
      dataProvider: (item) => String(this.getValue(item) || 0).padStart(2, '0'),
      renderCell: (index, data, column, isFirstColumn, doc) => {
        const cell = this.el(doc, 'span', `cell ${column.className} valoracion-cell`);
        const value = parseInt(data, 10);
        if (value) {
          const badge = this.el(doc, 'span', 'valoracion-badge');
          this.setBadge(badge, value);
          cell.append(badge);
        }
        return cell;
      }
    });
  },

  // ---------- Item pane section ----------

  registerSection() {
    const icon = this.rootURI + 'icon.svg';
    this.paneID = Zotero.ItemPaneManager.registerSection({
      paneID: 'valoracion',
      pluginID: this.id,
      header: { l10nID: 'valoracion-section-header', icon },
      sidenav: { l10nID: 'valoracion-section-sidenav', icon },
      onInit: ({ body }) => {
        this.buildSection(body);
      },
      onDestroy: ({ body }) => {
        this.sections.delete(body);
      },
      onItemChange: ({ item, setEnabled }) => {
        setEnabled(!!item && item.isRegularItem());
      },
      onRender: ({ body, item, editable, setSectionSummary }) => {
        const section = this.sections.get(body) || this.buildSection(body);
        section.item = item;
        section.editable = editable;
        section.setSummary = setSectionSummary;
        this.updateSection(section);
      }
    });
  },

  // Builds the section's DOM once; afterwards updateSection() only touches what changed
  buildSection(body) {
    const doc = body.ownerDocument;
    const s = this.strings;

    const badge = this.el(doc, 'span', 'valoracion-badge valoracion-badge-large');
    const description = this.el(doc, 'span', 'valoracion-description');
    const clear = this.el(doc, 'button', 'valoracion-clear');
    clear.textContent = s.clear;
    clear.title = s.clearTooltip;
    const summary = this.el(doc, 'div', 'valoracion-summary');
    summary.append(badge, description, clear);

    const scale = this.el(doc, 'div', 'valoracion-scale');
    scale.setAttribute('role', 'group');
    scale.setAttribute('aria-label', s.label);
    const options = [];
    for (let n = this.MIN; n <= this.MAX; n++) {
      const option = this.el(doc, 'button', 'valoracion-option');
      option.dataset.value = n;
      option.dataset.level = this.level(n);
      option.textContent = String(n);
      option.title = s.rate[n];
      options.push(option);
    }
    scale.append(...options);

    const section = {
      body, badge, description, options, clear,
      item: null, editable: false, setSummary: null, shown: null
    };
    const panel = this.el(doc, 'div', 'valoracion-panel');
    panel.append(summary, scale);
    // A single listener serves the ten rating buttons and the remove button
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button && !button.disabled) {
        this.rate(section, button.dataset.value ? Number(button.dataset.value) : null);
      }
    });
    body.replaceChildren(panel);
    this.sections.set(body, section);
    return section;
  },

  updateSection(section) {
    const { item, editable } = section;
    const value = this.getValue(item);
    if (section.setSummary) {
      section.setSummary(value ? `${value}/${this.MAX}` : '');
    }
    const shown = `${value}|${editable}`;
    if (section.shown === shown) return;
    section.shown = shown;

    this.setBadge(section.badge, value);
    section.description.textContent = this.describe(value);
    for (const option of section.options) {
      option.setAttribute('aria-pressed', Number(option.dataset.value) === value);
      option.disabled = !editable;
    }
    section.clear.disabled = !editable || !value;
  },

  async rate(section, value) {
    const { item, editable } = section;
    if (!item || !editable) return;
    try {
      await this.setValue(item, value);
      this.updateSection(section);
    }
    catch (e) {
      Zotero.logError(e);
    }
  },

  // Zotero.Notifier observer
  notify(event, type, ids) {
    if (type !== 'item' || (event !== 'modify' && event !== 'refresh')) return;
    for (const [body, section] of this.sections) {
      if (!body.isConnected) {
        this.sections.delete(body);
      }
      else if (section.item && ids.includes(section.item.id)) {
        this.updateSection(section);
      }
    }
  }
};
