# Changelog

## 1.1.0 — 2026-11-20

First public release.

- The interface is available in English and Spanish and follows Zotero's language, including the plugin's name and description in the plugin manager.
- Ratings are written to Extra as `Rating: N`. Lines written as `Valoración: N` by 1.0.0 are still read and are converted the next time the item is rated. A rating line keeps its place in Extra when it changes, and other `Rating:` lines that are not a number from 1 to 10 are left alone.
- Clicking the column header sorts from best to worst first, with unrated items at the end.
- The item pane section follows changes made elsewhere: undo, sync, or editing Extra by hand.
- The *Remove* button sits next to the score instead of wrapping below the scale.
- Clicking the rating an item already has no longer saves the item again.
- The section is built once and updated in place, and its styles moved to a stylesheet.
- Rating descriptions are now Excellent, Good, Fair, Poor and Very poor.
- Compatible with every Zotero 10 release.

## 1.0.0

Initial version, not published.
