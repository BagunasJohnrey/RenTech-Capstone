import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Business Rules
  const rules = [
    { key: 'late_penalty_per_day', value: '500', description: 'Late return penalty per day in PHP' },
    { key: 'damage_fee', value: '1000', description: 'Damage fee in PHP' },
    { key: 'rental_period_days', value: '3', description: 'Default rental period in days' },
    { key: 'min_downpayment', value: '200', description: 'Minimum downpayment in PHP' },
  ];

  for (const rule of rules) {
    await prisma.businessRule.upsert({
      where: { key: rule.key },
      update: { value: rule.value, description: rule.description },
      create: rule,
    });
  }

  // SMS Templates
  const templates = [
    {
      name: 'booking_confirmation',
      content: 'Hi {customer}, your booking for {item} is confirmed! Pickup date: {date}. Rental period: 3 days. Thank you for choosing Mylene\'s Boutique!',
      isDefault: true,
    },
    {
      name: 'due_reminder',
      content: 'Hi {customer}, this is a reminder that your rental of {item} is due on {date}. Please return on time. Thank you!',
      isDefault: true,
    },
    {
      name: 'late_return',
      content: 'Hi {customer}, your rental of {item} is now overdue ({days} day(s)). Please return as soon as possible. Thank you!',
      isDefault: true,
    },
  ];

  for (const template of templates) {
    await prisma.smsTemplate.upsert({
      where: { id: template.name },
      update: template,
      create: { id: template.name, ...template },
    });
  }

  // Inventory Items
  const items = [
    { id: 1001, name: 'A-Line Ivory Lace Wedding Gown', category: 'Gown', price: 7500, status: 'Rented' as const, image: 'https://www.ivoryandwhitebridal.com/wp-content/uploads/2025/08/Veronica-14.webp' },
    { id: 1002, name: 'Emerald Silk Mermaid Evening Gown', category: 'Gown', price: 4500, status: 'Available' as const, image: 'https://www.misshow.com/cdn/shop/files/Elegant-Stunning-Off-the-Shoulder-Mermaid-Prom-Evening-Dresses-Ruffles-With-Split.jpg?v=1763109918' },
    { id: 1003, name: 'Midnight Black Peak Lapel Tuxedo', category: 'Suit', price: 3800, status: 'Available' as const, image: 'https://ainsleyandtroupe.com/cdn/shop/files/C6FAEB1D-7C1E-46FC-BCD1-1477043E1A80_900x.jpg?v=1701724313' },
    { id: 1004, name: 'Modern Charcoal Grey Slim Suit', category: 'Suit', price: 3200, status: 'Available' as const, image: 'https://andreemilio.com/wp-content/uploads/2021/06/243a-Web-2.jpg' },
    { id: 1005, name: 'Hand-Embroidered Piña Barong', category: 'Barong', price: 3500, status: 'Rented' as const, image: 'https://ibarrafilipino.com/cdn/shop/files/Barong_Tagalog_JV402_05.png?v=1769482029&width=1600' },
    { id: 1006, name: 'Burgundy Velvet Debutante Ball Gown', category: 'Gown', price: 6500, status: 'Available' as const, image: 'https://images.unsplash.com/photo-1568252542512-9fe8fe9c87bb?w=800&q=80' },
    { id: 1007, name: 'Navy Blue Windowpane Check Suit', category: 'Suit', price: 3400, status: 'Maintenance' as const, image: 'https://i.etsystatic.com/27528860/r/il/a0dfcf/3998770015/il_570xN.3998770015_q0j2.jpg' },
    { id: 1008, name: 'Organza Barong with Geometric Patterns', category: 'Barong', price: 2800, status: 'Available' as const, image: 'https://barongsrus.com/wp-content/uploads/2023/08/1070A_SMM.jpg' },
    { id: 1009, name: 'Champagne Satin Bridesmaid Midi', category: 'Gown', price: 2500, status: 'Available' as const, image: 'https://www.fancyvestido.com/cdn/shop/files/FV12459_3_1000x.jpg?v=1700880311' },
    { id: 1010, name: 'Bohemian Bell-Sleeve Lace Gown', category: 'Gown', price: 5800, status: 'Available' as const, image: 'https://i.etsystatic.com/6198584/r/il/8b1a08/6703113978/il_fullxfull.6703113978_by68.jpg' },
    { id: 1011, name: 'Forest Green 3-Piece Wool Suit', category: 'Suit', price: 3800, status: 'Available' as const, image: 'https://i.pinimg.com/1200x/77/49/8b/77498bef8f7d20fed02a499253c3beef.jpg' },
    { id: 1012, name: 'Dusty Rose Tulle Evening Dress', category: 'Gown', price: 3200, status: 'Available' as const, image: 'https://joyofdress.com/cdn/shop/products/SkU1-Pink-183-04.jpg?v=1681110260&width=900' },
    { id: 1013, name: 'Tan Linen Summer Suit', category: 'Suit', price: 2900, status: 'Available' as const, image: 'https://i.pinimg.com/736x/20/eb/08/20eb08cd641196a6fbbf180813884d12.jpg' },
    { id: 1014, name: 'Premium Silk Cocoon Barong Tagalog', category: 'Barong', price: 4200, status: 'Available' as const, image: 'https://ibarrafilipino.com/cdn/shop/files/Groomsmen_Barong_Tagalog_BF003_02.webp?v=1769484468&width=1024' },
    { id: 1015, name: 'Midnight Blue Off-Shoulder Cocktail Dress', category: 'Gown', price: 2800, status: 'Available' as const, image: 'https://shopluu.com/cdn/shop/files/13_3dee1c37-aec9-4e86-8b1f-35fd48908bf9_2400x.jpg?v=1698653630' },
    { id: 1016, name: 'Light Blue Modern Fit Wedding Suit', category: 'Suit', price: 3500, status: 'Rented' as const, image: 'https://cdn11.bigcommerce.com/s-zgtjv8ylt8/images/stencil/1280x1280/products/5710/21493/mens-modern-fit-pastel-color-suit-with-vest-light-blue-mv2k-2-mens-modern-fit-pastel-color-suit-with-vest-light-blue-mv2k-2__82945.1738454329.jpg?c=1' },
    { id: 1017, name: 'Modern Mestiza Gown with Butterfly Sleeves', category: 'Filipiniana', price: 4800, status: 'Available' as const, image: 'https://i.pinimg.com/564x/ce/ef/eb/ceefebb85aae02b7b79a05707f2db74a.jpg' },
    { id: 1018, name: 'Hand-Painted Maria Clara Ensembles', category: 'Filipiniana', price: 5200, status: 'Available' as const, image: 'https://cmcbaronglv.com/cdn/shop/files/1_d5ba90b4-d664-40db-8bed-ef53a23792e5.png?v=1748915935&width=713' },
    { id: 1019, name: 'Inabel Weave Accent Formal Gown', category: 'Filipiniana', price: 4200, status: 'Available' as const, image: 'https://barongworld.com/cdn/shop/files/1_702584ae-bdab-47ab-a0c7-7745babd6259.png?v=1770881896' },
    { id: 1021, name: 'Gothic Enchantress Midnight Gown', category: 'Costume', price: 3800, status: 'Available' as const, image: 'https://www.nuclearblast.com/cdn/shop/files/dw780__001_1024x1024_2x_68819c5f-1410-4cb3-bfdb-a0d94bbe4746.jpg?v=1764704481&width=800' },
    { id: 1023, name: 'Premium Professional Santa Claus Suit', category: 'Costume', price: 4500, status: 'Available' as const, image: 'https://m.media-amazon.com/images/I/618k-wiwF9L._AC_UY1000_.jpg' },
    { id: 1024, name: 'Classic Red Superhero Spandex Suit', category: 'Costume', price: 2500, status: 'Available' as const, image: 'https://i.etsystatic.com/61078232/r/il/962ddf/7842235899/il_fullxfull.7842235899_ks0j.jpg' },
  ];

  for (const item of items) {
    await prisma.inventoryItem.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
  }

  console.log('Seed data inserted successfully');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
