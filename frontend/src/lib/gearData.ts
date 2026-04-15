export interface GearItem {
  id: string;
  name: string;
  brand: string;
  description: string;
  price: string;        // e.g. "$29.99" or "$25–$40"
  link: string;         // affiliate or product page URL
  image?: string;       // optional product image URL
  badge?: string;       // e.g. "Editor's Pick", "Popular", "New"
}

export interface GearCategory {
  id: string;
  label: string;
  icon: string;
  items: GearItem[];
}

const GEAR: GearCategory[] = [
  {
    id: "supplements",
    label: "Supplements",
    icon: "💊",
    items: [
      {
        id: "mag-glycinate",
        name: "Magnesium Glycinate",
        brand: "Thorne",
        description: "Supports deep sleep, muscle recovery, and stress response. One of the most bioavailable forms of magnesium.",
        price: "$34",
        link: "https://www.amazon.com",
        badge: "Editor's Pick",
      },
      {
        id: "omega3",
        name: "Omega-3 Fish Oil",
        brand: "Nordic Naturals",
        description: "High-potency EPA/DHA for cardiovascular health, inflammation reduction, and cognitive function.",
        price: "$40",
        link: "https://www.amazon.com",
      },
      {
        id: "vitamin-d",
        name: "Vitamin D3 + K2",
        brand: "Thorne",
        description: "Essential for immune function, bone density, and mood. K2 ensures calcium goes to bones, not arteries.",
        price: "$28",
        link: "https://www.amazon.com",
      },
      {
        id: "creatine",
        name: "Creatine Monohydrate",
        brand: "Momentous",
        description: "5g daily for strength, power output, and cognitive performance. One of the most researched supplements.",
        price: "$40",
        link: "https://www.amazon.com",
        badge: "Popular",
      },
    ],
  },
  {
    id: "sleep",
    label: "Sleep",
    icon: "😴",
    items: [
      {
        id: "oura-ring",
        name: "Oura Ring Gen 4",
        brand: "Oura",
        description: "The gold standard for sleep and recovery tracking. Tracks HRV, sleep stages, body temperature, and readiness.",
        price: "$349",
        link: "https://ouraring.com",
        badge: "Editor's Pick",
      },
      {
        id: "sleep-mask",
        name: "Contoured Sleep Mask",
        brand: "Manta",
        description: "100% blackout, zero eye pressure. Dramatically improves sleep quality in any environment.",
        price: "$35",
        link: "https://www.amazon.com",
      },
      {
        id: "magtech",
        name: "MagTech Magnesium Complex",
        brand: "Natural Stacks",
        description: "Three forms of magnesium for relaxation and deep sleep. Take 30 minutes before bed.",
        price: "$39",
        link: "https://www.amazon.com",
      },
    ],
  },
  {
    id: "recovery",
    label: "Recovery",
    icon: "🔄",
    items: [
      {
        id: "massage-gun",
        name: "Theragun Prime",
        brand: "Therabody",
        description: "Percussive therapy for muscle soreness, tight spots, and post-workout recovery.",
        price: "$249",
        link: "https://www.amazon.com",
      },
      {
        id: "foam-roller",
        name: "Grid Foam Roller",
        brand: "TriggerPoint",
        description: "Multi-density surface for targeted myofascial release. A daily recovery staple.",
        price: "$36",
        link: "https://www.amazon.com",
        badge: "Popular",
      },
      {
        id: "sauna-blanket",
        name: "HigherDOSE Sauna Blanket",
        brand: "HigherDOSE",
        description: "Infrared sauna at home. Supports detox, recovery, and relaxation without a full sauna setup.",
        price: "$599",
        link: "https://www.amazon.com",
      },
      {
        id: "cold-plunge",
        name: "Ice Barrel 400",
        brand: "Ice Barrel",
        description: "Cold water immersion for inflammation, mental toughness, and post-workout recovery.",
        price: "$1,200",
        link: "https://icebarrel.com",
      },
    ],
  },
  {
    id: "fitness",
    label: "Fitness Equipment",
    icon: "🏋️",
    items: [
      {
        id: "adjustable-dumbbells",
        name: "Adjustable Dumbbells",
        brand: "Bowflex",
        description: "Replace 15 sets of weights. Quick-change dial system from 5 to 52.5 lbs per dumbbell.",
        price: "$429",
        link: "https://www.amazon.com",
        badge: "Popular",
      },
      {
        id: "pull-up-bar",
        name: "Wall-Mounted Pull-Up Bar",
        brand: "Rogue",
        description: "Sturdy, permanent pull-up station for upper body and core strength. Essential home gym piece.",
        price: "$120",
        link: "https://www.rogueeurope.eu",
      },
      {
        id: "kettlebell",
        name: "Competition Kettlebell",
        brand: "Titan Fitness",
        description: "Single piece cast iron. Perfect for swings, Turkish get-ups, and full-body conditioning.",
        price: "$65",
        link: "https://www.amazon.com",
      },
    ],
  },
  {
    id: "wearables",
    label: "Wearables",
    icon: "⌚",
    items: [
      {
        id: "apple-watch",
        name: "Apple Watch Series 10",
        brand: "Apple",
        description: "The most capable health wearable for iPhone users. ECG, blood oxygen, sleep tracking, and more.",
        price: "$399",
        link: "https://www.apple.com/apple-watch-series-10/",
      },
      {
        id: "inbody-scale",
        name: "InBody H20N Smart Scale",
        brand: "InBody",
        description: "Clinical-grade body composition analysis at home. Measures muscle mass, body fat %, and more. Syncs to Apple Health.",
        price: "$150",
        link: "https://www.amazon.com",
        badge: "Editor's Pick",
      },
      {
        id: "whoop",
        name: "WHOOP 4.0",
        brand: "WHOOP",
        description: "Screenless strain and recovery tracker. Worn 24/7 for continuous HRV, sleep, and recovery data.",
        price: "$30/mo",
        link: "https://www.whoop.com",
      },
    ],
  },
];

export default GEAR;
