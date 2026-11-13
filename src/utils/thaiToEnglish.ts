/**
 * Deterministic offline Thai -> English culinary translator + RTGS phonetic transliterator.
 * Used to auto-populate editable English name fields from primary Thai input.
 */

const PHRASE_DICTIONARY: Array<[string, string]> = [
  // Multi-word dishes & preparations (longest first)
  ['ผัดกะเพราหมูกรอบ', 'Stir-Fried Holy Basil with Crispy Pork'],
  ['ผัดกะเพราหมูสับ', 'Stir-Fried Holy Basil with Minced Pork'],
  ['ผัดกะเพราหมูหมัก', 'Stir-Fried Holy Basil with Marinated Pork'],
  ['ผัดกะเพราไก่', 'Stir-Fried Holy Basil with Chicken'],
  ['ผัดกะเพราเนื้อ', 'Stir-Fried Holy Basil with Beef'],
  ['ผัดกะเพรากุ้ง', 'Stir-Fried Holy Basil with Shrimp'],
  ['ผัดกะเพราทะเล', 'Stir-Fried Holy Basil with Seafood'],
  ['กะเพราหมูกรอบ', 'Holy Basil Crispy Pork'],
  ['กะเพราหมูสับ', 'Holy Basil Minced Pork'],
  ['กะเพราหมูบด', 'Holy Basil Minced Pork'],
  ['กะเพราหมูหมัก', 'Holy Basil Marinated Pork'],
  ['กะเพราไก่', 'Holy Basil Chicken'],
  ['กะเพราเนื้อ', 'Holy Basil Beef'],
  ['กะเพรากุ้ง', 'Holy Basil Shrimp'],
  ['กะเพราปลาหมึก', 'Holy Basil Squid'],
  ['กะเพราทะเล', 'Holy Basil Seafood'],
  ['ผัดกะเพรา', 'Stir-Fried Holy Basil'],
  ['ข้าวผัดกะเพรา', 'Holy Basil Fried Rice'],
  ['ข้าวผัดปู', 'Crab Fried Rice'],
  ['ข้าวผัดกุ้ง', 'Shrimp Fried Rice'],
  ['ข้าวผัดหมู', 'Pork Fried Rice'],
  ['ข้าวผัดไก่', 'Chicken Fried Rice'],
  ['ข้าวผัดทะเล', 'Seafood Fried Rice'],
  ['ข้าวผัดอเมริกัน', 'American Fried Rice'],
  ['ข้าวผัดต้มยำ', 'Tom Yum Fried Rice'],
  ['ข้าวผัด', 'Fried Rice'],
  ['ต้มยำกุ้งน้ำข้น', 'Creamy Tom Yum Kung'],
  ['ต้มยำกุ้งน้ำใส', 'Clear Tom Yum Kung'],
  ['ต้มยำกุ้ง', 'Tom Yum Kung'],
  ['ต้มยำทะเล', 'Seafood Tom Yum'],
  ['ต้มยำรวมมิตร', 'Mixed Tom Yum'],
  ['ต้มยำไก่', 'Chicken Tom Yum'],
  ['ต้มยำ', 'Tom Yum'],
  ['ต้มข่าไก่', 'Tom Kha Gai'],
  ['ต้มข่า', 'Coconut Galangal Soup'],
  ['ต้มแซ่บกระดูกอ่อน', 'Spicy Pork Rib Soup'],
  ['ต้มแซ่บ', 'Isaan Spicy Soup'],
  ['ต้มจืดเต้าหู้หมูสับ', 'Clear Tofu & Minced Pork Soup'],
  ['แกงจืด', 'Clear Soup'],
  ['ต้มจืด', 'Clear Soup'],
  ['แกงเขียวหวาน', 'Green Curry'],
  ['แกงแดง', 'Red Curry'],
  ['แกงเผ็ด', 'Red Curry'],
  ['แกงพะแนง', 'Panang Curry'],
  ['พะแนง', 'Panang Curry'],
  ['แกงมัสมั่น', 'Massaman Curry'],
  ['มัสมั่น', 'Massaman Curry'],
  ['แกงส้ม', 'Sour Curry'],
  ['ผัดไทยกุ้งสด', 'Pad Thai with Fresh Shrimp'],
  ['ผัดไทย', 'Pad Thai'],
  ['ผัดซีอิ๊ว', 'Pad See Ew'],
  ['ราดหน้า', 'Stir-Fried Noodles in Gravy'],
  ['สุกี้แห้ง', 'Dry Sukiyaki'],
  ['สุกี้น้ำ', 'Sukiyaki Soup'],
  ['สุกี้', 'Sukiyaki'],
  ['คะน้าหมูกรอบ', 'Stir-Fried Kale with Crispy Pork'],
  ['ผัดพริกแกง', 'Stir-Fried Red Curry Paste'],
  ['พริกแกง', 'Red Curry Paste'],
  ['ผัดพริกเผา', 'Stir-Fried Roasted Chili Paste'],
  ['ผัดผงกะหรี่', 'Stir-Fried Curry Powder'],
  ['ทอดกระเทียมพริกไทย', 'Fried Garlic & Pepper'],
  ['ทอดกระเทียม', 'Fried Garlic'],
  ['ผัดกระเทียม', 'Stir-Fried Garlic'],
  ['ผัดน้ำมันหอย', 'Stir-Fried Oyster Sauce'],
  ['ผัดผักรวม', 'Stir-Fried Mixed Vegetables'],
  ['ข้าวไข่เจียว', 'Omelette on Rice'],
  ['ข้าวหมูแดง', 'BBQ Pork Rice'],
  ['ข้าวหมูกรอบ', 'Crispy Pork Rice'],
  ['ข้าวมันไก่', 'Hainanese Chicken Rice'],
  ['ข้าวขาหมู', 'Braised Pork Leg Rice'],
  ['ข้าวหมูกระเทียม', 'Garlic Pork Rice'],
  ['ข้าวสวยหอมมะลิ', 'Steamed Jasmine Rice'],
  ['ข้าวสวย', 'Steamed Rice'],
  ['ข้าวเปล่า', 'Steamed Rice'],
  ['ข้าวเหนียว', 'Sticky Rice'],
  ['ก๋วยเตี๋ยวต้มยำ', 'Tom Yum Noodle Soup'],
  ['ก๋วยเตี๋ยวน้ำตก', 'Boat Noodles'],
  ['ก๋วยเตี๋ยว', 'Noodles'],
  ['ส้มตำไทย', 'Thai Papaya Salad'],
  ['ส้มตำปูปลาร้า', 'Papaya Salad with Fermented Fish'],
  ['ส้มตำ', 'Papaya Salad'],
  ['คอหมูย่าง', 'Grilled Pork Neck'],
  ['ปีกไก่ทอด', 'Fried Chicken Wings'],
  ['ไก่ทอด', 'Fried Chicken'],
  ['หมูทอดกระเทียม', 'Fried Garlic Pork'],
  ['หมูทอด', 'Fried Pork'],
  ['ยำวุ้นเส้น', 'Glass Noodle Spicy Salad'],
  ['ยำมาม่า', 'Instant Noodle Spicy Salad'],
  ['ยำทะเล', 'Seafood Spicy Salad'],
  ['ไข่เจียวหมูสับ', 'Minced Pork Omelette'],

  // Option Groups & Common Choices
  ['ระดับความเผ็ด', 'Spice Level'],
  ['ความเผ็ด', 'Spice Level'],
  ['เผ็ดน้อย', 'Mild Spicy'],
  ['เผ็ดกลาง', 'Medium Spicy'],
  ['เผ็ดมาก', 'Very Spicy'],
  ['เผ็ดพิเศษ', 'Extra Spicy'],
  ['ไม่เผ็ด', 'Non-Spicy'],
  ['พริกน้ำปลา', 'Chili Fish Sauce'],
  ['ท็อปปิ้ง', 'Toppings'],
  ['เครื่องเคียง', 'Side Dishes'],
  ['เพิ่มไข่', 'Add Egg'],
  ['ไข่ดาวไม่สุก', 'Sunny-Side Up Fried Egg'],
  ['ไข่ดาวสุก', 'Well-Done Fried Egg'],
  ['ไข่ดาว', 'Fried Egg'],
  ['ไข่เจียว', 'Omelette'],
  ['ไข่ข้น', 'Creamy Omelette'],
  ['ไข่ต้ม', 'Boiled Egg'],
  ['ไข่ลวก', 'Soft-Boiled Egg'],
  ['ไข่เยี่ยวม้า', 'Century Egg'],
  ['ไข่เค็ม', 'Salted Egg'],
  ['เพิ่มข้าว', 'Extra Rice'],
  ['เพิ่มเนื้อ', 'Extra Meat'],
  ['ไม่ใส่ผัก', 'No Vegetables'],
  ['ไม่ใส่กระเทียม', 'No Garlic'],
  ['ไม่ใส่พริก', 'No Chili'],
  ['ไม่ใส่ผงชูรส', 'No MSG'],
  ['ไม่ใส่ต้นหอม', 'No Spring Onion'],
  ['ไม่ใส่ถั่วงอก', 'No Bean Sprouts'],
  ['แยกน้ำ', 'Sauce on the Side'],
  ['แยกซอส', 'Sauce on the Side'],
  ['แยกกับ', 'Separate Dish'],
  ['แยกข้าว', 'Separate Rice'],
  ['ระดับความหวาน', 'Sweetness Level'],
  ['ไม่หวาน', 'Unsweetened'],
  ['หวานน้อย', 'Less Sweet'],
  ['หวานปกติ', 'Normal Sweet'],
  ['หวานมาก', 'Extra Sweet'],
  ['ความสุก', 'Doneness'],
  ['สุกมาก', 'Well Done'],
  ['กึ่งสุกกึ่งดิบ', 'Medium Rare'],
  ['เลือกเส้น', 'Noodle Type'],
  ['เส้นใหญ่', 'Wide Rice Noodles'],
  ['เส้นเล็ก', 'Thin Rice Noodles'],
  ['เส้นหมี่', 'Rice Vermicelli'],
  ['วุ้นเส้น', 'Glass Noodles'],
  ['บะหมี่เหลือง', 'Egg Noodles'],
  ['บะหมี่', 'Egg Noodles'],
  ['มาม่า', 'Instant Noodles'],

  // Proteins / Primary Variants (เนื้อสัตว์ / ตัวเลือกหลัก)
  ['หมูหมัก (สูตรทางร้าน)', 'House Marinated Pork'],
  ['หมูหมัก', 'Marinated Pork'],
  ['หมูบด', 'Minced Pork'],
  ['หมูสับ', 'Minced Pork'],
  ['หมูกรอบ', 'Crispy Pork'],
  ['หมูชิ้น', 'Sliced Pork'],
  ['หมูสามชั้น', 'Pork Belly'],
  ['หมูสันใน', 'Pork Tenderloin'],
  ['สันในหมู', 'Pork Tenderloin'],
  ['หมูสันนอก', 'Pork Loin'],
  ['สันนอกหมู', 'Pork Loin'],
  ['คอหมู', 'Pork Neck'],
  ['ซี่โครงหมู', 'Pork Ribs'],
  ['กระดูกอ่อน', 'Pork Soft Bone'],
  ['หมูเด้ง', 'Bouncy Pork'],
  ['หมูยอ', 'Vietnamese Pork Sausage'],
  ['เนื้อวัวโคขุน', 'Thai-French Beef'],
  ['เนื้อวัวสไลซ์', 'Sliced Beef'],
  ['เนื้อโคขุน', 'Premium Beef'],
  ['เนื้อสไลซ์', 'Sliced Beef'],
  ['เนื้อสับ', 'Minced Beef'],
  ['เนื้อเปื่อย', 'Braised Beef'],
  ['เนื้อตุ๋น', 'Stewed Beef'],
  ['เนื้อวัว', 'Beef'],
  ['อกไก่หั่นชิ้น', 'Sliced Chicken Breast'],
  ['อกไก่', 'Chicken Breast'],
  ['สะโพกไก่', 'Chicken Thigh'],
  ['น่องไก่', 'Chicken Drumstick'],
  ['ปีกไก่', 'Chicken Wing'],
  ['ไก่กรอบ', 'Crispy Chicken'],
  ['ไก่สับ', 'Minced Chicken'],
  ['ไก่ชิ้น', 'Sliced Chicken'],
  ['กุ้งสด', 'Fresh Shrimp'],
  ['กุ้งขาว', 'White Shrimp'],
  ['กุ้งแม่น้ำ', 'River Prawn'],
  ['กุ้งเด้ง', 'Bouncy Shrimp'],
  ['ปลาหมึกกล้วย', 'Squid'],
  ['ปลาหมึกกรอบ', 'Crispy Squid'],
  ['ปลาหมึก', 'Squid'],
  ['หมึก', 'Squid'],
  ['ปลาดอลลี่', 'Dory Fish'],
  ['ปลากะพง', 'Sea Bass'],
  ['ปลาทับทิม', 'Red Tilapia'],
  ['ปลาแซลมอน', 'Salmon'],
  ['ปูอัด', 'Crab Stick'],
  ['ทะเลรวม', 'Mixed Seafood'],
  ['รวมมิตรทะเล', 'Mixed Seafood'],
  ['ทะเล', 'Seafood'],
  ['รวมมิตร', 'Mixed'],
  ['ลูกชิ้นหมู', 'Pork Balls'],
  ['ลูกชิ้นเนื้อ', 'Beef Balls'],
  ['ลูกชิ้นปลา', 'Fish Balls'],
  ['ลูกชิ้น', 'Meatballs'],
  ['เต้าหู้ไข่', 'Egg Tofu'],
  ['เต้าหู้ขาว', 'White Tofu'],
  ['เต้าหู้', 'Tofu'],
  ['มังสวิรัติ', 'Vegetarian'],
  ['เบคอน', 'Bacon'],
  ['ไส้กรอก', 'Sausage'],
  ['แฮม', 'Ham'],

  // Sizes / Styles
  ['มาตรฐาน', 'Standard'],
  ['ธรรมดา', 'Regular'],
  ['พิเศษ', 'Special'],
  ['จัมโบ้', 'Jumbo'],
  ['ใหญ่', 'Large'],
  ['กลาง', 'Medium'],
  ['เล็ก', 'Small'],
  ['ราดข้าว', 'On Rice'],
  ['กับข้าว', 'A La Carte'],
  ['ใส่กล่อง', 'Takeaway Box'],

  // Ingredients & Sauces
  ['ซอสผัดกระทะมาตรฐาน', 'House Stir-Fry Sauce'],
  ['ซอสผัด', 'Stir-Fry Sauce'],
  ['ซอสหอยนางรม', 'Oyster Sauce'],
  ['น้ำมันหอย', 'Oyster Sauce'],
  ['ซีอิ๊วขาว', 'Light Soy Sauce'],
  ['ซีอิ๊วดำ', 'Dark Soy Sauce'],
  ['ซอสปรุงรส', 'Seasoning Sauce'],
  ['น้ำปลาแท้', 'Fish Sauce'],
  ['น้ำปลา', 'Fish Sauce'],
  ['น้ำจิ้มสุกี้', 'Suki Sauce'],
  ['น้ำซอสมะขาม', 'Tamarind Sauce'],
  ['มะขามเปียก', 'Tamarind Paste'],
  ['น้ำซุปกระดูกเข้มข้น', 'Rich Bone Broth'],
  ['น้ำซุป', 'Soup Base'],
  ['น้ำตาลทรายขาว', 'White Sugar'],
  ['น้ำตาลทราย', 'Sugar'],
  ['น้ำตาลปี๊บ', 'Palm Sugar'],
  ['น้ำตาล', 'Sugar'],
  ['น้ำมันปาล์ม', 'Palm Oil'],
  ['น้ำมันพืช', 'Vegetable Oil'],
  ['น้ำมันงา', 'Sesame Oil'],
  ['ใบกะเพรา', 'Holy Basil'],
  ['กะเพรา', 'Holy Basil'],
  ['โหระพา', 'Sweet Basil'],
  ['พริกขี้หนูแดงจินดา', 'Red Bird\'s Eye Chili'],
  ['พริกขี้หนู', 'Bird\'s Eye Chili'],
  ['พริกชี้ฟ้า', 'Spur Chili'],
  ['พริกไทยอ่อน', 'Fresh Peppercorns'],
  ['พริกไทย', 'Black Pepper'],
  ['กระเทียมไทย', 'Thai Garlic'],
  ['กระเทียม', 'Garlic'],
  ['หอมแดง', 'Shallot'],
  ['หอมหัวใหญ่', 'Onion'],
  ['ต้นหอม', 'Spring Onion'],
  ['ผักชี', 'Coriander'],
  ['มะนาว', 'Lime'],
  ['มะเขือเทศ', 'Tomato'],
  ['คะน้า', 'Chinese Kale'],
  ['กะหล่ำปลี', 'Cabbage'],
  ['ถั่วฝักยาว', 'Yardlong Bean'],
  ['ข้าวโพดอ่อน', 'Baby Corn'],
  ['แครอท', 'Carrot'],
  ['เห็ดฟาง', 'Straw Mushroom'],
  ['เห็ดหอม', 'Shiitake Mushroom'],
  ['เห็ดเข็มทอง', 'Enoki Mushroom'],
  ['ไข่ไก่', 'Chicken Egg'],
  ['ไข่เป็ด', 'Duck Egg'],
  ['กะทิ', 'Coconut Milk'],
  ['ถั่วลิสง', 'Peanuts'],

  // Packaging
  ['กล่องกระดาษใส่อาหาร', 'Paper Food Box'],
  ['กล่องกระดาษ', 'Paper Box'],
  ['กล่องข้าว', 'Food Container Box'],
  ['กล่องพลาสติก', 'Plastic Container'],
  ['ถ้วยซุป', 'Soup Bowl'],
  ['ถุงหิ้ว', 'Carrier Bag'],
  ['ถุงพลาสติก', 'Plastic Bag'],
  ['ถุงร้อน', 'Hot Food Bag'],
  ['ช้อนส้อม', 'Cutlery Set'],
  ['ตะเกียบ', 'Chopsticks'],
  ['แก้วน้ำ', 'Beverage Cup'],
  ['หลอด', 'Straw'],

  // Categories & Channels
  ['อาหารจานหลัก', 'Main Dishes'],
  ['อาหารจานเดียว', 'One-Dish Meals'],
  ['อาหารตามสั่ง', 'Made-to-Order Dishes'],
  ['ตามสั่ง', 'Made to Order'],
  ['ของทานเล่น', 'Appetizers'],
  ['ทานเล่น', 'Appetizers'],
  ['เครื่องดื่ม', 'Beverages'],
  ['ของหวาน', 'Desserts'],
  ['สลัดและยำ', 'Spicy Salads'],
  ['ต้มและแกง', 'Soups & Curries'],
  ['หน้าร้าน', 'Dine-in'],
  ['ทานที่ร้าน', 'Dine-in'],
  ['สั่งกลับบ้าน', 'Takeaway'],
  ['กลับบ้าน', 'Takeaway'],
  ['เดลิเวอรี', 'Delivery'],
  ['อื่นๆ', 'Other'],
  ['ทั่วไป', 'General'],
];

const SINGLE_WORD_DICTIONARY: Record<string, string> = {
  'หมู': 'Pork',
  'ไก่': 'Chicken',
  'เนื้อ': 'Beef',
  'กุ้ง': 'Shrimp',
  'ปลา': 'Fish',
  'ปู': 'Crab',
  'หอย': 'Shellfish',
  'ไข่': 'Egg',
  'ข้าว': 'Rice',
  'ผัด': 'Stir-Fried',
  'ทอด': 'Fried',
  'ต้ม': 'Boiled',
  'แกง': 'Curry',
  'ย่าง': 'Grilled',
  'นึ่ง': 'Steamed',
  'อบ': 'Baked',
  'ยำ': 'Spicy Salad',
  'ลวก': 'Blanched',
  'เผ็ด': 'Spicy',
  'หวาน': 'Sweet',
  'เค็ม': 'Salty',
  'เปรี้ยว': 'Sour',
  'มัน': 'Rich',
  'ร้อน': 'Hot',
  'เย็น': 'Iced',
  'ปั่น': 'Frappe',
  'แห้ง': 'Dry',
  'น้ำ': 'Soup',
  'เพิ่ม': 'Extra',
  'ไม่': 'No',
  'แยก': 'Separate',
  'ใส่': 'With',
  'และ': 'and',
  'กับ': 'with',
  'สด': 'Fresh',
  'กรอบ': 'Crispy',
  'สุก': 'Cooked',
  'ดิบ': 'Raw',
  'ชิ้น': 'Piece',
  'ชุด': 'Set',
  'จาน': 'Plate',
  'ชาม': 'Bowl',
  'ถ้วย': 'Cup',
  'แก้ว': 'Glass',
  'กล่อง': 'Box',
  'ถุง': 'Bag',
  'ขวด': 'Bottle',
  'ซอง': 'Sachet',
  'แพ็ค': 'Pack',
  'กระป๋อง': 'Can',
  'สูตรทางร้าน': 'House Recipe',
  'สูตรโบราณ': 'Traditional Recipe',
  'สูตร': 'Recipe',
};

// RTGS Consonant Initial & Final Mapping for fallback phonetic transliteration
const CONSONANT_INITIAL: Record<string, string> = {
  ก: 'k', ข: 'kh', ฃ: 'kh', ค: 'kh', ฅ: 'kh', ฆ: 'kh', ง: 'ng',
  จ: 'ch', ฉ: 'ch', ช: 'ch', ซ: 's', ฌ: 'ch', ญ: 'y',
  ฎ: 'd', ฏ: 't', ฐ: 'th', ฑ: 'th', ฒ: 'th', ณ: 'n',
  ด: 'd', ต: 't', ถ: 'th', ท: 'th', ธ: 'th', น: 'n',
  บ: 'b', ป: 'p', ผ: 'ph', ฝ: 'f', พ: 'ph', ฟ: 'f', ภ: 'ph', ม: 'm',
  ย: 'y', ร: 'r', ล: 'l', ว: 'w',
  ศ: 's', ษ: 's', ส: 's', ห: 'h', ฬ: 'l', อ: '', ฮ: 'h',
};

const VOWEL_MAP: Record<string, string> = {
  'ะ': 'a', 'ั': 'a', 'า': 'a', 'ำ': 'am',
  'ิ': 'i', 'ี': 'i', 'ึ': 'ue', 'ื': 'ue',
  'ุ': 'u', 'ู': 'u',
  'เ': 'e', 'แ': 'ae', 'โ': 'o', 'ใ': 'ai', 'ไ': 'ai',
  'ฤ': 'rue', 'ฤๅ': 'rue', 'ฦ': 'lue', 'ฦๅ': 'lue',
  '็': '', '์': '', '่': '', '้': '', '๊': '', '๋': '', 'ๆ': '', 'ฯ': '',
};

const COMBINED_MAP: Array<[string, string]> = [
  ...PHRASE_DICTIONARY,
  ...Object.entries(SINGLE_WORD_DICTIONARY),
].sort((a, b) => b[0].length - a[0].length);

function romanizeThaiToken(token: string): string {
  // Simple readable syllable-ish RTGS transliterator for unrecognized Thai words
  let out = '';
  const chars = Array.from(token);
  let pendingLeadingVowel = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === 'เ' || ch === 'แ' || ch === 'โ' || ch === 'ใ' || ch === 'ไ') {
      pendingLeadingVowel = VOWEL_MAP[ch] || '';
      continue;
    }
    if (ch in CONSONANT_INITIAL) {
      out += CONSONANT_INITIAL[ch];
      if (pendingLeadingVowel) {
        out += pendingLeadingVowel;
        pendingLeadingVowel = '';
      }
      continue;
    }
    if (ch in VOWEL_MAP) {
      out += VOWEL_MAP[ch];
      continue;
    }
    out += ch;
  }
  if (pendingLeadingVowel) {
    out += pendingLeadingVowel;
  }
  const cleaned = out.replace(/[^a-zA-Z0-9\s\-()'./]/g, '').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function toTitleCase(text: string): string {
  const lowercaseWords = new Set(['with', 'and', 'on', 'in', 'the', 'of', 'for', 'or']);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, idx) => {
      if (idx > 0 && lowercaseWords.has(word.toLowerCase())) {
        return word.toLowerCase();
      }
      if (/^[A-Z0-9()-]+$/.test(word) && word.length <= 4) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export function translateThaiToEnglish(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  // Already English / Latin / Numbers only
  if (!/[\u0E00-\u0E7F]/.test(trimmed)) {
    return trimmed;
  }

  const outputParts: string[] = [];
  let cursor = 0;

  while (cursor < trimmed.length) {
    const remaining = trimmed.slice(cursor);

    // Skip whitespace
    const wsMatch = remaining.match(/^\s+/);
    if (wsMatch) {
      cursor += wsMatch[0].length;
      continue;
    }

    // Preserve ASCII segments (e.g. (XL), 100g, LINE MAN)
    const asciiMatch = remaining.match(/^[^\u0E00-\u0E7F]+/);
    if (asciiMatch) {
      const seg = asciiMatch[0].trim();
      if (seg) outputParts.push(seg);
      cursor += asciiMatch[0].length;
      continue;
    }

    // Try longest dictionary phrase match at current cursor
    let matched = false;
    for (const [thPhrase, enTranslation] of COMBINED_MAP) {
      if (remaining.startsWith(thPhrase)) {
        outputParts.push(enTranslation);
        cursor += thPhrase.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Fallback: consume contiguous Thai run up to next dictionary hit or non-Thai char
    let nextHitIdx = remaining.length;
    for (let j = 1; j < remaining.length; j++) {
      if (!/[\u0E00-\u0E7F]/.test(remaining[j])) {
        nextHitIdx = j;
        break;
      }
      const sub = remaining.slice(j);
      if (COMBINED_MAP.some(([thPhrase]) => sub.startsWith(thPhrase))) {
        nextHitIdx = j;
        break;
      }
    }

    const unknownChunk = remaining.slice(0, nextHitIdx);
    const romanized = romanizeThaiToken(unknownChunk);
    if (romanized) {
      outputParts.push(romanized);
    }
    cursor += nextHitIdx;
  }

  return toTitleCase(outputParts.join(' ').replace(/\s+/g, ' ').trim());
}

const DEFAULT_PLACEHOLDER_EN_VALUES = new Set([
  '',
  'new variant',
  'new option',
  'choice 1',
  'choice 2',
  'standard',
]);

/**
 * Computes the next English name value when the Thai name changes.
 * Preserves any manually customized English name, while automatically translating
 * empty, placeholder, or previously auto-translated English fields.
 */
export function computeAutoEnglishName(params: {
  previousThai?: string;
  nextThai: string;
  currentEnglish?: string;
  isManuallyEdited?: boolean;
}): string {
  const { previousThai = '', nextThai, currentEnglish = '', isManuallyEdited = false } = params;
  if (isManuallyEdited && currentEnglish.trim().length > 0) {
    return currentEnglish;
  }

  const currEnTrimmed = currentEnglish.trim();
  const prevAuto = previousThai.trim() ? translateThaiToEnglish(previousThai) : '';

  const shouldAutoUpdate =
    !currEnTrimmed ||
    DEFAULT_PLACEHOLDER_EN_VALUES.has(currEnTrimmed.toLowerCase()) ||
    currEnTrimmed === previousThai.trim() ||
    (prevAuto && currEnTrimmed.toLowerCase() === prevAuto.toLowerCase());

  if (!shouldAutoUpdate) {
    return currentEnglish;
  }

  return translateThaiToEnglish(nextThai);
}
