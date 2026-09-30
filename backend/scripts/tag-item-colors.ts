/**
 * One-shot color tagger for the seeded boutique catalog.
 *
 * Tags were assigned by visually inspecting the actual seed photos in
 * Images/ (ambiguous pieces viewed individually; descriptive names like
 * "Scarlet Lace" / "Midnight Sequin" taken at face value). Uses the fixed
 * COLORS vocabulary in frontend/src/utils/colors.js plus one deliberate
 * custom ("Sage", used by 2 items) — no other free text.
 *
 * Safe: matches DB rows by lowercased name and only touches rows whose
 * colors are currently empty. Re-running changes nothing.
 *   npx tsx scripts/tag-item-colors.ts [--dry-run]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');

// [exact item name, colors]
const TAGS: [string, string[]][] = [
  // ---- Gowns (19) ----
  ['Champagne Gold Lace Debut Gown', ['Champagne', 'Gold']],
  ['Ivory Baroque Debut Gown', ['White']],
  ['Sage Enchanted Debut Gown', ['Sage', 'Green']],
  ['Blush Satin Debut Gown', ['Pink']],
  ['Aqua Lace Debut Gown', ['Blue']],
  ['Champagne Strapless Debut Gown', ['Champagne']],
  ['Coral Pink Debut Gown', ['Pink']],
  ['Dusty Blue Debut Gown', ['Blue']],
  ['Golden Belle Debut Gown', ['Gold']],
  ['Silver Mist Debut Gown', ['Silver']],
  ['Royal Gold Cap-Sleeve Gown', ['Gold']],
  ['Scarlet Lace Debut Gown', ['Red']],
  ['Peach Ruffle Debut Gown', ['Peach']],
  ['Midnight Sequin Debut Gown', ['Black']],
  ['Onyx and Gold Brocade Gown', ['Black', 'Gold']],
  ['Rose Peplum Debut Gown', ['Pink']],
  ['Champagne Glitter Debut Gown', ['Champagne', 'Gold']],
  ['Royal Sapphire Debut Gown', ['Blue']],
  ['Blush Corset Debut Gown', ['Pink']],
  // ---- Barong (20, verified against photos where ambiguous) ----
  ['Ivory Coat Barong', ['White']],
  ['Classic White Floral Barong', ['White']],
  ['Cream Pina Barong', ['Cream']],
  ['Ivory Double-Breast Barong', ['White']],
  ['Black and Gold Gala Barong', ['Black', 'Gold']],
  ['Ivory Geometric Barong', ['White']],
  ['Blush Swirl Barong', ['Pink']],
  ['Navy Beaded Barong', ['Navy']],
  ['Silver Grey Beaded Barong', ['Silver', 'Gray']],
  ['Classic Cream Barong', ['Cream']],
  ['Monochrome Stripe Barong', ['White', 'Black']],
  ['Steel Blue Floral Barong', ['Blue']],
  ['Bandila Barong Tagalog', ['Cream', 'Blue', 'Red', 'Gold']],
  ['Onyx Ornate Barong', ['Black']],
  ['Mauve Classic Barong', ['Pink']],
  ['Maroon Ombre Barong', ['Maroon']],
  ['Peacock Feather Barong', ['White', 'Black']],
  ['Sage Weave Barong', ['Sage', 'Green']],
  ['Peach Ombre Barong', ['Peach']],
  ['Ivory Noir Coat Barong', ['White', 'Black']],
  // ---- Filipiniana (20) ----
  ['Zebra Trim Filipiniana Set', ['White', 'Black']],
  ['Cream Lace Mestiza Set', ['Cream']],
  ['Charcoal Beaded Mestiza Set', ['Gray']],
  ['Rosegold Sequin Mestiza Set', ['Pink', 'Gold']],
  ['Ivory Embroidered Terno', ['White']],
  ['Onyx Sequin Terno', ['Black']],
  ['Royal Satin Mestiza Set', ['Blue', 'Gold']],
  ['Noir Lace Mestiza Set', ['Black']],
  ['Scarlet Gold Mestiza Set', ['Red', 'Gold']],
  ['Golden Jusi Ensemble', ['Gold']],
  ['Perlas Mermaid Terno', ['White']],
  ['Golden Sheath Terno', ['Gold']],
  ['White Pluma Terno Dress', ['White']],
  ['Inabel Shawl Ensemble', ['White', 'Black']],
  ['Ivory Embroidered Terno Top', ['White']],
  ['Scarlet Mermaid Terno', ['Red']],
  ['Emerald Bolero Sequin Set', ['Emerald']],
  ['Tribal Weave Bolero Set', ['White', 'Black']],
  ['Earth Weave Bolero Set', ['Brown', 'White']],
  ['Blanco Mini Terno', ['White']],
  // ---- Suits (26) ----
  ['Classic Black Tuxedo Jacket', ['Black']],
  ['Midnight Tuxedo Set', ['Black']],
  ['Chestnut Brown Suit', ['Brown']],
  ['Royal Blue Suit Set', ['Blue']],
  ['Navy Double-Breasted Tuxedo', ['Navy']],
  ['Slate Blue Suit Set', ['Blue']],
  ['Chestnut Plaid Groom Suit', ['Brown']],
  ['Emerald Windowpane Suit', ['Emerald']],
  ['Burgundy Windowpane Suit', ['Maroon']],
  ['Golden Brocade Tuxedo', ['Gold']],
  ['Ivory Brocade Tuxedo', ['White']],
  ['Noir Groom Tuxedo', ['Black']],
  ['Ivory Double-Breasted Suit', ['White']],
  ['Emerald Double-Breasted Suit', ['Emerald']],
  ['Navy Chairman Suit', ['Navy']],
  ['White Tie Tuxedo', ['White']],
  ['Mint Green Suit', ['Green']],
  ['White Executive Suit', ['White']],
  ['Ivory Groom Suit', ['White']],
  ['White Shawl Tuxedo', ['White']],
  ['Classic Black Tie Set', ['Black']],
  ['Sky Plaid Three-Piece Suit', ['Blue']],
  ['Chocolate Three-Piece Suit', ['Brown']],
  ['Slate Three-Piece Suit', ['Gray']],
  ['Charcoal Three-Piece Suit', ['Gray']],
  ['Cream Pinstripe Suit', ['Cream']],
  // ---- Costumes (25, verified against photos where ambiguous) ----
  ['T-Rex Inflatable Costume', ['Green']],
  ['Raptor Inflatable Costume', ['Green']],
  ['Starfish Buddy Inflatable Costume', ['Pink', 'Green', 'Purple']],
  ['Creepy Clown Inflatable Costume', ['Gray', 'Red', 'White']],
  ['Santa Inflatable Costume', ['Red', 'White', 'Black']],
  ['Grim Reaper Carry-Me Costume', ['Black']],
  ['Alien Abduction Costume', ['Green', 'Blue', 'Red', 'Black']],
  ['Orange Cat Inflatable Costume', ['Orange']],
  ['Cow Ride-On Costume', ['Black', 'White']],
  ['Chubby Kid Inflatable Costume', ['Red', 'Yellow', 'Brown', 'Blue']],
  ['Red Candy Mascot Costume', ['Red']],
  ['Wizard School Robe Set (Kids)', ['Black']],
  ['Sea King Muscle Costume', ['Gold', 'Green']],
  ['Cat Burglar Catsuit Costume', ['Black']],
  ['Jester Girl Costume', ['Red', 'Blue', 'Pink', 'White', 'Black']],
  ['Steel Hero Muscle Costume', ['Blue', 'Red', 'Gold']],
  ['Dark Knight Costume', ['Black', 'Gray']],
  ['Super Dad Costume', ['Blue', 'Red', 'Gold']],
  ['Scarlet Speedster Costume', ['Red', 'Gold']],
  ['Amazon Warrior Costume', ['Red', 'Blue', 'Gold']],
  ['Wooden Bat Meme Costume', ['Orange']],
  ['White Hood Assassin Costume', ['White']],
  ['Kaiju Inflatable Costume', ['Green']],
  ['Horror Nun Costume', ['Black', 'White']],
  ['Creepy Clown Costume (Kids)', ['Gray', 'Red', 'White']],
];

async function main() {
  console.log(`=== Color tagger (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===`);
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.inventoryItem.findMany({ select: { id: true, name: true, colors: true } });
    const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
    let updated = 0, skippedFilled = 0;
    const missing: string[] = [];
    for (const [name, colors] of TAGS) {
      const row = byName.get(name.toLowerCase());
      if (!row) { missing.push(name); continue; }
      if (row.colors.length > 0) { skippedFilled++; continue; }
      if (!DRY_RUN) {
        await prisma.inventoryItem.update({ where: { id: row.id }, data: { colors } });
      }
      updated++;
    }
    console.log(`matched=${TAGS.length - missing.length} updated=${updated} already-tagged=${skippedFilled} missing=${missing.length}`);
    if (missing.length) console.log('missing in DB:', missing.join(' | '));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
