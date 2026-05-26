export const CATEGORIES = {
  "Fashion": [
    "Tops & Shirts",
    "Bottoms & Pants",
    "Dresses & Skirts",
    "Jackets & Coats",
    "Shoes",
    "Accessories",
    "Activewear"
  ],
  "Beauty & Personal Care": [
    "Skincare",
    "Haircare",
    "Makeup",
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
    "Headphones & Earbuds",
    "Chargers & Cables",
    "Smartwatches",
    "Cameras",
    "Laptops & Computers",
    "Tablets"
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
  ]\r?\n};

// Helper function to get subcategories for a category
export const getSubcategories = (category: string): string[] => {
  return CATEGORIES[category as keyof typeof CATEGORIES] || [];
};

// Helper function to get all main categories
export const getMainCategories = (): string[] => {
  return Object.keys(CATEGORIES);
};


