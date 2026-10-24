export const CATEGORIES = {
  // The house line — ours, not a seller's. Deliberately first: it is the front door of the market.
  //
  // ⚠️ The sub-list must never be empty. Store setup *requires* a subcategory
  // (`notify.productSubcategoryRequired`, StorePage's product form), so a category a seller can
  // pick but cannot finish is a dead end. Still being planned: add the real subcategories here as
  // they are decided, and every picker follows — the Browse chips, Nearby, store setup, bulk
  // upload and product editing all read this one object.
  "rachett essentials": [
    "Everyday Essentials",
    "Bundles & Sets",
    "Gift Picks",
    "Limited Drops"
  ],
  "Fashion & Clothing": [
    "Tops & Shirts",
    "Bottoms & Pants",
    "Dresses",
    "Jackets & Coats",
    "Sneakers",
    "Hoodies",
    "Jeans",
    "Handbags",
    "Watches",
    "Accessories",
    "Activewear"
  ],
  // Young buyers shop differently: school, first jobs, streetwear and gaming are one shelf here.
  "Youths": [
    "Teen Fashion",
    "School Essentials",
    "Sneakers & Streetwear",
    "Gaming & Tech",
    "Bags & Backpacks",
    "Student Deals"
  ],
  "Beauty & Cosmetics": [
    "Skincare",
    "Haircare",
    "Makeup",
    "Wigs",
    "Fragrances",
    "Bath & Body",
    "Health & Supplements"
  ],
  "Perfume": [
    "Men's Fragrances",
    "Women's Fragrances",
    "Unisex Fragrances",
    "Perfume Sets"
  ],
  "Jewelry": [
    "Necklaces",
    "Bracelets",
    "Rings",
    "Earrings",
    "Watches",
    "Body Jewelry"
  ],
  "Electronics & Gadgets": [
    "Smartphones",
    "Phone Accessories",
    "Headphones & Earbuds",
    "Chargers & Cables",
    "Smartwatches",
    "Speakers",
    "Cameras",
    "Laptops & Computers",
    "Tablets"
  ],
  "Digital Products & Services": [
    "Courses",
    "Templates",
    "Presets",
    "eBooks",
    "Design Services"
  ],
  // A job is not a product, but it is still something a seller brings to the market: a shop with
  // work going, a tradesman, a salon needing a hand. Listed like everything else so a buyer can
  // browse it, message about it and agree terms in the same thread — the sub-list is what the
  // store setup demands, so it must never be empty.
  "Job & Work": [
    "Full-time Jobs",
    "Part-time & Shift Work",
    "Gigs & Freelance",
    "Internships & Attachments",
    "Skills & Training",
    "CV & Career Help"
  ],
  // Services are people selling their time — a tutor, a coach, a photographer. Nothing ships, so
  // these are booked: the buyer sends the order and the two of them agree a time in chat.
  "Services": [
    "Tutoring & Lessons",
    "Music Lessons",
    "Languages",
    "Tech & Coding",
    "Fitness & Coaching",
    "Photography & Video",
    "Art & Design Lessons",
    "Business & Career",
    "Beauty & Grooming",
    "Repairs & Maintenance",
    "Events & Entertainment",
    "Home Services"
  ],
  "Home & Living": [
    "Furniture",
    "Bedding & Linens",
    "Kitchen & Dining",
    "Decorations",
    "Lighting",
    "Storage & Organization"
  ],
  "Health & Wellness": [
    "Supplements",
    "Fitness Equipment",
    "Medical Devices",
    "Wellness Products",
    "Yoga & Meditation"
  ],
  "Food & Beverages": [
    "Snacks",
    "Coffee & Tea",
    "Baked Goods",
    "Drinks",
    "Desserts",
    "Beverages",
    "Spices & Condiments",
    "Dairy & Alternatives"
  ],
  "Baby & Maternity": [
    "Baby Gear",
    "Clothing",
    "Toys & Games",
    "Feeding & Nursing",
    "Maternity Wear"
  ],
  "Sports & Outdoors": [
    "Sports Equipment",
    "Camping & Hiking",
    "Bicycles & Accessories",
    "Outdoor Wear",
    "Gym Equipment"
  ],
  "Automotive": [
    "Car Accessories",
    "Motorcycle Gear",
    "Car Care Products",
    "Tools & Equipment"
  ],
  // A shop, a workshop and a farm buy differently from a household. This is that shelf.
  "Industrial & Commercial": [
    "Industrial Equipment",
    "Shop & Retail Equipment",
    "Office Supplies",
    "Safety & PPE",
    "Packaging & Logistics",
    "Commercial Kitchen",
    "Agriculture & Farming",
    "Business Services"
  ],
  // Second-hand is not a leftover bin: it is a deliberate, sustainable way to buy.
  "Second Hand / Used": [
    "Second-Hand Clothing",
    "Refurbished Electronics",
    "Used Furniture",
    "Pre-Owned Books",
    "Used Homeware",
    "Upcycled & Repaired"
  ],
  "Books & Stationery": [
    "Books",
    "Notebooks & Pads",
    "Pens & Pencils",
    "Art Supplies",
    "Office Supplies"
  ],
  "Pets & Pet Supplies": [
    "Pet Food",
    "Toys & Accessories",
    "Grooming",
    "Pet Clothing",
    "Health & Wellness"
  ]
};

/**
 * Names that changed, mapped to the name the app uses now.
 *
 * Products keep the category string they were saved with. Without this, renaming a shelf would
 * silently hide every item already on it — a seller's shop would look empty because we changed a
 * label. Every read normalises through here; every new write uses the current name.
 */
export const CATEGORY_ALIASES: Record<string, string> = {
  Fashion: 'Fashion & Clothing',
  'Pet Supplies': 'Pets & Pet Supplies',
  'Pet Supply': 'Pets & Pet Supplies',
  'Second Hand': 'Second Hand / Used',
  Used: 'Second Hand / Used',
  'Industrial and Commercial': 'Industrial & Commercial',
  Youth: 'Youths',
};

/** The current name for a category, including one written before a rename. */
export const canonicalCategory = (category: string): string =>
  CATEGORY_ALIASES[category] || category;

// Helper function to get subcategories for a category
export const getSubcategories = (category: string): string[] => {
  return CATEGORIES[canonicalCategory(category) as keyof typeof CATEGORIES] || [];
};

// Helper function to get all main categories
export const getMainCategories = (): string[] => {
  return Object.keys(CATEGORIES);
};
