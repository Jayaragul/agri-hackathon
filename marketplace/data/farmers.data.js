/**
 * farmers.data.js
 * ─────────────────────────────────────────────────────────────
 * Master farmer database for FarmConnect.
 *
 * ARCHITECTURE NOTE:
 *   Farmers in this file are pre-registered in the network.
 *   They do NOT need to manually add inventory.
 *   When a consumer places a request, the system broadcasts
 *   it to ALL farmers within 3 km — farmers simply accept
 *   or decline from their Requests screen.
 *
 *   Farmers can optionally add inventory to appear in the
 *   consumer's Browse Produce section, but it is NOT required.
 * ─────────────────────────────────────────────────────────────
 */

const FARMERS_DATA = {
  version: "1.0",
  region: "Bengaluru, Karnataka, India",
  center: { lat: 12.9716, lng: 77.5946 }, // MG Road reference point

  farmers: [

    // ── WITHIN 3 KM ──────────────────────────────────────────
    // (will receive consumer requests from the default demo area)

    {
      id: "f-001",
      name: "Ram Kumar",
      phone: "9111111111",
      location: { lat: 12.9800, lng: 77.5946, label: "Shivajinagar" },
      specialties: ["Drumstick", "Tomato", "Coconut", "Beans"],
      farmType: "terrace",
      rating: 4.8,
      available: true,
      emoji: "🌿"
    },
    {
      id: "f-002",
      name: "Muthu Selvam",
      phone: "9222222222",
      location: { lat: 12.9716, lng: 77.6070, label: "Indiranagar" },
      specialties: ["Drumstick", "Spinach", "Brinjal", "Okra"],
      farmType: "backyard",
      rating: 4.6,
      available: true,
      emoji: "🌾"
    },
    {
      id: "f-003",
      name: "Venkat Rao",
      phone: "9444444444",
      location: { lat: 12.9716, lng: 77.5750, label: "Rajajinagar" },
      specialties: ["Onion", "Potato", "Green Chilli", "Carrot"],
      farmType: "community_plot",
      rating: 4.5,
      available: true,
      emoji: "🧅"
    },
    {
      id: "f-004",
      name: "Suresh Babu",
      phone: "9555555555",
      location: { lat: 12.9620, lng: 77.5946, label: "Richmond Town" },
      specialties: ["Banana", "Coconut", "Papaya", "Turmeric"],
      farmType: "garden",
      rating: 4.7,
      available: true,
      emoji: "🍌"
    },
    {
      id: "f-005",
      name: "Kavitha Devi",
      phone: "9666666666",
      location: { lat: 12.9750, lng: 77.6030, label: "Frazer Town" },
      specialties: ["Spinach", "Fenugreek", "Coriander", "Mint"],
      farmType: "terrace",
      rating: 4.9,
      available: true,
      emoji: "🥬"
    },
    {
      id: "f-006",
      name: "Ravi Shankar",
      phone: "9777777777",
      location: { lat: 12.9680, lng: 77.5820, label: "Sadashivanagar" },
      specialties: ["Tomato", "Capsicum", "Beans", "Cucumber"],
      farmType: "balcony",
      rating: 4.4,
      available: true,
      emoji: "🍅"
    },
    {
      id: "f-007",
      name: "Padma Lakshmi",
      phone: "9888888888",
      location: { lat: 12.9810, lng: 77.6060, label: "Benson Town" },
      specialties: ["Drumstick", "Bitter Gourd", "Ridge Gourd", "Ash Gourd"],
      farmType: "backyard",
      rating: 4.6,
      available: true,
      emoji: "🌿"
    },
    {
      id: "f-008",
      name: "Arjun Nair",
      phone: "9999000001",
      location: { lat: 12.9900, lng: 77.5946, label: "Malleswaram" },
      specialties: ["Moringa", "Drumstick", "Aloe Vera", "Neem Leaves"],
      farmType: "terrace",
      rating: 4.7,
      available: true,
      emoji: "🌱"
    },
    {
      id: "f-009",
      name: "Meera Devi",
      phone: "9999000002",
      location: { lat: 12.9600, lng: 77.5820, label: "Basavangudi" },
      specialties: ["Onion", "Garlic", "Chilli", "Ginger"],
      farmType: "community_plot",
      rating: 4.5,
      available: true,
      emoji: "🧅"
    },
    {
      id: "f-010",
      name: "Krishnamurthy S",
      phone: "9999000003",
      location: { lat: 12.9720, lng: 77.6140, label: "Ulsoor" },
      specialties: ["Tomato", "Brinjal", "Ladies Finger", "Cluster Beans"],
      farmType: "backyard",
      rating: 4.3,
      available: true,
      emoji: "🍆"
    },
    {
      id: "f-011",
      name: "Sundaram P",
      phone: "9999000004",
      location: { lat: 12.9850, lng: 77.5800, label: "Rajajinagar Extension" },
      specialties: ["Banana", "Plantain", "Curry Leaves", "Lemon"],
      farmType: "garden",
      rating: 4.8,
      available: true,
      emoji: "🍋"
    },
    {
      id: "f-012",
      name: "Girija Shankar",
      phone: "9999000005",
      location: { lat: 12.9580, lng: 77.5946, label: "Jayanagar 4th Block" },
      specialties: ["Radish", "Carrot", "Beetroot", "Turnip"],
      farmType: "terrace",
      rating: 4.6,
      available: true,
      emoji: "🥕"
    },
    {
      id: "f-013",
      name: "Bhaskar Reddy",
      phone: "9999000006",
      location: { lat: 12.9950, lng: 77.5946, label: "Hebbal" },
      specialties: ["Groundnut", "Horsegram", "Jowar", "Maize"],
      farmType: "farm_plot",
      rating: 4.4,
      available: true,
      emoji: "🌽"
    },
    {
      id: "f-014",
      name: "Nirmala Bai",
      phone: "9999000007",
      location: { lat: 12.9716, lng: 77.6200, label: "HAL Old Airport Road" },
      specialties: ["Papaya", "Guava", "Pomegranate", "Sapota"],
      farmType: "garden",
      rating: 4.7,
      available: true,
      emoji: "🍉"
    },

    // ── 3–6 KM RANGE ─────────────────────────────────────────
    // (outside default consumer 3km range)

    {
      id: "f-015",
      name: "Lakshmi Bai",
      phone: "9333333333",
      location: { lat: 12.9400, lng: 77.5946, label: "Jayanagar 9th Block" },
      specialties: ["Drumstick", "Banana", "Coconut", "Jackfruit"],
      farmType: "backyard",
      rating: 4.5,
      available: true,
      emoji: "🌿"
    },
    {
      id: "f-016",
      name: "Rajesh Kumar",
      phone: "9999000009",
      location: { lat: 12.9716, lng: 77.5400, label: "Peenya" },
      specialties: ["Bottle Gourd", "Pumpkin", "Snake Gourd", "Yam"],
      farmType: "farm_plot",
      rating: 4.3,
      available: true,
      emoji: "🎃"
    },
    {
      id: "f-017",
      name: "Anbu Selvan",
      phone: "9999000010",
      location: { lat: 12.9200, lng: 77.5946, label: "JP Nagar" },
      specialties: ["Tomato", "Onion", "Chilli", "Coriander"],
      farmType: "community_plot",
      rating: 4.6,
      available: true,
      emoji: "🍅"
    },
    {
      id: "f-018",
      name: "Priyanka Gowda",
      phone: "9999000011",
      location: { lat: 13.0100, lng: 77.5946, label: "Yelahanka" },
      specialties: ["Spinach", "Amaranth", "Drumstick Leaves", "Purslane"],
      farmType: "terrace",
      rating: 4.8,
      available: true,
      emoji: "🥬"
    },
    {
      id: "f-019",
      name: "Gopal Krishnan",
      phone: "9999000012",
      location: { lat: 12.9716, lng: 77.6400, label: "Whitefield Junction" },
      specialties: ["Apple Gourd", "Bitter Gourd", "Snake Gourd", "Ivy Gourd"],
      farmType: "backyard",
      rating: 4.2,
      available: true,
      emoji: "🌿"
    },
    {
      id: "f-020",
      name: "Selvi Murugan",
      phone: "9999000013",
      location: { lat: 12.9100, lng: 77.5946, label: "Banashankari" },
      specialties: ["Jasmine", "Rose", "Marigold", "Chrysanthemum"],
      farmType: "garden",
      rating: 4.7,
      available: true,
      emoji: "🌸"
    },

    // ── BEYOND 6 KM ───────────────────────────────────────────

    {
      id: "f-021",
      name: "Murugan Pillai",
      phone: "9999000014",
      location: { lat: 12.9716, lng: 77.5200, label: "Tumkur Road" },
      specialties: ["Rice", "Ragi", "Groundnut", "Sunflower"],
      farmType: "farm_plot",
      rating: 4.5,
      available: true,
      emoji: "🌾"
    },
    {
      id: "f-022",
      name: "Savitha Raman",
      phone: "9999000015",
      location: { lat: 13.0300, lng: 77.5946, label: "Devanahalli" },
      specialties: ["Mango", "Jackfruit", "Lime", "Guava"],
      farmType: "orchard",
      rating: 4.9,
      available: true,
      emoji: "🥭"
    },
    {
      id: "f-023",
      name: "Thangam Durai",
      phone: "9999000016",
      location: { lat: 12.9716, lng: 77.6600, label: "Marathahalli" },
      specialties: ["Okra", "Cluster Beans", "Flat Beans", "French Beans"],
      farmType: "backyard",
      rating: 4.4,
      available: true,
      emoji: "🫘"
    },
    {
      id: "f-024",
      name: "Venkatesan R",
      phone: "9999000017",
      location: { lat: 12.9000, lng: 77.5946, label: "Electronic City" },
      specialties: ["Tapioca", "Yam", "Colocasia", "Sweet Potato"],
      farmType: "farm_plot",
      rating: 4.3,
      available: true,
      emoji: "🥔"
    },
    {
      id: "f-025",
      name: "Saraswathi Iyer",
      phone: "9999000018",
      location: { lat: 13.0500, lng: 77.5946, label: "Doddaballapur Road" },
      specialties: ["Sugarcane", "Banana", "Papaya", "Drumstick"],
      farmType: "orchard",
      rating: 4.8,
      available: true,
      emoji: "🌿"
    }
  ]
};
