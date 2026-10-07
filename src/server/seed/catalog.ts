/**
 * Static reference data for the CornerOps demo tenant: Casa Norte Mexican Kitchen.
 * Everything else (orders, stock, movements) is generated from this catalog.
 */
import type { OrderChannel } from "@/domain/channels/types";
import type { InventoryUnit } from "@/domain/inventory/types";

export const ORG_ID = "org_cornerops_demo";
export const RESTAURANT_ID = "rst_casa_norte";

export interface LocationSeed {
  id: string;
  name: string;
  code: string;
  area: string;
  address: string;
  open: string;
  close: string;
  kitchenCapacity: number;
  managerName: string;
  dailyOrders: number;
  basePrepMinutes: number;
  /** Multiplier applied to today's prep times (tells an operational story). */
  todayPrepFactor: number;
  channelShare: Record<OrderChannel, number>;
  externalStoreIds: Partial<Record<OrderChannel, string>>;
}

export const LOCATIONS: LocationSeed[] = [
  {
    id: "loc_marina",
    name: "Dubai Marina",
    code: "DXM",
    area: "Dubai Marina",
    address: "Marina Walk, Al Majara Tower 2, Shop 4",
    open: "11:00",
    close: "01:00",
    kitchenCapacity: 14,
    managerName: "Omar Haddad",
    dailyOrders: 62,
    basePrepMinutes: 14.6,
    todayPrepFactor: 1.21,
    channelShare: { talabat: 0.4, deliveroo: 0.24, noon: 0.11, keeta: 0.09, direct: 0.1, whatsapp: 0.06 },
    externalStoreIds: {
      talabat: "TLB-CN-MARINA",
      deliveroo: "roo-dxb-19842",
      noon: "NF-OUT-7731",
      keeta: "60012871",
      direct: "marina",
      whatsapp: "CN-WA-MARINA",
    },
  },
  {
    id: "loc_bbay",
    name: "Business Bay",
    code: "BBY",
    area: "Business Bay",
    address: "Bay Square, Building 7, Unit G02",
    open: "11:00",
    close: "00:00",
    kitchenCapacity: 12,
    managerName: "Priya Menon",
    dailyOrders: 52,
    basePrepMinutes: 13.4,
    todayPrepFactor: 1.02,
    channelShare: { talabat: 0.43, deliveroo: 0.27, noon: 0.13, keeta: 0, direct: 0.11, whatsapp: 0.06 },
    externalStoreIds: {
      talabat: "TLB-CN-BBAY",
      deliveroo: "roo-dxb-20517",
      noon: "NF-OUT-7732",
      direct: "business-bay",
      whatsapp: "CN-WA-BBAY",
    },
  },
  {
    id: "loc_jvc",
    name: "JVC",
    code: "JVC",
    area: "Jumeirah Village Circle",
    address: "Circle Mall, Ground Level, Unit 18",
    open: "11:00",
    close: "00:00",
    kitchenCapacity: 10,
    managerName: "Daniel Reyes",
    dailyOrders: 42,
    basePrepMinutes: 14.1,
    todayPrepFactor: 1.33,
    channelShare: { talabat: 0.46, deliveroo: 0.16, noon: 0.12, keeta: 0.14, direct: 0.06, whatsapp: 0.06 },
    externalStoreIds: {
      talabat: "TLB-CN-JVC",
      deliveroo: "roo-dxb-21003",
      noon: "NF-OUT-7790",
      keeta: "60013050",
      direct: "jvc",
      whatsapp: "CN-WA-JVC",
    },
  },
];

export interface IngredientSeed {
  key: string;
  name: string;
  category: string;
  unit: InventoryUnit;
  par: number;
  unitCost: number;
  supplier: string;
}

export const INGREDIENTS: IngredientSeed[] = [
  { key: "chicken", name: "Chicken thigh, boneless", category: "Protein", unit: "kg", par: 30, unitCost: 24, supplier: "Al Islami Foods" },
  { key: "beef_short_rib", name: "Beef short rib (birria)", category: "Protein", unit: "kg", par: 22, unitCost: 68, supplier: "Meat One" },
  { key: "beef_flank", name: "Beef flank steak", category: "Protein", unit: "kg", par: 15, unitCost: 72, supplier: "Meat One" },
  { key: "white_fish", name: "White fish fillet (hammour)", category: "Seafood", unit: "kg", par: 8, unitCost: 85, supplier: "Blue Ocean Seafood" },
  { key: "shrimp", name: "Shrimp, peeled", category: "Seafood", unit: "kg", par: 8, unitCost: 78, supplier: "Blue Ocean Seafood" },
  { key: "mushrooms", name: "Mushrooms", category: "Produce", unit: "kg", par: 6, unitCost: 22, supplier: "Barakat" },
  { key: "corn_tortillas", name: "Corn tortillas 6\"", category: "Dry goods", unit: "pcs", par: 900, unitCost: 0.45, supplier: "La Tortilleria DXB" },
  { key: "flour_tortillas", name: "Flour tortillas 12\"", category: "Dry goods", unit: "pcs", par: 260, unitCost: 1.1, supplier: "La Tortilleria DXB" },
  { key: "oaxaca", name: "Oaxaca cheese", category: "Dairy", unit: "kg", par: 12, unitCost: 58, supplier: "Gourmet Dairy Co." },
  { key: "cheddar", name: "Jack & cheddar blend", category: "Dairy", unit: "kg", par: 10, unitCost: 42, supplier: "Gourmet Dairy Co." },
  { key: "sour_cream", name: "Crema", category: "Dairy", unit: "kg", par: 8, unitCost: 26, supplier: "Gourmet Dairy Co." },
  { key: "avocados", name: "Hass avocados", category: "Produce", unit: "pcs", par: 180, unitCost: 3.2, supplier: "Barakat" },
  { key: "tomatoes", name: "Tomatoes", category: "Produce", unit: "kg", par: 20, unitCost: 6, supplier: "Barakat" },
  { key: "onions", name: "White onions", category: "Produce", unit: "kg", par: 18, unitCost: 4, supplier: "Barakat" },
  { key: "cilantro", name: "Cilantro", category: "Produce", unit: "bunch", par: 60, unitCost: 2.5, supplier: "Barakat" },
  { key: "limes", name: "Limes", category: "Produce", unit: "pcs", par: 400, unitCost: 0.4, supplier: "Barakat" },
  { key: "jalapenos", name: "Jalapeños", category: "Produce", unit: "kg", par: 5, unitCost: 18, supplier: "Barakat" },
  { key: "rice", name: "Long-grain rice", category: "Dry goods", unit: "kg", par: 25, unitCost: 7, supplier: "Emirates Foodstuff" },
  { key: "pinto_beans", name: "Pinto beans", category: "Dry goods", unit: "kg", par: 18, unitCost: 9, supplier: "Emirates Foodstuff" },
  { key: "corn_cobs", name: "Sweet corn cobs", category: "Produce", unit: "pcs", par: 120, unitCost: 1.8, supplier: "Barakat" },
  { key: "tortilla_chips", name: "Tortilla chips", category: "Dry goods", unit: "kg", par: 18, unitCost: 16, supplier: "La Tortilleria DXB" },
  { key: "consome", name: "Birria consomé (batch)", category: "Prepared", unit: "L", par: 30, unitCost: 12, supplier: "Central kitchen" },
  { key: "horchata_base", name: "Horchata base", category: "Beverage", unit: "L", par: 25, unitCost: 9, supplier: "Central kitchen" },
  { key: "hibiscus", name: "Jamaica (hibiscus) concentrate", category: "Beverage", unit: "L", par: 12, unitCost: 14, supplier: "Central kitchen" },
  { key: "tamarind", name: "Tamarind concentrate", category: "Beverage", unit: "L", par: 10, unitCost: 13, supplier: "Central kitchen" },
  { key: "mexican_coke", name: "Mexican Coca-Cola 355ml", category: "Beverage", unit: "pcs", par: 240, unitCost: 4.5, supplier: "Emirates Foodstuff" },
  { key: "churro_dough", name: "Churro dough", category: "Pastry", unit: "kg", par: 8, unitCost: 15, supplier: "Central kitchen" },
  { key: "tres_leches", name: "Tres leches (portion)", category: "Pastry", unit: "pcs", par: 40, unitCost: 7, supplier: "Central kitchen" },
  { key: "packaging", name: "Delivery packaging set", category: "Packaging", unit: "pcs", par: 1200, unitCost: 0.9, supplier: "Hotpack" },
];

/**
 * Engineered stock positions (fraction of threshold) that make the demo tell a
 * story. Everything not listed is generated in the healthy range.
 */
export const STOCK_SCENARIOS: Record<string, Record<string, number>> = {
  loc_marina: { chicken: 0.84, beef_short_rib: 0.41, avocados: 0.92 },
  loc_bbay: { churro_dough: 0.38, limes: 0.9 },
  loc_jvc: { hibiscus: 0, beef_flank: 0.78, cilantro: 0.45 },
};

export const CATEGORIES = [
  { id: "cat_tacos", name: "Tacos" },
  { id: "cat_bowls", name: "Burritos & Bowls" },
  { id: "cat_quesadillas", name: "Quesadillas" },
  { id: "cat_starters", name: "Starters" },
  { id: "cat_sides", name: "Sides" },
  { id: "cat_desserts", name: "Desserts" },
  { id: "cat_drinks", name: "Drinks" },
] as const;

export interface MenuSeed {
  sku: string;
  categoryId: (typeof CATEGORIES)[number]["id"];
  name: string;
  description: string;
  price: number;
  prep: number;
  emoji: string;
  popularity: number;
  tags: string[];
  recipe: [string, number][];
}

export const MENU: MenuSeed[] = [
  { sku: "CN-TAC-001", categoryId: "cat_tacos", name: "Birria Tacos", description: "Three slow-braised beef tacos, Oaxaca cheese, onion, cilantro, consomé for dipping.", price: 58, prep: 12, emoji: "🌮", popularity: 10, tags: ["signature"], recipe: [["beef_short_rib", 0.18], ["corn_tortillas", 3], ["oaxaca", 0.06], ["consome", 0.25], ["onions", 0.02], ["cilantro", 0.1], ["limes", 1], ["packaging", 1]] },
  { sku: "CN-TAC-002", categoryId: "cat_tacos", name: "Chicken Tinga Tacos", description: "Three tacos with chipotle-stewed chicken, crema and pickled onion.", price: 46, prep: 10, emoji: "🌮", popularity: 8, tags: [], recipe: [["chicken", 0.18], ["corn_tortillas", 3], ["sour_cream", 0.03], ["onions", 0.03], ["tomatoes", 0.05], ["cilantro", 0.1], ["limes", 1], ["packaging", 1]] },
  { sku: "CN-TAC-003", categoryId: "cat_tacos", name: "Carne Asada Tacos", description: "Three grilled flank-steak tacos, avocado salsa, onion and cilantro.", price: 54, prep: 11, emoji: "🌮", popularity: 6, tags: [], recipe: [["beef_flank", 0.17], ["corn_tortillas", 3], ["avocados", 0.5], ["onions", 0.02], ["cilantro", 0.1], ["limes", 1], ["packaging", 1]] },
  { sku: "CN-TAC-004", categoryId: "cat_tacos", name: "Baja Fish Tacos", description: "Three crispy hammour tacos, chipotle crema, cabbage slaw.", price: 52, prep: 11, emoji: "🐟", popularity: 5, tags: [], recipe: [["white_fish", 0.15], ["corn_tortillas", 3], ["sour_cream", 0.03], ["limes", 1], ["packaging", 1]] },
  { sku: "CN-TAC-005", categoryId: "cat_tacos", name: "Camarón Tacos", description: "Three garlic-chili shrimp tacos with avocado and jalapeño.", price: 56, prep: 11, emoji: "🍤", popularity: 4, tags: [], recipe: [["shrimp", 0.14], ["corn_tortillas", 3], ["avocados", 0.5], ["jalapenos", 0.02], ["packaging", 1]] },
  { sku: "CN-TAC-006", categoryId: "cat_tacos", name: "Hongos Tacos", description: "Three roasted mushroom tacos, Oaxaca cheese, salsa verde.", price: 42, prep: 9, emoji: "🍄", popularity: 3, tags: ["vegetarian"], recipe: [["mushrooms", 0.18], ["corn_tortillas", 3], ["oaxaca", 0.05], ["cilantro", 0.1], ["packaging", 1]] },
  { sku: "CN-BWL-001", categoryId: "cat_bowls", name: "Birria Bowl", description: "Birria beef over Mexican rice, beans, Oaxaca cheese and consomé.", price: 62, prep: 12, emoji: "🥣", popularity: 7, tags: ["signature", "promo"], recipe: [["beef_short_rib", 0.2], ["rice", 0.15], ["pinto_beans", 0.1], ["consome", 0.2], ["oaxaca", 0.04], ["packaging", 1]] },
  { sku: "CN-BUR-001", categoryId: "cat_bowls", name: "Chicken Burrito", description: "Flour tortilla, chicken tinga, rice, beans, cheese and crema.", price: 55, prep: 10, emoji: "🌯", popularity: 7, tags: [], recipe: [["chicken", 0.2], ["flour_tortillas", 1], ["rice", 0.12], ["pinto_beans", 0.1], ["cheddar", 0.05], ["sour_cream", 0.03], ["packaging", 1]] },
  { sku: "CN-BUR-002", categoryId: "cat_bowls", name: "Carne Asada Burrito", description: "Grilled steak, rice, beans, cheese and fresh avocado.", price: 64, prep: 11, emoji: "🌯", popularity: 5, tags: [], recipe: [["beef_flank", 0.2], ["flour_tortillas", 1], ["rice", 0.12], ["pinto_beans", 0.1], ["cheddar", 0.05], ["avocados", 0.5], ["packaging", 1]] },
  { sku: "CN-BWL-002", categoryId: "cat_bowls", name: "Chicken Burrito Bowl", description: "Chicken tinga, rice, beans, pico de gallo and avocado.", price: 52, prep: 9, emoji: "🥗", popularity: 5, tags: [], recipe: [["chicken", 0.18], ["rice", 0.15], ["pinto_beans", 0.1], ["tomatoes", 0.05], ["avocados", 0.5], ["packaging", 1]] },
  { sku: "CN-BWL-003", categoryId: "cat_bowls", name: "Veggie Burrito Bowl", description: "Roasted mushrooms, street corn, rice, beans and avocado.", price: 46, prep: 8, emoji: "🥗", popularity: 3, tags: ["vegetarian"], recipe: [["mushrooms", 0.12], ["rice", 0.15], ["pinto_beans", 0.12], ["corn_cobs", 0.5], ["avocados", 0.5], ["packaging", 1]] },
  { sku: "CN-QSD-001", categoryId: "cat_quesadillas", name: "Birria Quesadilla", description: "Crispy quesadilla with birria beef and Oaxaca, served with consomé.", price: 56, prep: 10, emoji: "🧀", popularity: 6, tags: ["signature"], recipe: [["beef_short_rib", 0.15], ["flour_tortillas", 1], ["oaxaca", 0.1], ["consome", 0.2], ["packaging", 1]] },
  { sku: "CN-QSD-002", categoryId: "cat_quesadillas", name: "Chicken Quesadilla", description: "Chicken tinga and melted cheese in a griddled flour tortilla.", price: 45, prep: 8, emoji: "🧀", popularity: 5, tags: [], recipe: [["chicken", 0.14], ["flour_tortillas", 1], ["cheddar", 0.1], ["packaging", 1]] },
  { sku: "CN-QSD-003", categoryId: "cat_quesadillas", name: "Three-Cheese Quesadilla", description: "Oaxaca, jack and cheddar with salsa roja.", price: 38, prep: 7, emoji: "🧀", popularity: 3, tags: ["vegetarian"], recipe: [["flour_tortillas", 1], ["oaxaca", 0.08], ["cheddar", 0.08], ["packaging", 1]] },
  { sku: "CN-STR-001", categoryId: "cat_starters", name: "Nachos Supremos", description: "Tortilla chips, cheese sauce, beans, jalapeño, crema and guacamole.", price: 44, prep: 7, emoji: "🧆", popularity: 6, tags: ["sharing"], recipe: [["tortilla_chips", 0.18], ["cheddar", 0.1], ["pinto_beans", 0.08], ["jalapenos", 0.03], ["sour_cream", 0.04], ["avocados", 0.5], ["packaging", 1]] },
  { sku: "CN-STR-002", categoryId: "cat_starters", name: "Guacamole & Chips", description: "Hand-smashed guacamole with warm tortilla chips.", price: 34, prep: 5, emoji: "🥑", popularity: 7, tags: ["vegetarian"], recipe: [["avocados", 2], ["tortilla_chips", 0.12], ["tomatoes", 0.04], ["onions", 0.02], ["cilantro", 0.1], ["limes", 1], ["packaging", 1]] },
  { sku: "CN-STR-003", categoryId: "cat_starters", name: "Elote", description: "Grilled street corn, crema, cotija and chili-lime.", price: 24, prep: 6, emoji: "🌽", popularity: 5, tags: ["vegetarian"], recipe: [["corn_cobs", 1], ["sour_cream", 0.03], ["cheddar", 0.02], ["limes", 0.5], ["packaging", 1]] },
  { sku: "CN-STR-004", categoryId: "cat_starters", name: "Queso Fundido", description: "Molten Oaxaca cheese with roasted jalapeño and chips.", price: 38, prep: 8, emoji: "🫕", popularity: 3, tags: ["sharing"], recipe: [["oaxaca", 0.15], ["jalapenos", 0.02], ["tortilla_chips", 0.08], ["packaging", 1]] },
  { sku: "CN-STR-005", categoryId: "cat_starters", name: "Chips & Salsa", description: "Tortilla chips with salsa roja and salsa verde.", price: 18, prep: 3, emoji: "🌶️", popularity: 4, tags: ["vegan"], recipe: [["tortilla_chips", 0.1], ["tomatoes", 0.06], ["onions", 0.02], ["jalapenos", 0.01], ["packaging", 1]] },
  { sku: "CN-SID-001", categoryId: "cat_sides", name: "Mexican Rice", description: "Tomato-braised rice.", price: 16, prep: 3, emoji: "🍚", popularity: 4, tags: ["vegan"], recipe: [["rice", 0.15], ["tomatoes", 0.03], ["packaging", 1]] },
  { sku: "CN-SID-002", categoryId: "cat_sides", name: "Refried Beans", description: "Slow-cooked pinto beans with queso.", price: 16, prep: 3, emoji: "🫘", popularity: 3, tags: ["vegetarian"], recipe: [["pinto_beans", 0.15], ["cheddar", 0.02], ["packaging", 1]] },
  { sku: "CN-DST-001", categoryId: "cat_desserts", name: "Churros con Cajeta", description: "Cinnamon-sugar churros with goat-milk caramel.", price: 26, prep: 6, emoji: "🍩", popularity: 5, tags: [], recipe: [["churro_dough", 0.15], ["packaging", 1]] },
  { sku: "CN-DST-002", categoryId: "cat_desserts", name: "Tres Leches", description: "Three-milk sponge cake with cinnamon cream.", price: 29, prep: 2, emoji: "🍰", popularity: 3, tags: [], recipe: [["tres_leches", 1], ["packaging", 1]] },
  { sku: "CN-DRK-001", categoryId: "cat_drinks", name: "Horchata", description: "Rice and cinnamon agua fresca, 450ml.", price: 18, prep: 1, emoji: "🥛", popularity: 8, tags: [], recipe: [["horchata_base", 0.35]] },
  { sku: "CN-DRK-002", categoryId: "cat_drinks", name: "Agua de Jamaica", description: "Hibiscus agua fresca, 450ml.", price: 16, prep: 1, emoji: "🧃", popularity: 4, tags: ["vegan"], recipe: [["hibiscus", 0.3]] },
  { sku: "CN-DRK-003", categoryId: "cat_drinks", name: "Agua de Tamarindo", description: "Tamarind agua fresca, 450ml.", price: 16, prep: 1, emoji: "🧃", popularity: 3, tags: ["vegan"], recipe: [["tamarind", 0.3]] },
  { sku: "CN-DRK-004", categoryId: "cat_drinks", name: "Mexican Coke", description: "Cane-sugar Coca-Cola, 355ml glass bottle.", price: 14, prep: 0, emoji: "🥤", popularity: 5, tags: [], recipe: [["mexican_coke", 1]] },
];

/** Marketplace menu mapping exceptions (everything else is synced). */
export const MAPPING_EXCEPTIONS: { sku: string; channel: OrderChannel; status: "missing" | "pending" | "out_of_sync" | "error"; message?: string }[] = [
  { sku: "CN-TAC-005", channel: "noon", status: "missing", message: "Not listed on Noon Food menu" },
  { sku: "CN-BWL-003", channel: "noon", status: "missing", message: "Not listed on Noon Food menu" },
  { sku: "CN-DRK-003", channel: "noon", status: "missing", message: "Not listed on Noon Food menu" },
  { sku: "CN-BWL-001", channel: "noon", status: "missing", message: "Not listed on Noon Food menu" },
  { sku: "CN-QSD-003", channel: "keeta", status: "pending", message: "Awaiting Keeta menu approval" },
  { sku: "CN-DST-002", channel: "keeta", status: "missing", message: "Not listed on Keeta menu" },
  { sku: "CN-BUR-002", channel: "deliveroo", status: "out_of_sync", message: "Deliveroo price AED 62 ≠ master AED 64" },
  { sku: "CN-STR-004", channel: "talabat", status: "error", message: "Image rejected: resolution below 800px" },
];

export const MODIFIERS: Record<string, { name: string; price: number }[]> = {
  cat_tacos: [
    { name: "Extra consomé", price: 8 },
    { name: "Add guacamole", price: 9 },
    { name: "Salsa roja (spicy)", price: 0 },
    { name: "No onions", price: 0 },
    { name: "Extra cheese", price: 6 },
  ],
  cat_bowls: [
    { name: "Add avocado", price: 7 },
    { name: "Extra protein", price: 14 },
    { name: "No beans", price: 0 },
    { name: "Salsa verde", price: 0 },
  ],
  cat_quesadillas: [
    { name: "Extra cheese", price: 6 },
    { name: "Add jalapeños", price: 3 },
  ],
  cat_starters: [{ name: "Extra chips", price: 6 }],
  cat_drinks: [
    { name: "Large", price: 4 },
    { name: "No ice", price: 0 },
  ],
};

export const ORDER_NOTES = [
  "Please include extra napkins",
  "Ring the bell, baby sleeping",
  "No cutlery please",
  "Leave at reception",
  "Extra hot sauce on the side",
  "Allergy: no nuts",
  "Call on arrival",
];

export const FIRST_NAMES = [
  "Ahmed", "Fatima", "Mohammed", "Aisha", "Omar", "Sara", "Rashid", "Mariam", "Khalid", "Noura",
  "Arjun", "Priya", "Rahul", "Ananya", "Vikram", "Deepa", "Sanjay", "Meera",
  "James", "Emily", "Oliver", "Sophie", "Daniel", "Hannah", "Lucas", "Chloe",
  "Maria", "Carlos", "Sofia", "Diego", "Elena", "Mateo",
  "Yousef", "Layla", "Hassan", "Rania", "Tariq", "Huda",
  "Wei", "Mei", "Jun", "Aiko", "Ivan", "Olga", "Kofi", "Amara", "Joseph", "Grace",
];
export const LAST_NAMES = [
  "Al Hashimi", "Khan", "Patel", "Smith", "Rahman", "Fernandes", "Haddad", "Nair", "Garcia", "Al Suwaidi",
  "Kapoor", "Johnson", "Mansour", "Pereira", "Iyer", "Brown", "Saleh", "Kim", "Chen", "Petrov",
  "Mensah", "Okafor", "Rossi", "Müller", "Dubois", "Al Falasi", "Sharma", "Ali", "Hussain", "Martin",
];
export const CUSTOMER_AREAS = [
  "Dubai Marina", "JLT", "JBR", "Business Bay", "Downtown", "DIFC", "JVC", "JVT", "Al Barsha", "Sports City", "Motor City", "Arjan",
];

export const USERS = [
  { id: "usr_owner", name: "Layla Al Mansouri", email: "layla@casanorte.ae", role: "owner" as const, locationIds: "all" as const },
  { id: "usr_gm", name: "Marco Villanueva", email: "marco@casanorte.ae", role: "general_manager" as const, locationIds: "all" as const },
  { id: "usr_marina", name: "Omar Haddad", email: "omar@casanorte.ae", role: "branch_manager" as const, locationIds: ["loc_marina"] },
  { id: "usr_bbay", name: "Priya Menon", email: "priya@casanorte.ae", role: "branch_manager" as const, locationIds: ["loc_bbay"] },
  { id: "usr_jvc", name: "Daniel Reyes", email: "daniel@casanorte.ae", role: "branch_manager" as const, locationIds: ["loc_jvc"] },
  { id: "usr_kitchen", name: "Chef Alejandro Ruiz", email: "alejandro@casanorte.ae", role: "kitchen_manager" as const, locationIds: "all" as const },
];

/** Per-channel commercial behaviour used by the traffic generator. */
export const CHANNEL_BEHAVIOUR: Record<
  OrderChannel,
  { promoChance: number; promoPct: number; promoCap: number; deliveryFee: number; cancelRate: number; extraLines: number; cashShare: number }
> = {
  talabat: { promoChance: 0.35, promoPct: 0.15, promoCap: 30, deliveryFee: 7, cancelRate: 0.025, extraLines: 0, cashShare: 0.12 },
  deliveroo: { promoChance: 0.25, promoPct: 0.1, promoCap: 25, deliveryFee: 8.9, cancelRate: 0.03, extraLines: 0.6, cashShare: 0.04 },
  noon: { promoChance: 0.45, promoPct: 0.2, promoCap: 30, deliveryFee: 5, cancelRate: 0.04, extraLines: 0, cashShare: 0.1 },
  keeta: { promoChance: 0.6, promoPct: 0.25, promoCap: 35, deliveryFee: 3, cancelRate: 0.05, extraLines: -0.3, cashShare: 0.15 },
  direct: { promoChance: 0.15, promoPct: 0.1, promoCap: 20, deliveryFee: 10, cancelRate: 0.015, extraLines: 0.3, cashShare: 0.08 },
  whatsapp: { promoChance: 0.1, promoPct: 0.05, promoCap: 10, deliveryFee: 10, cancelRate: 0.03, extraLines: 0.2, cashShare: 0.55 },
};

/** Today, Deliveroo cancellations are elevated (demo storyline). */
export const TODAY_CANCEL_OVERRIDE: Partial<Record<OrderChannel, number>> = { deliveroo: 0.1 };

/** Relative order volume by Dubai hour of day. */
export const HOURLY_WEIGHTS: Record<number, number> = {
  11: 3, 12: 8, 13: 10, 14: 7, 15: 4, 16: 3, 17: 4, 18: 6, 19: 9, 20: 11, 21: 10, 22: 7, 23: 4, 0: 2,
};

/** Day-of-week demand multiplier (0 = Sunday). */
export const WEEKDAY_FACTOR = [0.96, 0.9, 0.92, 0.95, 1.08, 1.2, 1.16];

export const EXTERNAL_ITEM_ID: Record<OrderChannel, (sku: string, index: number) => string> = {
  talabat: (_sku, i) => `TLB-SKU-${(40_100 + i * 7).toString()}`,
  deliveroo: (sku) => sku,
  noon: (_sku, i) => `NP${(9_120 + i).toString()}`,
  keeta: (_sku, i) => (880_000 + i * 11).toString(),
  direct: (sku) => sku,
  whatsapp: (sku) => `wa_${sku.toLowerCase().replace(/-/g, "_")}`,
};
