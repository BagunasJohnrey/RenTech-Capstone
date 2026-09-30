// Staff-only color tags — which colors an item comes in. Fixed vocabulary
// (never free text) so "red" always matches "red", never "Red"/"reddish".
// Never rendered on item cards (customer or staff); used for the catalog
// Colors filter, text search, and RAG color matching ("green theme gowns").
export const COLORS = [
  'Black',
  'White',
  'Cream',
  'Beige',
  'Brown',
  'Gray',
  'Silver',
  'Navy',
  'Blue',
  'Teal',
  'Green',
  'Emerald',
  'Red',
  'Maroon',
  'Pink',
  'Peach',
  'Gold',
  'Yellow',
  'Orange',
  'Purple',
  'Lavender',
  'Champagne',
];

export function normalizeColors(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

export function itemColors(item) {
  return normalizeColors(item?.colors);
}

export function matchesColors(item, selected) {
  if (!selected || selected.length === 0) return true;
  const tags = itemColors(item).map((t) => t.toLowerCase());
  return selected.some((s) => tags.includes(String(s).toLowerCase()));
}

export function matchesColorQuery(item, q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return false;
  return itemColors(item).some((t) => t.toLowerCase().includes(query));
}
