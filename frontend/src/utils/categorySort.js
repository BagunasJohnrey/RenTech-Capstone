// Category display priority — lower number = appears first.
// Edit this map to reorder featured/recommended sections across the app.
const CATEGORY_PRIORITY = {
  Gown: 1,
  Barong: 2,
  Filipiniana: 3,
  Suit: 4,
  Costume: 5,
};
const DEFAULT_PRIORITY = 99;

export function categoryPriority(item) {
  const cat = (item.category || '').trim();
  // Exact match first, then partial (e.g. "Filipiniana Dress" matches "Filipiniana")
  if (CATEGORY_PRIORITY[cat] !== undefined) return CATEGORY_PRIORITY[cat];
  for (const [key, val] of Object.entries(CATEGORY_PRIORITY)) {
    if (cat.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return DEFAULT_PRIORITY;
}

/** Sort an array of items by category priority, then by ID (lowest first). */
export function sortByCategory(items) {
  return [...items].sort((a, b) => categoryPriority(a) - categoryPriority(b) || a.id - b.id);
}
