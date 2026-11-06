// System category taxonomy. Seeded per household; users can add custom categories alongside it.

export interface CategoryDef {
  slug: string;
  type: "expense" | "income";
  he: string;
  en: string;
  parent?: string;
}

export const SYSTEM_CATEGORIES: CategoryDef[] = [
  // expenses
  { slug: "groceries", type: "expense", he: "מזון וסופרמרקט", en: "Groceries" },
  { slug: "dining", type: "expense", he: "מסעדות ובתי קפה", en: "Restaurants & Dining" },
  { slug: "delivery", type: "expense", he: "משלוחי אוכל", en: "Food Delivery", parent: "dining" },
  { slug: "shopping", type: "expense", he: "קניות", en: "Shopping" },
  { slug: "clothing", type: "expense", he: "ביגוד והנעלה", en: "Clothing", parent: "shopping" },
  { slug: "home", type: "expense", he: "לבית", en: "Home & Housewares", parent: "shopping" },
  { slug: "electronics", type: "expense", he: "אלקטרוניקה ומחשבים", en: "Electronics" },
  { slug: "transportation", type: "expense", he: "תחבורה", en: "Transportation" },
  { slug: "fuel", type: "expense", he: "דלק", en: "Fuel", parent: "transportation" },
  { slug: "car", type: "expense", he: "רכב", en: "Car Services", parent: "transportation" },
  { slug: "parking_tolls", type: "expense", he: "חניה וכבישי אגרה", en: "Parking & Tolls", parent: "transportation" },
  { slug: "housing", type: "expense", he: "דיור", en: "Housing" },
  { slug: "renovation", type: "expense", he: "שיפוץ ותחזוקה", en: "Renovation & Repairs", parent: "housing" },
  { slug: "utilities", type: "expense", he: "חשבונות", en: "Utilities" },
  { slug: "communication", type: "expense", he: "תקשורת", en: "Phone & Internet", parent: "utilities" },
  { slug: "insurance", type: "expense", he: "ביטוח", en: "Insurance" },
  { slug: "healthcare", type: "expense", he: "בריאות", en: "Healthcare" },
  { slug: "pharmacy", type: "expense", he: "פארם", en: "Pharmacy", parent: "healthcare" },
  { slug: "entertainment", type: "expense", he: "פנאי ובילוי", en: "Entertainment" },
  { slug: "sports", type: "expense", he: "ספורט וכושר", en: "Sports & Fitness", parent: "entertainment" },
  { slug: "lottery", type: "expense", he: "הימורים והגרלות", en: "Lottery & Betting", parent: "entertainment" },
  { slug: "travel", type: "expense", he: "חופשות ונסיעות", en: "Travel & Vacations" },
  { slug: "subscriptions", type: "expense", he: "מנויים", en: "Subscriptions" },
  { slug: "personal_care", type: "expense", he: "טיפוח", en: "Personal Care" },
  { slug: "education", type: "expense", he: "חינוך וספרים", en: "Education & Books" },
  { slug: "gifts", type: "expense", he: "מתנות ותרומות", en: "Gifts & Donations" },
  { slug: "taxes_fees", type: "expense", he: "מסים ואגרות", en: "Taxes & Government Fees" },
  { slug: "bank_fees", type: "expense", he: "עמלות", en: "Bank & Card Fees" },
  { slug: "other_expense", type: "expense", he: "אחר", en: "Other" },
  // bill of a card whose statement is not imported: counted as one line until itemized
  { slug: "card_unitemized", type: "expense", he: "חיובי כרטיס לא מפורטים", en: "Card spending (not itemized)" },
  // income
  { slug: "salary", type: "income", he: "משכורת", en: "Salary" },
  { slug: "bonus", type: "income", he: "בונוסים", en: "Bonuses" },
  { slug: "freelance", type: "income", he: "הכנסה נוספת", en: "Freelance / Additional Income" },
  { slug: "investment_income", type: "income", he: "הכנסה מהשקעות", en: "Investment Income" },
  { slug: "refunds", type: "income", he: "החזרים", en: "Refunds" },
  { slug: "tax_refund", type: "income", he: "החזרי מס", en: "Tax Refunds", parent: "refunds" },
  { slug: "other_income", type: "income", he: "הכנסה אחרת", en: "Other Income" },
];

export const CATEGORY_SLUGS = new Set(SYSTEM_CATEGORIES.map((c) => c.slug));
