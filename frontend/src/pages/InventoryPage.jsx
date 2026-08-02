import CatalogView from './CatalogView';

// Route-level container for the inventory/catalog screen.
// Assembles the presentational <CatalogView /> with data + handlers (SoC).
export default function InventoryPage(props) {
  return <CatalogView {...props} />;
}
