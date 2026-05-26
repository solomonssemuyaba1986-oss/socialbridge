export const CATEGORIES = {
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
