#!/usr/bin/env node
/**
 * Generates city-specific product page content for all cities × all products.
 * Outputs updated landing-pages.json with full city_products array.
 *
 * Usage: node scripts/generate-city-products.js
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const landingPages = JSON.parse(fs.readFileSync(path.join(dataDir, 'landing-pages.json'), 'utf8'));
const products = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf8'));

// Build flat product list
const allProducts = [];
for (const [line, prods] of Object.entries(products)) {
  for (const p of prods) {
    allProducts.push({ ...p, line });
  }
}

// ─── State-specific insurance data ───────────────────────────────────────────

const stateData = {
  KY: {
    name: 'Kentucky',
    autoMinimum: '25/50/25',
    autoNotes: 'Kentucky is a choice no-fault state, requiring $10,000 in Personal Injury Protection (PIP) plus minimum liability of 25/50/25.',
    uninsuredRate: 'Kentucky has one of the highest uninsured driver rates in the country.',
    workersComp: 'Kentucky requires workers compensation for any business with one or more employees.',
    workersCompThreshold: '1+ employees',
    healthMarketplace: 'kynect (Kentucky\'s state-based health insurance marketplace)',
    medicaidExpanded: true,
    medicaidNote: 'Kentucky expanded Medicaid under the ACA, covering adults earning up to 138% of the federal poverty level.',
    seismicRisk: 'Western Kentucky sits in the New Madrid Seismic Zone, one of the most active fault zones east of the Rockies.',
    floodNote: 'Many Kentucky communities along the Ohio River, Green River, and their tributaries sit in FEMA-designated flood zones.',
    bondNote: 'Kentucky requires surety bonds for certain licensed trades and public projects.',
    motorcycleNote: 'Kentucky requires the same minimum liability coverage for motorcycles as for automobiles (25/50/25).',
    boatNote: 'Kentucky does not require boat insurance by law, but lenders and marinas on Kentucky Lake, Lake Barkley, and the Ohio River typically require it.',
    petNote: 'Kentucky has a growing number of veterinary clinics and emergency animal hospitals, with vet costs averaging $500-$2,000 for emergency visits.',
  },
  IN: {
    name: 'Indiana',
    autoMinimum: '25/50/25',
    autoNotes: 'Indiana is an at-fault (tort) state with minimum liability requirements of 25/50/25. No PIP is required, but uninsured motorist coverage is recommended.',
    uninsuredRate: 'Indiana has a notable uninsured driver population, making uninsured motorist coverage an important addition.',
    workersComp: 'Indiana requires workers compensation for all employers with one or more employees, with limited exceptions.',
    workersCompThreshold: '1+ employees',
    healthMarketplace: 'the federal marketplace (healthcare.gov)',
    medicaidExpanded: true,
    medicaidNote: 'Indiana expanded Medicaid through the Healthy Indiana Plan (HIP 2.0), covering adults earning up to 138% of the federal poverty level.',
    seismicRisk: 'Southern Indiana is within the New Madrid Seismic Zone influence area, though earthquake risk decreases further north.',
    floodNote: 'Indiana communities along the Ohio River, Wabash River, and White River face flood risk that standard homeowners insurance does not cover.',
    bondNote: 'Indiana requires surety bonds for many contractor licenses and public project bids.',
    motorcycleNote: 'Indiana requires motorcycle insurance with the same minimum liability limits as automobiles (25/50/25).',
    boatNote: 'Indiana does not require boat insurance, but marinas on Lake Monroe, Patoka Lake, and other waterways typically require proof of coverage.',
    petNote: 'Indiana has a strong network of veterinary clinics and specialty animal hospitals, with emergency visits averaging $500-$2,000.',
  },
  TN: {
    name: 'Tennessee',
    autoMinimum: '25/50/15',
    autoNotes: 'Tennessee is an at-fault state with minimum liability requirements of 25/50/15. No PIP is required, but higher limits are strongly recommended.',
    uninsuredRate: 'Tennessee has a significant uninsured driver population, making uninsured and underinsured motorist coverage essential.',
    workersComp: 'Tennessee requires workers compensation for businesses with five or more employees.',
    workersCompThreshold: '5+ employees',
    healthMarketplace: 'the federal marketplace (healthcare.gov)',
    medicaidExpanded: false,
    medicaidNote: 'Tennessee has not expanded Medicaid under the ACA. TennCare covers children, pregnant women, and adults with disabilities who meet income requirements.',
    seismicRisk: 'Western Tennessee sits directly in the New Madrid Seismic Zone, with Memphis and surrounding areas at significant earthquake risk.',
    floodNote: 'Tennessee communities along the Cumberland River, Tennessee River, and Mississippi River face flood risk that standard homeowners insurance does not cover.',
    bondNote: 'Tennessee requires surety bonds for many contractor licenses and public construction projects.',
    motorcycleNote: 'Tennessee requires motorcycle insurance with the same minimum liability limits as automobiles (25/50/15).',
    boatNote: 'Tennessee does not require boat insurance, but marinas on the Tennessee River, Norris Lake, and other waterways typically require proof of coverage.',
    petNote: 'Tennessee has veterinary costs averaging $500-$2,000 for emergency visits, with major veterinary hospitals in Nashville, Memphis, and Knoxville.',
  }
};

// ─── Slug generation helpers ─────────────────────────────────────────────────

function productSlug(product) {
  // Map product IDs to URL-friendly slugs used in city-product pages
  const slugMap = {
    'home': 'home-insurance',
    'auto': 'auto-insurance',
    'renters': 'renters-insurance',
    'umbrella': 'umbrella-insurance',
    'flood': 'flood-insurance',
    'motorcycle': 'motorcycle-insurance',
    'boat': 'boat-insurance',
    'classic-car': 'classic-car-insurance',
    'earthquake': 'earthquake-insurance',
    'pet': 'pet-insurance',
    'general-liability': 'commercial-insurance',
    'commercial-property': 'commercial-property-insurance',
    'commercial-auto': 'commercial-auto-insurance',
    'workers-compensation': 'workers-compensation-insurance',
    'cyber': 'cyber-insurance',
    'bonds': 'surety-bonds',
    'builders-risk': 'builders-risk-insurance',
    'special-event': 'special-event-insurance',
    'professional-liability': 'professional-liability-insurance',
    'medicare': 'medicare',
    'medicaid': 'medicaid',
    'supplemental-health': 'supplemental-health-insurance',
    'group-health': 'group-health-insurance',
    'individual-health': 'individual-health-insurance',
    'family-health': 'family-health-insurance',
    'dental-vision': 'dental-vision-insurance',
    'term-life': 'term-life-insurance',
    'whole-life': 'whole-life-insurance',
    'annuities': 'annuities',
    'disability': 'disability-insurance',
    'final-expense': 'final-expense-insurance',
  };
  return slugMap[product.id] || product.id;
}

function productDisplayName(product) {
  const nameMap = {
    'general-liability': 'Commercial Insurance',
    'dental-vision': 'Dental, Vision & Hearing Insurance',
  };
  return nameMap[product.id] || product.name;
}

// ─── Content generators per product ──────────────────────────────────────────
// Each returns { h1, intro, faqs } given (city, state, county, stateInfo, product)

const generators = {

  // ── PERSONAL LINE ──────────────────────────────────────────────────────────

  home(city, state, county, si, prod) {
    const h1 = `Home Insurance for ${city} Families`;
    const intro = `${city} homeowners face a combination of weather risks that vary by neighborhood and property type. ${si.floodNote.replace('Many ' + si.name + ' communities', 'Properties in ' + county)} Standard homeowners insurance covers wind, hail, and fire damage, but flood and earthquake damage require separate policies. Whether you own a newer home in a growing subdivision or an established property in one of ${city}'s older neighborhoods, the right home insurance starts with understanding what is actually covered and what is not. As an independent agency, we compare rates from top-rated carriers to find coverage that fits your home and your budget in ${county}.`;
    const faqs = [
      {
        q: `How much does home insurance cost in ${city}, ${state}?`,
        a: `Most ${city} homeowners pay between ${prod.typical_cost_range || '$1,200 and $2,400 per year'} depending on the home's age, value, construction, and distance from fire services. Factors like roof condition and claims history also affect your rate. We shop multiple carriers to find the best price for your specific situation.`
      },
      {
        q: `Does home insurance cover flooding in ${city}?`,
        a: `No. Standard homeowners insurance does not cover flood damage. ${city} properties near waterways or in FEMA-designated flood zones need a separate flood insurance policy. Even properties outside high-risk zones can flood. We can help you determine your flood risk and find the right coverage.`
      },
      {
        q: `What should ${city} homeowners know about storm damage claims?`,
        a: `${si.name} sees severe thunderstorms, hail, and high winds, especially in spring. Make sure your policy covers full roof replacement at replacement cost, not just depreciated value. We recommend replacement cost coverage for both the structure and personal belongings so you are not left paying the gap after a claim.`
      }
    ];
    return { h1, intro, faqs };
  },

  auto(city, state, county, si, prod) {
    const h1 = `Auto Insurance for ${city} Drivers`;
    const intro = `${si.autoNotes} But state minimums are often not enough to protect your assets in a serious accident, especially if you commute through ${city}'s busier corridors or drive on highways regularly. ${si.uninsuredRate} We represent dozens of auto insurance carriers and can compare rates side by side to find the best price for your driving profile, vehicle, and coverage needs in ${county}.`;
    const faqs = [
      {
        q: `What auto insurance is required in ${city}, ${state}?`,
        a: `${si.name} requires minimum liability of ${si.autoMinimum}. ${state === 'KY' ? 'Plus $10,000 in PIP (Personal Injury Protection). ' : ''}However, we recommend higher limits, especially for drivers commuting on highways or through high-traffic areas in ${city}.`
      },
      {
        q: `How much does auto insurance cost in ${city}?`,
        a: `Rates vary based on your driving record, vehicle, and coverage levels. Most ${city} drivers pay between $1,000 and $2,800 per year. We compare rates from top-rated carriers to find the best option for your situation.`
      },
      {
        q: `Do I need uninsured motorist coverage in ${state}?`,
        a: `We strongly recommend it. ${si.uninsuredRate} Uninsured and underinsured motorist coverage protects you if you are hit by someone without adequate insurance. The cost is modest relative to the protection it provides.`
      }
    ];
    return { h1, intro, faqs };
  },

  renters(city, state, county, si, prod) {
    const h1 = `Renters Insurance in ${city}, ${state}`;
    const intro = `If you rent an apartment, house, or condo in ${city}, your landlord's insurance covers the building but not your belongings. Renters insurance protects your personal property from theft, fire, water damage, and other covered events. It also provides liability coverage if someone is injured in your rental unit and covers additional living expenses if your rental becomes uninhabitable. At ${prod.typical_cost_range || '$15 to $30 per month'}, renters insurance is one of the most affordable and overlooked types of coverage. Many ${city} landlords now require it as a lease condition, but even if yours does not, the protection is worth it for tenants in ${county}.`;
    const faqs = [
      {
        q: `How much does renters insurance cost in ${city}?`,
        a: `Most ${city} renters pay between $15 and $30 per month depending on the amount of personal property coverage and deductible you choose. Bundling with auto insurance often saves an additional 5-15%.`
      },
      {
        q: `Is renters insurance required in ${city}, ${state}?`,
        a: `It is not required by ${si.name} law, but many ${city} landlords and property management companies require it as a condition of the lease. Even if it is not required, renters insurance protects your belongings and provides liability coverage that your landlord's policy does not.`
      },
      {
        q: `What does renters insurance cover in ${city}?`,
        a: `Renters insurance covers your personal belongings (furniture, electronics, clothing) against theft, fire, and water damage. It also includes liability coverage if someone is injured in your unit and additional living expenses if you are displaced by a covered event. Flood damage requires a separate policy.`
      }
    ];
    return { h1, intro, faqs };
  },

  umbrella(city, state, county, si, prod) {
    const h1 = `Umbrella Insurance in ${city}, ${state}`;
    const intro = `An umbrella policy adds an extra layer of liability protection above your home and auto insurance limits. In ${city}, where property values and medical costs continue to rise, a single serious accident or lawsuit can exceed your standard policy limits quickly. Umbrella insurance typically provides $1 million or more in additional coverage for around $200 to $400 per year, making it one of the most affordable ways to protect your family's financial future. If you own a home, have teenage drivers, a pool, or recreational vehicles, umbrella coverage is worth a serious look. It also extends coverage beyond your home and auto to incidents that happen anywhere, including rental properties, vacation travel, and volunteer activities throughout ${county} and beyond.`;
    const faqs = [
      {
        q: `How much does umbrella insurance cost in ${city}?`,
        a: `Most ${city} families pay $200 to $400 per year for $1 million in umbrella coverage. The exact cost depends on your home value, number of vehicles, and risk profile. It is one of the best values in insurance.`
      },
      {
        q: `Who needs umbrella insurance in ${state}?`,
        a: `Anyone with assets to protect. If you own a home, have a pool, own watercraft, or have teenage drivers, umbrella insurance is especially important. A lawsuit that exceeds your auto or home policy limits could put your savings, home equity, and future earnings at risk.`
      },
      {
        q: `Does umbrella insurance cover rental properties in ${city}?`,
        a: `Yes. If you own a rental property in ${city} or elsewhere, your umbrella policy extends liability coverage beyond your landlord insurance limits. This is especially important for property owners with tenants, as a single lawsuit can exceed a standard landlord policy.`
      }
    ];
    return { h1, intro, faqs };
  },

  flood(city, state, county, si, prod) {
    const h1 = `Flood Insurance in ${city}, ${state}`;
    const intro = `Standard homeowners insurance does not cover flood damage, and ${city} is no exception. ${si.floodNote.replace('Many ' + si.name + ' communities', 'Properties in and around ' + city)} Flood policies are available through the National Flood Insurance Program (NFIP) and private carriers. Even if your property is not in a high-risk flood zone, more than 25% of flood claims come from moderate- and low-risk areas. Whether you own or rent in ${county}, understanding your flood risk and coverage options is the first step toward protecting your property. We compare NFIP and private flood options to find the best fit for your situation.`;
    const faqs = [
      {
        q: `Is flood insurance required in ${city}, ${state}?`,
        a: `Flood insurance is required by mortgage lenders if your property is in a FEMA-designated Special Flood Hazard Area (Zone A or V). Even if not required, it is recommended for ${city} homeowners near any waterway, as flooding can happen outside of mapped flood zones.`
      },
      {
        q: `How much does flood insurance cost in ${city}?`,
        a: `Flood insurance typically costs $500 to $2,500 per year depending on your flood zone designation, elevation, building type, and coverage amount. NFIP and private carriers offer different pricing, and we compare both to find the best rate.`
      },
      {
        q: `What does flood insurance cover?`,
        a: `Flood insurance covers structural damage and personal property loss caused by flooding, including overflow of rivers and streams, heavy rainfall runoff, and storm surge. It does not cover sewer backup unless you add a separate endorsement to your homeowners policy.`
      }
    ];
    return { h1, intro, faqs };
  },

  motorcycle(city, state, county, si, prod) {
    const h1 = `Motorcycle Insurance in ${city}, ${state}`;
    const intro = `${si.motorcycleNote} But minimum coverage often is not enough, especially for riders on ${city}'s highways and scenic routes. ${si.name}'s riding season means your bike is on the road for much of the year, and the risk of serious injury in a motorcycle accident is significantly higher than in a car. Uninsured motorist coverage is critical, and collision and comprehensive coverage protect your investment against theft, vandalism, and weather damage. We compare motorcycle insurance rates from multiple carriers to find the right balance of coverage and price for ${county} riders.`;
    const faqs = [
      {
        q: `How much does motorcycle insurance cost in ${city}?`,
        a: `Most ${city} riders pay between $300 and $1,500 per year depending on the bike type, engine size, riding experience, and coverage levels. Sport bikes cost more to insure than cruisers. We shop multiple carriers to find competitive rates.`
      },
      {
        q: `What motorcycle insurance is required in ${state}?`,
        a: `${si.name} requires minimum liability coverage of ${si.autoMinimum} for registered motorcycles, the same as automobiles. We recommend higher limits plus uninsured motorist and comprehensive coverage for full protection.`
      },
      {
        q: `Does motorcycle insurance cover custom parts?`,
        a: `Standard policies typically cover custom parts up to a stated limit. If your bike has aftermarket modifications that increase its value, you may need a custom parts and equipment endorsement. Let us know what you have added so we can make sure it is covered.`
      }
    ];
    return { h1, intro, faqs };
  },

  boat(city, state, county, si, prod) {
    const h1 = `Boat Insurance in ${city}, ${state}`;
    const intro = `${si.boatNote} Whether you have a bass boat, pontoon, jet ski, or sailboat, boat insurance covers your watercraft, equipment, liability for injuries or property damage, and towing and salvage costs. Your homeowners policy provides little to no coverage for watercraft, especially once the boat is on the water. For ${city} boaters, the right policy depends on the type of vessel, where you use it, and how it is stored. We compare boat insurance from multiple carriers to find coverage that matches your vessel and your budget.`;
    const faqs = [
      {
        q: `Is boat insurance required in ${state}?`,
        a: `${si.name} does not require boat insurance by law. However, most marinas and lenders require proof of coverage. Even without a requirement, liability coverage protects you if you cause injury or property damage while on the water.`
      },
      {
        q: `How much does boat insurance cost in ${city}?`,
        a: `Most boat owners pay between $200 and $1,000 per year depending on the boat type, value, engine size, and navigational territory. Pontoons and fishing boats are typically less expensive to insure than performance boats. We compare rates from multiple carriers.`
      },
      {
        q: `Does boat insurance cover jet skis and personal watercraft?`,
        a: `Yes. Personal watercraft like jet skis can be covered under a boat insurance policy. Given their speed and accident risk, liability coverage is especially important. We can add personal watercraft to your policy or write a standalone policy.`
      }
    ];
    return { h1, intro, faqs };
  },

  'classic-car'(city, state, county, si, prod) {
    const h1 = `Classic Car Insurance in ${city}, ${state}`;
    const intro = `Classic and antique car insurance is fundamentally different from standard auto insurance. Instead of depreciating your vehicle's value over time, classic car policies use an agreed value that you and the carrier set together, so you know exactly what you will receive if your vehicle is totaled. ${city} has an active car show and collector community, and many enthusiasts store and maintain vehicles that are worth far more than their daily drivers. Classic car policies typically require limited annual mileage and enclosed storage, but they cost significantly less than standard auto insurance because the driving exposure is lower. We work with specialty carriers that understand collector vehicles and can insure everything from prewar classics to muscle cars and modern collectibles in ${county}.`;
    const faqs = [
      {
        q: `How much does classic car insurance cost in ${city}?`,
        a: `Most classic car owners pay between $200 and $800 per year, significantly less than standard auto insurance. Rates depend on the agreed value of the vehicle, annual mileage, storage type, and your driving record.`
      },
      {
        q: `What qualifies as a classic car for insurance in ${state}?`,
        a: `Most carriers consider vehicles 20-25 years or older as classics, though some insure newer collectibles and limited-production models. The vehicle must be stored in an enclosed structure and driven on a limited basis, typically under 5,000 to 7,500 miles per year.`
      },
      {
        q: `What is agreed value coverage for classic cars?`,
        a: `Agreed value means you and the carrier agree on the vehicle's worth when the policy is written. If the car is totaled, you receive that full amount, not a depreciated value. This is critical for collector vehicles whose market value often exceeds standard valuation guides.`
      }
    ];
    return { h1, intro, faqs };
  },

  earthquake(city, state, county, si, prod) {
    const h1 = `Earthquake Insurance in ${city}, ${state}`;
    const seismicRelevance = (state === 'TN' && ['Memphis', 'Nashville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Johnson City'].includes(city)) ||
                             (state === 'KY' && ['Owensboro', 'Henderson', 'Louisville', 'Bowling Green', 'Elizabethtown', 'Mt. Washington', 'Frankfort', 'Lexington'].includes(city)) ||
                             (state === 'IN' && ['Evansville', 'Indianapolis', 'Bloomington', 'Lafayette'].includes(city));
    const riskLevel = (state === 'TN' && city === 'Memphis') || (state === 'KY' && ['Owensboro', 'Henderson'].includes(city)) || (state === 'IN' && city === 'Evansville')
      ? 'high' : 'moderate';
    const intro = riskLevel === 'high'
      ? `Standard homeowners insurance does not cover earthquake damage, and ${city} sits in one of the most seismically active areas east of the Rocky Mountains. ${si.seismicRisk} A major earthquake on the New Madrid fault could cause widespread structural damage across ${county}. Earthquake insurance covers your home's structure, personal belongings, and additional living expenses if your home becomes uninhabitable. Deductibles are typically 5-15% of your coverage amount, which is higher than standard policies, but the alternative is absorbing the full cost of structural repairs yourself. We help ${city} homeowners understand their earthquake risk and find coverage from carriers that write in this region.`
      : `Standard homeowners insurance does not cover earthquake damage. While ${city} is not on a major fault line, ${si.seismicRisk} Even moderate seismic activity can cause foundation cracks, chimney damage, and structural shifting. Earthquake insurance covers your home's structure, personal belongings, and additional living expenses. Deductibles are typically 5-15% of coverage, but premiums in lower-risk areas like ${city} are often quite affordable, typically $100 to $400 per year. We help homeowners in ${county} evaluate their earthquake risk and find the right coverage.`;
    const faqs = [
      {
        q: `Do I need earthquake insurance in ${city}, ${state}?`,
        a: riskLevel === 'high'
          ? `${city} is near the New Madrid Seismic Zone, making earthquake insurance a serious consideration. A significant quake could cause major structural damage across ${county}. While not required by law or lenders, the financial exposure from an uninsured earthquake loss is substantial.`
          : `While ${city} is not in the highest-risk zone, ${si.name} does experience seismic activity. Earthquake insurance is affordable in moderate-risk areas and covers damage that your homeowners policy explicitly excludes. It is worth considering, especially for older homes.`
      },
      {
        q: `How much does earthquake insurance cost in ${city}?`,
        a: `Earthquake insurance in ${city} typically costs $100 to $800 per year depending on your home's construction type, foundation, age, and coverage amount. Brick and masonry homes cost more to insure than wood-frame homes. Deductibles are typically 5-15% of coverage.`
      },
      {
        q: `What does earthquake insurance cover?`,
        a: `Earthquake insurance covers damage to your home's structure, attached structures (garage, deck), personal belongings, and additional living expenses if your home is uninhabitable after a quake. It does not cover fire following an earthquake (that is covered by your homeowners policy) or flood damage.`
      }
    ];
    return { h1, intro, faqs };
  },

  pet(city, state, county, si, prod) {
    const h1 = `Pet Insurance in ${city}, ${state}`;
    const intro = `Pet insurance reimburses veterinary costs for accidents and illnesses, helping ${city} pet owners avoid choosing between their pet's health and a surprise vet bill. A single emergency visit can cost $1,000 to $5,000 or more, and ongoing treatment for conditions like cancer, diabetes, or orthopedic injuries can run into the tens of thousands. ${si.petNote} Plans are available for dogs and cats starting around $30 per month for dogs and $20 per month for cats, with options for accident-only, comprehensive, and wellness coverage. We help ${county} pet owners compare plans to find the right balance of coverage, deductible, and monthly cost.`;
    const faqs = [
      {
        q: `How much does pet insurance cost in ${city}?`,
        a: `Most ${city} dog owners pay $30 to $80 per month, and cat owners pay $20 to $50 per month. Costs depend on your pet's breed, age, coverage type, reimbursement percentage, and deductible. Younger pets are less expensive to insure.`
      },
      {
        q: `Is pet insurance worth it in ${city}?`,
        a: `If your pet needs emergency surgery or treatment for a serious illness, pet insurance can save you thousands of dollars. A torn ACL repair can cost $3,000 to $5,000, and cancer treatment can exceed $10,000. Pet insurance makes these decisions about your pet's health, not your finances.`
      },
      {
        q: `Does pet insurance cover pre-existing conditions?`,
        a: `No. Pet insurance does not cover pre-existing conditions, which is why enrolling your pet while they are young and healthy provides the most value. Some carriers will cover conditions that have been cured and symptom-free for a specified period.`
      }
    ];
    return { h1, intro, faqs };
  },

  // ── COMMERCIAL LINE ────────────────────────────────────────────────────────

  'general-liability'(city, state, county, si, prod) {
    const h1 = `Business Insurance for ${city} Companies`;
    const intro = `Whether you run a contracting business, a restaurant, a retail shop, or a professional services firm in ${city}, general liability insurance is the foundation of your commercial insurance program. It protects your business if a customer, vendor, or visitor is injured at your location, or if your work damages someone else's property. Most commercial leases, vendor contracts, and government permits in ${county} require proof of general liability coverage, typically with limits of $1 million per occurrence and $2 million aggregate. We work with specialty carriers that understand ${si.name} business requirements and can provide certificates of insurance, additional insured endorsements, and competitive rates for ${city} businesses across a wide range of industries.`;
    const faqs = [
      {
        q: `What insurance does a small business in ${city} need?`,
        a: `At minimum, most ${city} businesses need general liability, commercial property, and workers compensation (${si.workersComp.toLowerCase().replace(si.name.toLowerCase() + ' requires workers compensation for ', 'required in ' + state + ' for ')}). Contractors also need commercial auto and may need surety bonds. We tailor coverage to your specific industry and risk profile.`
      },
      {
        q: `How much does commercial insurance cost in ${city}?`,
        a: `Costs vary significantly by industry, revenue, and employee count. A small contractor might pay $2,000 to $5,000 per year for general liability, while a restaurant could pay $3,000 to $8,000. We get quotes from multiple carriers to find the best rate for your ${city} business.`
      },
      {
        q: `Do ${city} contractors need a surety bond?`,
        a: `Many do. ${si.bondNote} We write bonds through multiple surety markets and can usually get approval within a few days for qualified contractors in ${county}.`
      }
    ];
    return { h1, intro, faqs };
  },

  'commercial-property'(city, state, county, si, prod) {
    const h1 = `Commercial Property Insurance in ${city}, ${state}`;
    const intro = `Commercial property insurance protects your business's physical assets in ${city}: the building you own or lease, equipment, inventory, furniture, signage, and business income lost during a covered event. Whether you operate from a storefront, office, warehouse, or mixed-use space in ${county}, your personal and general liability policies do not cover your business property. Commercial property coverage insures against fire, wind, hail, theft, vandalism, and other named perils. For ${city} businesses, we also recommend reviewing business income coverage, which replaces lost revenue while your property is being repaired after a covered loss. We compare policies from multiple carriers to find the right coverage at a competitive price.`;
    const faqs = [
      {
        q: `How much does commercial property insurance cost in ${city}?`,
        a: `Most ${city} businesses pay $750 to $5,000 per year depending on the property value, contents, building construction type, location, and industry. Fire protection class and proximity to fire services also affect your rate. We compare multiple carriers to find the best price.`
      },
      {
        q: `Does commercial property insurance cover natural disasters in ${city}?`,
        a: `Commercial property insurance covers wind, hail, fire, and lightning. Flood and earthquake damage require separate policies. Given ${si.name}'s weather patterns, we recommend reviewing your flood and earthquake exposure as part of your commercial property review.`
      },
      {
        q: `What is business income coverage?`,
        a: `Business income coverage, also called business interruption insurance, replaces your lost net income and covers ongoing expenses (rent, payroll, utilities) while your ${city} business is shut down due to a covered property loss. It is one of the most important and most overlooked commercial coverages.`
      }
    ];
    return { h1, intro, faqs };
  },

  'commercial-auto'(city, state, county, si, prod) {
    const h1 = `Commercial Auto Insurance in ${city}, ${state}`;
    const intro = `If your business owns, leases, or uses vehicles in ${city}, you need commercial auto insurance. Personal auto policies typically exclude vehicles used for business purposes, which means a claim involving a company truck, delivery van, or employee driving for work could be denied. Commercial auto covers liability for accidents, physical damage to your vehicles, and medical payments. For ${city} businesses with multiple vehicles, fleet pricing can reduce your per-vehicle cost. Whether you operate one work truck or a fleet serving ${county} and beyond, we compare commercial auto rates from carriers that specialize in your industry.`;
    const faqs = [
      {
        q: `When do I need commercial auto insurance in ${city}?`,
        a: `You need commercial auto if your vehicle is registered to a business, used to transport goods or equipment, used by employees other than the owner, or has commercial plates. Even if you use your personal vehicle for business errands, your personal auto policy may not cover business-related claims.`
      },
      {
        q: `How much does commercial auto insurance cost in ${city}?`,
        a: `Most ${city} businesses pay $1,200 to $4,000 per vehicle per year depending on vehicle type, driver records, radius of operation, and coverage limits. Fleet discounts are available for businesses with multiple vehicles. We compare rates from commercial auto specialists.`
      },
      {
        q: `Does commercial auto cover employees driving their own cars for work?`,
        a: `No. If employees use their personal vehicles for business purposes, you need hired and non-owned auto coverage, which is an endorsement on your commercial auto or general liability policy. This is important for ${city} businesses where employees drive to client sites or make deliveries.`
      }
    ];
    return { h1, intro, faqs };
  },

  'workers-compensation'(city, state, county, si, prod) {
    const h1 = `Workers Compensation Insurance in ${city}, ${state}`;
    const intro = `${si.workersComp}, and penalties for non-compliance include fines, stop-work orders, and personal liability for injuries. Workers compensation covers medical expenses, rehabilitation, and lost wages for employees injured on the job, regardless of fault. For ${city} businesses, rates vary significantly based on your industry classification, payroll, and claims history. High-risk trades like roofing and construction pay much higher rates than office-based businesses. We represent multiple workers compensation carriers and can often find competitive rates by improving your experience modifier and verifying your classification codes. Whether you have one employee or a hundred in ${county}, we make sure you are properly covered and competitively priced.`;
    const faqs = [
      {
        q: `Is workers comp required for businesses in ${city}, ${state}?`,
        a: `${si.workersComp}. Penalties for non-compliance can include fines of up to $1,000 per day, stop-work orders, and personal liability for any employee injuries. We help ${city} businesses stay compliant with competitive rates.`
      },
      {
        q: `How much does workers compensation cost in ${city}?`,
        a: `Workers comp rates are based on your industry classification code, total payroll, and experience modifier. Rates range from $0.30 per $100 of payroll for low-risk office work to $15 or more per $100 for high-risk trades like roofing. We shop multiple carriers to find the best rate for your ${city} business.`
      },
      {
        q: `What is an experience modifier and how does it affect my ${city} business?`,
        a: `Your experience modifier (e-mod) compares your claims history to similar businesses in your industry. A modifier below 1.0 means fewer claims than average and lower premiums. Above 1.0 means more claims and higher costs. We help ${city} businesses implement safety programs to improve their e-mod over time.`
      }
    ];
    return { h1, intro, faqs };
  },

  cyber(city, state, county, si, prod) {
    const h1 = `Cyber Insurance in ${city}, ${state}`;
    const intro = `Cyber attacks are not limited to large corporations. Small and mid-sized businesses in ${city} are increasingly targeted because they often have weaker security infrastructure and valuable customer data. A single data breach can cost tens of thousands of dollars in forensic investigation, customer notification, credit monitoring, legal defense, and regulatory fines. Ransomware attacks can shut down operations entirely. Cyber insurance covers these costs and provides access to breach response teams that can help your business recover quickly. For ${city} businesses that handle customer financial data, health records, or any personally identifiable information, cyber coverage is becoming essential. Many client contracts and vendor agreements now require proof of cyber insurance.`;
    const faqs = [
      {
        q: `Does my ${city} business need cyber insurance?`,
        a: `If your business stores customer data, processes credit cards, uses email, or relies on computer systems, you have cyber exposure. Even businesses that think they are too small to be targeted are at risk. ${city} businesses in healthcare, financial services, retail, and professional services are especially vulnerable.`
      },
      {
        q: `How much does cyber insurance cost in ${city}?`,
        a: `Most small businesses pay $500 to $5,000 per year for cyber insurance depending on revenue, industry, number of records stored, and security measures in place. The cost is modest compared to the average data breach cost, which exceeds $100,000 for small businesses.`
      },
      {
        q: `What does cyber insurance cover?`,
        a: `Cyber insurance covers data breach response costs (forensics, notification, credit monitoring), ransomware payments and recovery, business income lost during an attack, legal defense and regulatory fines, and liability to affected customers. Some policies also cover social engineering fraud and wire transfer losses.`
      }
    ];
    return { h1, intro, faqs };
  },

  bonds(city, state, county, si, prod) {
    const h1 = `Surety Bonds in ${city}, ${state}`;
    const intro = `A surety bond is a three-party guarantee: the bonding company guarantees to a project owner or government agency that your ${city} business will fulfill its contractual or legal obligations. If you do not, the bond pays the claim, and you owe the surety company back. ${si.bondNote} Contractors bidding on public projects, licensed professionals, and businesses obtaining certain permits frequently need bonds. We write bonds through multiple surety markets and can handle contractor license bonds, bid bonds, performance and payment bonds, notary bonds, and various license and permit bonds required in ${county}. Approval is often available within a few business days.`;
    const faqs = [
      {
        q: `What types of surety bonds do ${city} businesses need?`,
        a: `The most common types are contractor license bonds, bid bonds, performance bonds, payment bonds, and notary bonds. The specific bond required depends on your industry, the project, and ${si.name} licensing requirements. We write all types through multiple surety markets.`
      },
      {
        q: `How much does a surety bond cost in ${city}?`,
        a: `Surety bond premiums are typically 1% to 15% of the bond amount, depending on the bond type, your personal and business credit, financial statements, and experience. A $25,000 contractor license bond might cost $250 to $1,500 per year. We shop multiple markets to find the best rate.`
      },
      {
        q: `How quickly can I get a surety bond in ${city}?`,
        a: `Many bonds can be approved and issued within 1 to 3 business days. Larger performance and payment bonds may take longer as they require financial underwriting. We work with multiple surety companies and can expedite the process for ${city} contractors and businesses.`
      }
    ];
    return { h1, intro, faqs };
  },

  'builders-risk'(city, state, county, si, prod) {
    const h1 = `Builders Risk Insurance in ${city}, ${state}`;
    const intro = `Builders risk insurance covers a building under construction, renovation, or addition in ${city} against fire, wind, theft, vandalism, and other covered perils during the construction period. Your commercial property policy does not cover structures being built or extensively renovated. For ${city} contractors, developers, and property owners, builders risk protects the structure, materials on site, and equipment from the ground-up phase through project completion. Policies are typically written for the duration of the project and cover the total completed value. Whether you are building new construction, renovating a commercial space, or adding to an existing structure in ${county}, we compare builders risk options from carriers experienced with ${si.name} construction projects.`;
    const faqs = [
      {
        q: `Who needs builders risk insurance in ${city}?`,
        a: `Any contractor, developer, or property owner with an active construction or major renovation project in ${city} should carry builders risk insurance. Most construction contracts and lenders require it. The policy covers the building, materials, and equipment on site during the construction period.`
      },
      {
        q: `How much does builders risk insurance cost in ${city}?`,
        a: `Builders risk typically costs 1% to 4% of the total project cost. A $500,000 construction project might pay $5,000 to $20,000 for builders risk coverage. Costs depend on project type, construction materials, duration, location, and security measures on site.`
      },
      {
        q: `What does builders risk insurance cover?`,
        a: `Builders risk covers the structure under construction, building materials and supplies on site or in transit, temporary structures (scaffolding, fencing), and soft costs (architect fees, permits). It does not cover worker injuries (workers comp), faulty workmanship, or tools and equipment owned by contractors (inland marine).`
      }
    ];
    return { h1, intro, faqs };
  },

  'special-event'(city, state, county, si, prod) {
    const h1 = `Special Event Insurance in ${city}, ${state}`;
    const intro = `If you are planning a wedding, festival, corporate event, fundraiser, or community gathering in ${city}, special event insurance provides liability coverage and optional cancellation protection for your event. Most venues, parks, and event spaces in ${county} require proof of event insurance before they will finalize your booking. Event insurance covers bodily injury and property damage claims arising from your event, and optional coverage can protect your financial investment if the event must be cancelled due to severe weather, venue issues, or other covered reasons. Policies are affordable, typically $75 to $500 per event, and can be purchased online with same-day certificates of insurance.`;
    const faqs = [
      {
        q: `How much does event insurance cost in ${city}?`,
        a: `Most ${city} event insurance policies cost $75 to $500 depending on the number of attendees, event type, whether alcohol is served, and the venue's coverage requirements. Weddings and events with alcohol typically cost more due to higher liability exposure.`
      },
      {
        q: `Do I need event insurance for a wedding in ${city}?`,
        a: `Most ${city} wedding venues require proof of event liability insurance, typically $1 million per occurrence. Event insurance also protects you personally if a guest is injured during your wedding. Cancellation coverage is optional but can protect your financial investment in the event.`
      },
      {
        q: `Does event insurance cover alcohol-related incidents?`,
        a: `Yes, if you select host liquor liability coverage. This covers incidents involving alcohol served at your event. If you are hiring a licensed bartender or caterer with their own liquor license, they should carry their own coverage, but host liquor liability provides an additional layer of protection for you as the event host.`
      }
    ];
    return { h1, intro, faqs };
  },

  'professional-liability'(city, state, county, si, prod) {
    const h1 = `Professional Liability Insurance in ${city}, ${state}`;
    const intro = `Professional liability insurance, also called Errors and Omissions (E&O), protects ${city} professionals against claims that their advice, services, or work product caused a client financial harm. Unlike general liability, which covers physical injury and property damage, professional liability covers financial losses arising from mistakes, negligence, missed deadlines, or failure to deliver professional services as promised. Consultants, accountants, IT professionals, real estate agents, architects, engineers, and other service providers in ${county} face this exposure every day. Many professional licenses in ${si.name} require E&O coverage, and client contracts frequently require proof of $1 million in professional liability limits.`;
    const faqs = [
      {
        q: `Who needs professional liability insurance in ${city}?`,
        a: `Any business or individual in ${city} that provides professional advice, services, or work product for a fee should carry professional liability insurance. This includes consultants, accountants, IT firms, architects, engineers, real estate agents, attorneys, and financial advisors. Many client contracts require it.`
      },
      {
        q: `How much does professional liability insurance cost in ${city}?`,
        a: `Most ${city} professionals pay $500 to $3,000 per year depending on their profession, annual revenue, years in business, claims history, and coverage limits. Higher-risk professions and larger firms pay more. We compare rates from multiple carriers to find competitive pricing.`
      },
      {
        q: `What is the difference between general liability and professional liability?`,
        a: `General liability covers physical injuries and property damage, such as a client slipping and falling in your office. Professional liability covers financial losses from your professional services, such as an accounting error that costs a client money or IT advice that leads to a data breach. Most ${city} businesses need both.`
      }
    ];
    return { h1, intro, faqs };
  },

  // ── LIFE & HEALTH LINE ─────────────────────────────────────────────────────

  medicare(city, state, county, si, prod) {
    const h1 = `Medicare Insurance in ${city}, ${state}`;
    const intro = `Choosing the right Medicare plan in ${city} means understanding which plans give you access to local hospitals, specialists, and the network of providers in ${county}. Original Medicare (Parts A and B) covers hospital and medical services, but most people need a Medicare Supplement (Medigap) or Medicare Advantage plan to fill the gaps. The right choice depends on your health needs, the providers you want to keep, and your budget. We help ${city} seniors compare plans from multiple carriers so you can choose with confidence, not confusion. During enrollment season, we walk you through the details side by side, comparing premiums, copays, drug formularies, and network breadth. Whether you are turning 65, aging off a group plan, or looking to switch during Open Enrollment, we make the process straightforward.`;
    const faqs = [
      {
        q: `When can I enroll in Medicare in ${city}?`,
        a: `Your Initial Enrollment Period begins 3 months before you turn 65 and ends 3 months after. If you miss it, you may face late enrollment penalties. Open Enrollment runs from October 15 to December 7 each year. Contact us early to review your options.`
      },
      {
        q: `Which hospitals accept Medicare in ${city}?`,
        a: `Original Medicare is accepted by most hospitals and doctors. Medicare Advantage plans have networks, so you will want to verify that your preferred ${county} providers are included before enrolling. We can help you check network availability for the plans you are considering.`
      },
      {
        q: `What is the difference between Medicare Supplement and Medicare Advantage in ${city}?`,
        a: `Medicare Supplement (Medigap) lets you see any doctor who accepts Medicare, with no network restrictions. Medicare Advantage plans have networks but often include extra benefits like dental, vision, and hearing. The best choice depends on your health needs and which ${city} providers you want to keep.`
      }
    ];
    return { h1, intro, faqs };
  },

  medicaid(city, state, county, si, prod) {
    const h1 = `Medicaid in ${city}, ${state}`;
    const intro = si.medicaidExpanded
      ? `${si.medicaidNote} For ${city} residents who qualify, Medicaid provides comprehensive health coverage including doctor visits, hospital care, prescription drugs, mental health services, and preventive care at little to no cost. Eligibility is based on household income, family size, age, disability status, and other factors. ${si.name} processes Medicaid applications through ${si.healthMarketplace}. We help ${county} residents understand their eligibility, navigate the application process, and explore related coverage options if they do not qualify for Medicaid but need affordable health insurance.`
      : `${si.medicaidNote} For ${city} residents who qualify, Medicaid provides comprehensive health coverage including doctor visits, hospital care, prescription drugs, mental health services, and preventive care at little to no cost. Eligibility is based on household income, family size, age, disability status, and other factors. Because ${si.name} has not expanded Medicaid, adults without children or disabilities may not qualify unless they meet very specific criteria. We help ${county} residents understand their eligibility and explore alternative coverage options including marketplace plans with subsidies.`;
    const faqs = [
      {
        q: `Who qualifies for Medicaid in ${city}, ${state}?`,
        a: si.medicaidExpanded
          ? `${si.name} has expanded Medicaid to cover adults earning up to 138% of the federal poverty level. Children, pregnant women, seniors, and people with disabilities may qualify at higher income levels. Eligibility is based on household income and family size.`
          : `In ${si.name}, Medicaid covers children, pregnant women, seniors in nursing care, and adults with disabilities who meet income requirements. Because the state has not expanded Medicaid, many low-income adults without children or disabilities do not qualify. Marketplace plans with subsidies may be an alternative.`
      },
      {
        q: `How do I apply for Medicaid in ${city}?`,
        a: `${city} residents can apply for Medicaid through ${si.healthMarketplace}. Applications can be submitted online, by phone, or in person at your local Department for Community Based Services office in ${county}. We can help you understand the process and explore your options.`
      },
      {
        q: `What does Medicaid cover in ${state}?`,
        a: `${si.name} Medicaid covers doctor visits, hospital care, prescription drugs, lab tests, mental health services, preventive care, and more. Some services may require small copayments. Coverage details vary by eligibility category and plan type.`
      }
    ];
    return { h1, intro, faqs };
  },

  'supplemental-health'(city, state, county, si, prod) {
    const h1 = `Supplemental Health Insurance in ${city}, ${state}`;
    const intro = `Supplemental health insurance pays cash benefits directly to you when a covered health event occurs, helping ${city} residents cover the costs that their primary health plan does not fully pay. Even with good health insurance, deductibles, copays, and out-of-pocket maximums can leave you with thousands of dollars in expenses after an accident, critical illness, or hospital stay. Supplemental plans like accident insurance, critical illness coverage, and hospital indemnity policies provide a lump sum or per-day cash benefit that you can use for anything: medical bills, mortgage payments, groceries, or transportation to treatment. For ${county} families and individuals, supplemental health coverage provides a financial safety net that your primary plan was not designed to offer.`;
    const faqs = [
      {
        q: `What types of supplemental health insurance are available in ${city}?`,
        a: `The most common supplemental plans available to ${city} residents are accident insurance (pays for injuries from accidents), critical illness insurance (pays a lump sum upon diagnosis of cancer, heart attack, or stroke), and hospital indemnity (pays a daily or per-admission benefit for hospital stays). These can be purchased individually or through your employer.`
      },
      {
        q: `How much does supplemental health insurance cost in ${city}?`,
        a: `Supplemental health plans are affordable, typically $20 to $80 per month depending on the type of coverage, benefit amount, and your age. Accident-only plans are the least expensive. Critical illness plans cost more but provide larger lump-sum benefits.`
      },
      {
        q: `Can I get supplemental insurance if I already have health insurance?`,
        a: `Yes. Supplemental insurance is designed to work alongside your primary health plan, not replace it. It fills the gaps that high-deductible and standard health plans leave open, paying cash benefits directly to you that you can use for any purpose.`
      }
    ];
    return { h1, intro, faqs };
  },

  'group-health'(city, state, county, si, prod) {
    const h1 = `Group Health Insurance for ${city} Businesses`;
    const intro = `Offering group health insurance is one of the most effective ways for ${city} businesses to attract and retain employees. Small businesses with 2 to 50 employees can access the small group health insurance market, where premiums are community-rated and cannot be based on individual health conditions. For ${city} employers, the right group plan balances coverage quality with affordability for both the business and its employees. We help ${county} businesses compare plans from multiple carriers, navigate contribution requirements, and understand the tax advantages of offering group health benefits. Whether you are setting up a group plan for the first time or reviewing your renewal, we make the process clear and manageable.`;
    const faqs = [
      {
        q: `How many employees do I need for group health insurance in ${city}?`,
        a: `Most group health plans in ${si.name} require a minimum of 2 eligible employees. Sole proprietors without employees typically need to use the individual health market. Once you have 2 or more full-time employees, group options become available through the small group market.`
      },
      {
        q: `How much does group health insurance cost for ${city} businesses?`,
        a: `Group health costs depend on the plan type, network, deductible, and number of employees. In ${si.name}, the average small group premium is $500 to $800 per employee per month for single coverage. Employer contribution requirements vary by carrier and plan. We compare options to find the right balance for your budget.`
      },
      {
        q: `Can I offer different health plans to different employees in ${city}?`,
        a: `Yes. Many small group carriers offer multiple plan tiers (Gold, Silver, Bronze) that employees can choose from. The employer sets a contribution level and employees select the plan that best fits their needs. We help ${city} businesses design benefit programs that work for both the company and its team.`
      }
    ];
    return { h1, intro, faqs };
  },

  'individual-health'(city, state, county, si, prod) {
    const h1 = `Individual Health Insurance in ${city}, ${state}`;
    const intro = `If you are self-employed, between jobs, retired before 65, or your employer does not offer health benefits, individual health insurance is your primary option for coverage in ${city}. Plans are available through ${si.healthMarketplace} during Open Enrollment (typically November through January) and during Special Enrollment Periods triggered by qualifying life events like job loss, marriage, or moving to ${county}. Subsidies are available based on household income, and many ${city} residents qualify for significant premium reductions. We help you understand your plan options, estimate your subsidy, and choose a plan that balances premium cost, deductible, network, and coverage for your health needs.`;
    const faqs = [
      {
        q: `When can I sign up for health insurance in ${city}?`,
        a: `Open Enrollment for individual health plans typically runs from November 1 through January 15. Outside of Open Enrollment, you can sign up during a Special Enrollment Period if you have a qualifying life event such as losing job-based coverage, getting married, having a baby, or moving to a new area.`
      },
      {
        q: `Do I qualify for health insurance subsidies in ${city}?`,
        a: `Subsidies are based on household income relative to the federal poverty level. Many ${city} individuals and families earning up to 400% of the poverty level qualify for premium tax credits that reduce monthly costs. We can help you estimate your subsidy and find the most affordable plan.`
      },
      {
        q: `What is the difference between marketplace and off-exchange plans?`,
        a: `Marketplace plans purchased through ${si.healthMarketplace} are eligible for premium subsidies. Off-exchange plans purchased directly from carriers are not eligible for subsidies but may offer different network or plan design options. If you qualify for any subsidy, the marketplace is usually the better option.`
      }
    ];
    return { h1, intro, faqs };
  },

  'family-health'(city, state, county, si, prod) {
    const h1 = `Family Health Insurance in ${city}, ${state}`;
    const intro = `Covering your family's health insurance needs in ${city} requires balancing coverage, cost, and access to the providers your family trusts. Family health plans cover you, your spouse, and dependent children under one policy. Options include employer-sponsored plans, individual and family plans through ${si.healthMarketplace}, and CHIP (Children's Health Insurance Program) for children in families that earn too much for Medicaid. For ${county} families, the right plan depends on your household income, the providers you need access to, prescription drug needs, and how often your family uses healthcare services. We help ${city} families compare plans across carriers and calculate the true cost of coverage including premiums, deductibles, copays, and out-of-pocket maximums.`;
    const faqs = [
      {
        q: `How much does family health insurance cost in ${city}?`,
        a: `Family health plan costs in ${city} depend on the plan type, network, and number of family members. Without subsidies, expect $1,000 to $2,500 per month for a family of four. Many ${city} families qualify for subsidies through ${si.healthMarketplace} that significantly reduce premiums.`
      },
      {
        q: `What is CHIP and does it apply in ${city}?`,
        a: `CHIP (Children's Health Insurance Program) provides low-cost health coverage for children in families that earn too much to qualify for Medicaid but cannot afford private insurance. ${si.name} participates in CHIP, and ${city} families can apply through ${si.healthMarketplace}.`
      },
      {
        q: `Can I add my children to my health plan in ${city}?`,
        a: `Yes. You can cover dependent children on your health plan up to age 26 under the ACA. This applies to marketplace plans, employer-sponsored plans, and individual family plans. Children can be added during Open Enrollment or within 60 days of birth or adoption.`
      }
    ];
    return { h1, intro, faqs };
  },

  'dental-vision'(city, state, county, si, prod) {
    const h1 = `Dental, Vision & Hearing Insurance in ${city}, ${state}`;
    const intro = `Most health insurance plans do not include dental, vision, or hearing coverage for adults. Standalone dental and vision plans cover preventive care, routine exams, and major services at a fraction of the out-of-pocket cost. For ${city} residents, regular dental and vision care is not just about health but about catching problems early when treatment is simple and affordable. A single root canal can cost $1,000 or more, and prescription glasses or contacts add up quickly without coverage. We help ${county} individuals and families find standalone dental, vision, and hearing plans that fit their needs and budget. Plans are available year-round and do not require Open Enrollment.`;
    const faqs = [
      {
        q: `How much does dental insurance cost in ${city}?`,
        a: `Individual dental plans in ${city} typically cost $20 to $50 per month and cover preventive care (cleanings, X-rays) at 100%, basic procedures (fillings) at 80%, and major procedures (crowns, root canals) at 50%. Family plans cost more but provide coverage for all household members.`
      },
      {
        q: `Is vision insurance worth it in ${city}?`,
        a: `If you wear glasses or contacts, vision insurance typically pays for itself. Plans cost $10 to $20 per month and cover annual eye exams plus an allowance for frames, lenses, or contacts. Without insurance, an eye exam plus glasses can cost $300 to $500 out of pocket.`
      },
      {
        q: `Can I buy dental and vision insurance without health insurance?`,
        a: `Yes. Dental, vision, and hearing plans are standalone products that can be purchased independently of health insurance. They are available year-round in ${city} without the Open Enrollment restrictions that apply to health insurance plans.`
      }
    ];
    return { h1, intro, faqs };
  },

  'term-life'(city, state, county, si, prod) {
    const h1 = `Term Life Insurance in ${city}, ${state}`;
    const intro = `Term life insurance is the most straightforward and affordable way for ${city} families to protect against the financial impact of an unexpected death. A term policy pays a death benefit to your beneficiaries if you die during the policy term, typically 10, 20, or 30 years. The proceeds can replace your income, pay off a mortgage, fund your children's education, and cover final expenses. For ${city} families with a mortgage, young children, or debts that would burden survivors, term life is one of the most important financial planning tools available. Premiums are locked in for the entire term, and healthy applicants often qualify for lower rates than they expect. We compare term life quotes from multiple carriers to find the best rate for your age, health, and coverage needs in ${county}.`;
    const faqs = [
      {
        q: `How much term life insurance do I need in ${city}?`,
        a: `A common guideline is 10 to 15 times your annual income, but the right amount depends on your mortgage balance, outstanding debts, children's education costs, and your family's ongoing living expenses. We help ${city} families calculate the right coverage amount based on their specific financial situation.`
      },
      {
        q: `How much does term life insurance cost in ${city}?`,
        a: `A healthy 35-year-old can often get a 20-year, $500,000 term policy for $20 to $40 per month. Rates increase with age and health conditions. Tobacco use significantly increases premiums. We compare quotes from multiple carriers to find the best rate.`
      },
      {
        q: `What happens when my term life policy expires?`,
        a: `When your term ends, coverage stops unless you renew (at a much higher rate) or convert to a permanent policy. Most term policies include a conversion option that lets you convert to whole life without a medical exam before the conversion deadline. We help you plan ahead so there are no coverage gaps.`
      }
    ];
    return { h1, intro, faqs };
  },

  'whole-life'(city, state, county, si, prod) {
    const h1 = `Whole Life Insurance in ${city}, ${state}`;
    const intro = `Whole life insurance provides permanent coverage that lasts your entire life, with level premiums that never increase and a guaranteed cash value that grows over time. Unlike term life, which expires after a set period, whole life builds an asset you can borrow against or surrender for cash. For ${city} families focused on long-term financial planning, whole life serves multiple purposes: it guarantees a death benefit for your beneficiaries, accumulates tax-deferred cash value, and can supplement retirement income. Whole life costs more than term but provides value that extends beyond simple death benefit protection. We help ${county} residents understand whether whole life, term life, or a combination of both best fits their financial goals and budget.`;
    const faqs = [
      {
        q: `How much does whole life insurance cost in ${city}?`,
        a: `Whole life premiums are significantly higher than term life because the coverage is permanent and includes cash value accumulation. A healthy 35-year-old might pay $150 to $500 per month for $250,000 in coverage. We compare carriers to find competitive rates for ${city} residents.`
      },
      {
        q: `What is the cash value in a whole life policy?`,
        a: `Cash value is a savings component that grows at a guaranteed rate inside your whole life policy. You can borrow against it, use it to pay premiums, or surrender the policy for its cash value. The cash value grows tax-deferred and is separate from the death benefit.`
      },
      {
        q: `Should I choose term or whole life insurance in ${city}?`,
        a: `It depends on your goals and budget. Term life is best for temporary needs like covering a mortgage or children's education years. Whole life is best for permanent needs like estate planning, final expenses, or building a tax-advantaged asset. Many ${city} families benefit from a combination of both.`
      }
    ];
    return { h1, intro, faqs };
  },

  annuities(city, state, county, si, prod) {
    const h1 = `Annuities in ${city}, ${state}`;
    const intro = `An annuity is a contract with an insurance company that provides guaranteed income payments, either immediately or at a future date. For ${city} residents planning for retirement, annuities offer something that stocks and bonds cannot: a guarantee that you will not outlive your money. Fixed annuities provide a guaranteed interest rate, indexed annuities offer growth tied to a market index with downside protection, and immediate annuities convert a lump sum into a stream of income payments. Annuities grow tax-deferred until you begin taking withdrawals. We help ${county} residents understand the different types of annuities, compare rates from top-rated carriers, and determine whether an annuity fits into their overall retirement income strategy.`;
    const faqs = [
      {
        q: `What types of annuities are available in ${city}?`,
        a: `The main types available to ${city} residents are fixed annuities (guaranteed interest rate), fixed indexed annuities (interest linked to a market index with downside protection), and immediate annuities (convert a lump sum into guaranteed income starting now). Each serves a different purpose in retirement planning.`
      },
      {
        q: `How much do I need to start an annuity in ${city}?`,
        a: `Minimum deposits vary by carrier and product. Some fixed annuities accept deposits as low as $5,000, while others require $25,000 or more. We work with multiple carriers to find options that fit your available funds and income goals.`
      },
      {
        q: `Are annuities a good investment for retirement?`,
        a: `Annuities are not investments in the traditional sense but they provide guaranteed income that other financial products cannot. They work best as part of a diversified retirement strategy, particularly for ${city} residents who want to ensure they have guaranteed income that they cannot outlive, regardless of market conditions.`
      }
    ];
    return { h1, intro, faqs };
  },

  disability(city, state, county, si, prod) {
    const h1 = `Disability Insurance in ${city}, ${state}`;
    const intro = `Your ability to earn an income is your most valuable financial asset. Disability insurance replaces a portion of your income, typically 50 to 70%, if you are unable to work due to illness or injury. For ${city} professionals, business owners, and wage earners, a disability lasting months or years can be financially devastating without coverage. Social Security disability benefits exist but have strict qualification criteria, long wait times, and modest benefit amounts. Individual and group disability policies provide broader coverage with shorter waiting periods. Short-term disability covers the first 3 to 6 months, while long-term disability can provide benefits for years or until retirement age. We help ${county} residents and employers evaluate disability coverage options and find policies that protect their income and their families.`;
    const faqs = [
      {
        q: `Do I need disability insurance in ${city}?`,
        a: `If you rely on your income to pay your mortgage, support your family, or maintain your lifestyle, you need disability insurance. One in four workers will experience a disability lasting 90 days or more before age 67. Social Security disability is difficult to qualify for and takes months to process. Private disability insurance provides faster, more reliable income protection.`
      },
      {
        q: `How much does disability insurance cost in ${city}?`,
        a: `Individual long-term disability insurance typically costs 1% to 3% of your annual income. A ${city} professional earning $80,000 per year might pay $800 to $2,400 annually for coverage. Costs depend on your occupation, benefit amount, elimination period, and benefit period.`
      },
      {
        q: `What is the difference between short-term and long-term disability?`,
        a: `Short-term disability covers the first 3 to 6 months of a disability, typically after a 7 to 14 day waiting period. Long-term disability kicks in after 90 to 180 days and can provide benefits for years or until age 65. Many ${city} employers offer short-term disability as a group benefit.`
      }
    ];
    return { h1, intro, faqs };
  },

  'final-expense'(city, state, county, si, prod) {
    const h1 = `Final Expense Insurance in ${city}, ${state}`;
    const intro = `Final expense insurance is a smaller whole life policy, typically $5,000 to $25,000, designed to cover funeral and burial costs, outstanding medical bills, and small debts so your family is not burdened with these expenses. The average funeral in ${si.name} costs $7,000 to $12,000, and many families are not prepared for this expense. Final expense policies use simplified underwriting, which means no medical exam is required for most applicants, making them accessible to ${city} seniors and others who may not qualify for traditional life insurance. Premiums are fixed for life and the policy builds a small cash value over time. We help ${county} residents compare final expense options from multiple carriers and find affordable coverage that provides peace of mind.`;
    const faqs = [
      {
        q: `How much does final expense insurance cost in ${city}?`,
        a: `Most ${city} applicants pay $30 to $100 per month for final expense coverage depending on age, health questions, and coverage amount. A 65-year-old in reasonable health might pay $50 to $70 per month for $10,000 in coverage. Rates are locked in and never increase.`
      },
      {
        q: `Do I need a medical exam for final expense insurance?`,
        a: `No. Most final expense policies use simplified underwriting, which means you answer health questions on the application but do not need a medical exam, blood work, or doctor's visit. Some policies offer guaranteed issue with no health questions, though these may have a graded benefit period in the first two years.`
      },
      {
        q: `What is the difference between final expense and term life insurance?`,
        a: `Final expense is a small whole life policy that covers you permanently with fixed premiums and builds cash value. Term life provides a larger death benefit for a specific period but expires. Final expense is designed for funeral costs and small debts, while term life is designed for income replacement and larger financial obligations.`
      }
    ];
    return { h1, intro, faqs };
  },
};

// ─── Main generator ──────────────────────────────────────────────────────────

function generateCityProducts() {
  const existingMap = {};
  // Index existing city_products for preservation
  for (const cp of landingPages.city_products) {
    if (!existingMap[cp.city_slug]) existingMap[cp.city_slug] = {};
    for (const p of cp.products) {
      existingMap[cp.city_slug][p.product_id] = p;
    }
  }

  const newCityProducts = [];

  for (const city of landingPages.cities) {
    const state = city.state;
    const si = stateData[state];
    if (!si) {
      console.warn(`No state data for ${state}, skipping ${city.city}`);
      continue;
    }

    const cityProducts = [];

    for (const product of allProducts) {
      // Check if we already have this entry (Owensboro/Mt. Washington existing content)
      const existing = existingMap[city.slug] && existingMap[city.slug][product.id];
      if (existing) {
        cityProducts.push(existing);
        continue;
      }

      // Generate new content
      const generator = generators[product.id];
      if (!generator) {
        console.warn(`No generator for product: ${product.id}, skipping`);
        continue;
      }

      const { h1, intro, faqs } = generator(city.city, state, city.county, si, product);

      cityProducts.push({
        slug: productSlug(product),
        product_id: product.id,
        line: product.line,
        name: productDisplayName(product),
        h1,
        intro,
        faqs
      });
    }

    newCityProducts.push({
      city_slug: city.slug,
      city: city.city,
      state: city.state,
      county: city.county,
      products: cityProducts
    });
  }

  return newCityProducts;
}

// ─── Execute ─────────────────────────────────────────────────────────────────

const cityProducts = generateCityProducts();

// Update landing-pages.json
landingPages.city_products = cityProducts;

const outputPath = path.join(dataDir, 'landing-pages.json');
fs.writeFileSync(outputPath, JSON.stringify(landingPages, null, 2) + '\n');

// Stats
let totalProducts = 0;
let preservedProducts = 0;
for (const cp of cityProducts) {
  totalProducts += cp.products.length;
}
// Count existing preserved
for (const slug of Object.keys({...({} /*existingMap*/)})) {
  // simplified
}

console.log(`Generated city_products for ${cityProducts.length} cities`);
console.log(`Total city-product entries: ${totalProducts}`);
console.log(`Output written to: ${outputPath}`);
