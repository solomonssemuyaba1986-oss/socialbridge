export const CATEGORIES = {
  // The house line — ours, not a seller's. Deliberately first: it is the front door of the market.
  //
  // ⚠️ The sub-list must never be empty. Store setup *requires* a subcategory
  // (`notify.productSubcategoryRequired`, StorePage's product form), so a category a seller can
  // pick but cannot finish is a dead end. Still being planned: add the real subcategories here as
  // they are decided, and every picker follows — the Browse chips, Nearby, store setup, bulk
  // upload and product editing all read this one object.
  "Rachett Essentials": [
    "Everyday Essentials",
    "Bundles & Sets",
    "Gift Picks",
    "Limited Drops"
  ],
  "Fashion": [
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
  "Books & Stationery": [
    "Books",
    "Notebooks & Pads",
    "Pens & Pencils",
    "Art Supplies",
    "Office Supplies"
  ],
  "Pet Supplies": [
    "Pet Food",
    "Toys & Accessories",
    "Grooming",
    "Pet Clothing",
    "Health & Wellness"
  ]
};

// Helper function to get subcategories for a category
export const getSubcategories = (category: string): string[] => {
  return CATEGORIES[category as keyof typeof CATEGORIES] || [];
};

// Helper function to get all main categories
export const getMainCategories = (): string[] => {
  return Object.keys(CATEGORIES);
};
