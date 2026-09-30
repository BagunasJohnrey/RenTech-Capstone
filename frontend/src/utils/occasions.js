// Occasion tags — which event an item fits (separate from garment `category`).
// Category stays as garment type (Gown/Suit/Barong/Filipiniana/Costume);
// occasions are multi-tags per item used for filtering + search.
export const OCCASIONS = [
  'Wedding',
  'Birthday',
  'Debut',
  'Graduation',
  'Corporate',
  'Gala',
  'Party',
  'Photoshoot',
  'Costume Party',
];

// Starter suggestions per garment category so staff tagging is one tap.
// Editable per item — these are defaults, not rules.
export const OCCASIONS_BY_CATEGORY = {
  Gown: ['Wedding', 'Debut', 'Gala', 'Birthday'],
  Suit: ['Wedding', 'Corporate', 'Graduation'],
  Barong: ['Wedding', 'Corporate', 'Graduation'],
  Filipiniana: ['Wedding', 'Graduation', 'Corporate', 'Gala'],
  Costume: ['Birthday', 'Party', 'Costume Party', 'Photoshoot'],
};

export function normalizeOccasions(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

export function itemOccasions(item) {
  return normalizeOccasions(item?.occasions);
}

export function matchesOccasions(item, selected) {
  if (!selected || selected.length === 0) return true;
  const tags = itemOccasions(item).map((t) => t.toLowerCase());
  return selected.some((s) => tags.includes(String(s).toLowerCase()));
}

export function matchesOccasionQuery(item, q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return false;
  return itemOccasions(item).some((t) => t.toLowerCase().includes(query));
}
