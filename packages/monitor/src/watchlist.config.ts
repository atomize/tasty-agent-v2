export interface WatchlistEntry {
  ticker: string
  description?: string
  layer: string | null
  strategies: string[]
  thesis: string
  instrumentType: 'equity' | 'crypto'
}

export interface SectorWatchlist {
  name: string
  entries: WatchlistEntry[]
  layers: string[]
}

export const SECTOR_TEMPLATES: Record<string, string[]> = {
  'AI Supply Chain': [
    'Layer 1 — Chip Packaging',
    'Layer 1 — Chip Inspection',
    'Layer 1 — Chip Cleaning',
    'Layer 2 — Optical Interconnects',
    'Layer 2 — Optical Networking',
    'Layer 2 — Optical Components',
    'Layer 3 — Signal Connectivity',
    'Layer 3 — Signal Integrity',
    'Layer 3 — Custom ASICs',
    'Layer 4 — Rack Integration',
    'Layer 4 — DC Construction',
    'Layer 4 — Networking',
    'Layer 5 — Thermal & Power',
    'Layer 5 — Thermal Systems',
    'Layer 5 — Electrical Enclosures',
    'Layer 6 — Copper',
    'Layer 6 — Copper Miners ETF',
    'Layer 6 — Rare Earth',
    'Layer 7 — Nuclear Power',
    'Layer 7 — Uranium',
    'Layer 7 — Uranium Mining',
    'Layer 7 — Nuclear PPAs',
  ],
  'Defense & Aerospace': [
    'Prime Contractors',
    'Missile Systems',
    'Space & Satellite',
    'Cybersecurity',
  ],
  'Energy': [
    'Oil Majors',
    'Renewables',
    'Nuclear',
    'Utilities',
    'Infrastructure',
  ],
  'AI Semiconductors': [
    'GPU / Accelerator',
    'Custom ASIC',
    'Memory / HBM',
    'Server Integration',
  ],
  'Biotech': [
    'Gene Therapy',
    'Oncology',
    'Rare Disease',
    'Medical Devices',
  ],
  'Macro Hedges': [
    'Index ETFs',
    'Sector ETFs',
    'Volatility',
  ],
  'Crypto': [
    'Layer 1',
    'DeFi',
    'Infrastructure',
  ],
  'Custom': [],
}

export const SEED_WATCHLISTS: SectorWatchlist[] = [
  {
    name: 'AI Supply Chain',
    layers: SECTOR_TEMPLATES['AI Supply Chain'],
    entries: [
      { ticker: 'AMKR', description: 'Amkor Technology', layer: 'Layer 1 — Chip Packaging', strategies: ['supply_chain'], thesis: '2.5D advanced packaging, TSMC alternative, Arizona + Vietnam expansion', instrumentType: 'equity' },
      { ticker: 'CAMT', description: 'Camtek Ltd', layer: 'Layer 1 — Chip Inspection', strategies: ['supply_chain'], thesis: 'HBM wafer inspection, HBM4 transition catalyst', instrumentType: 'equity' },
      { ticker: 'ACMR', description: 'ACM Research', layer: 'Layer 1 — Chip Cleaning', strategies: ['supply_chain'], thesis: 'Wafer cleaning equipment for AI fabs', instrumentType: 'equity' },
      { ticker: 'FN', description: 'Fabrinet', layer: 'Layer 2 — Optical Interconnects', strategies: ['supply_chain'], thesis: 'Only manufacturer for 1.6T transceivers at scale', instrumentType: 'equity' },
      { ticker: 'CIEN', description: 'Ciena Corp', layer: 'Layer 2 — Optical Networking', strategies: ['supply_chain'], thesis: 'Optical networking for inter-data center connectivity', instrumentType: 'equity' },
      { ticker: 'LITE', description: 'Lumentum Holdings', layer: 'Layer 2 — Optical Components', strategies: ['supply_chain'], thesis: 'Optical switches and laser components for AI servers', instrumentType: 'equity' },
      { ticker: 'ALAB', description: 'Astera Labs', layer: 'Layer 3 — Signal Connectivity', strategies: ['supply_chain'], thesis: 'PCIe retimers, Scorpio AI fabric switches, NVLink Fusion', instrumentType: 'equity' },
      { ticker: 'CRDO', description: 'Credo Technology', layer: 'Layer 3 — Signal Integrity', strategies: ['supply_chain'], thesis: 'Competing retimer chips, high volatility leverage', instrumentType: 'equity' },
      { ticker: 'MRVL', description: 'Marvell Technology', layer: 'Layer 3 — Custom ASICs', strategies: ['supply_chain'], thesis: 'AWS/Microsoft custom AI chips, 3nm volume ramp', instrumentType: 'equity' },
      { ticker: 'CLS', description: 'Celestica Inc', layer: 'Layer 4 — Rack Integration', strategies: ['supply_chain'], thesis: 'AI rack integration, Broadcom manufacturing partner', instrumentType: 'equity' },
      { ticker: 'EME', description: 'EMCOR Group', layer: 'Layer 4 — DC Construction', strategies: ['supply_chain'], thesis: 'Physical data center construction and electrical infrastructure', instrumentType: 'equity' },
      { ticker: 'CSCO', description: 'Cisco Systems', layer: 'Layer 4 — Networking', strategies: ['supply_chain'], thesis: 'Ultra-ethernet consortium, data center switching', instrumentType: 'equity' },
      { ticker: 'VRT', description: 'Vertiv Holdings', layer: 'Layer 5 — Thermal & Power', strategies: ['supply_chain'], thesis: 'Liquid cooling, UPS — every DC must retrofit', instrumentType: 'equity' },
      { ticker: 'MOHN', description: 'Modine Manufacturing', layer: 'Layer 5 — Thermal Systems', strategies: ['supply_chain'], thesis: 'Thermal management systems for high-density racks', instrumentType: 'equity' },
      { ticker: 'NVT', description: 'nVent Electric', layer: 'Layer 5 — Electrical Enclosures', strategies: ['supply_chain'], thesis: 'Electrical enclosures and thermal management', instrumentType: 'equity' },
      { ticker: 'FCX', description: 'Freeport-McMoRan', layer: 'Layer 6 — Copper', strategies: ['supply_chain'], thesis: 'Largest public copper producer, inelastic AI demand', instrumentType: 'equity' },
      { ticker: 'COPX', description: 'Global X Copper Miners ETF', layer: 'Layer 6 — Copper Miners ETF', strategies: ['supply_chain'], thesis: 'Diversified copper miner exposure', instrumentType: 'equity' },
      { ticker: 'MP', description: 'MP Materials', layer: 'Layer 6 — Rare Earth', strategies: ['supply_chain'], thesis: 'Rare earth materials, magnets for AI hardware', instrumentType: 'equity' },
      { ticker: 'CEG', description: 'Constellation Energy', layer: 'Layer 7 — Nuclear Power', strategies: ['supply_chain'], thesis: 'Largest U.S. nuclear operator, hyperscaler PPAs', instrumentType: 'equity' },
      { ticker: 'CCJ', description: 'Cameco Corp', layer: 'Layer 7 — Uranium', strategies: ['supply_chain'], thesis: 'Largest listed uranium producer, 55% earnings growth 2026', instrumentType: 'equity' },
      { ticker: 'UEC', description: 'Uranium Energy Corp', layer: 'Layer 7 — Uranium Mining', strategies: ['supply_chain'], thesis: 'U.S.-based, leveraged to spot uranium price', instrumentType: 'equity' },
      { ticker: 'TLN', description: 'Talen Energy', layer: 'Layer 7 — Nuclear PPAs', strategies: ['supply_chain'], thesis: 'Nuclear PPA deals with AI hyperscalers', instrumentType: 'equity' },
    ],
  },
  {
    name: 'Defense & Aerospace',
    layers: SECTOR_TEMPLATES['Defense & Aerospace'],
    entries: [
      { ticker: 'RTX', description: 'RTX Corp', layer: 'Prime Contractors', strategies: ['midterm_macro'], thesis: 'Patriot $50B contract, Strait of Hormuz play', instrumentType: 'equity' },
      { ticker: 'LMT', description: 'Lockheed Martin', layer: 'Prime Contractors', strategies: ['midterm_macro'], thesis: 'F-35 program, European rearmament beneficiary', instrumentType: 'equity' },
      { ticker: 'NOC', description: 'Northrop Grumman', layer: 'Prime Contractors', strategies: ['midterm_macro'], thesis: 'B-21 ramp, Golden Dome awards', instrumentType: 'equity' },
      { ticker: 'GD', description: 'General Dynamics', layer: 'Prime Contractors', strategies: ['midterm_macro'], thesis: 'Gulfstream + defense platforms', instrumentType: 'equity' },
    ],
  },
  {
    name: 'Energy',
    layers: SECTOR_TEMPLATES['Energy'],
    entries: [
      { ticker: 'XLE', description: 'Energy Select Sector SPDR', layer: 'Oil Majors', strategies: ['midterm_macro'], thesis: 'Energy sector ETF, oil geopolitics exposure', instrumentType: 'equity' },
      { ticker: 'XOM', description: 'Exxon Mobil', layer: 'Oil Majors', strategies: ['midterm_macro'], thesis: 'Oil major, Strait of Hormuz beneficiary', instrumentType: 'equity' },
      { ticker: 'CVX', description: 'Chevron Corp', layer: 'Oil Majors', strategies: ['midterm_macro'], thesis: 'Integrated oil major, energy infrastructure', instrumentType: 'equity' },
    ],
  },
  {
    name: 'AI Semiconductors',
    layers: SECTOR_TEMPLATES['AI Semiconductors'],
    entries: [
      { ticker: 'NVDA', description: 'NVIDIA Corp', layer: 'GPU / Accelerator', strategies: ['midterm_macro', 'supply_chain'], thesis: 'Core AI GPU — visibility on capex cycle', instrumentType: 'equity' },
      { ticker: 'AVGO', description: 'Broadcom Inc', layer: 'Custom ASIC', strategies: ['midterm_macro', 'supply_chain'], thesis: 'Custom AI chips, 106% AI revenue YoY', instrumentType: 'equity' },
      { ticker: 'AMD', description: 'Advanced Micro Devices', layer: 'GPU / Accelerator', strategies: ['midterm_macro'], thesis: 'MI300X ramp, data center GPU share gains', instrumentType: 'equity' },
      { ticker: 'MU', description: 'Micron Technology', layer: 'Memory / HBM', strategies: ['midterm_macro'], thesis: 'HBM3E production ramp, memory pricing', instrumentType: 'equity' },
      { ticker: 'SMCI', description: 'Super Micro Computer', layer: 'Server Integration', strategies: ['midterm_macro'], thesis: 'AI server integration, liquid cooling', instrumentType: 'equity' },
    ],
  },
  {
    name: 'Biotech',
    layers: SECTOR_TEMPLATES['Biotech'],
    entries: [
      { ticker: 'VRTX', description: 'Vertex Pharmaceuticals', layer: 'Gene Therapy', strategies: ['midterm_macro'], thesis: 'FDA catalysts, gene therapy pipeline', instrumentType: 'equity' },
    ],
  },
  {
    name: 'Macro Hedges',
    layers: SECTOR_TEMPLATES['Macro Hedges'],
    entries: [
      { ticker: 'QQQ', description: 'Invesco QQQ Trust', layer: 'Index ETFs', strategies: ['midterm_macro'], thesis: 'Tech-heavy hedge, portfolio protection', instrumentType: 'equity' },
      { ticker: 'SPY', description: 'SPDR S&P 500 ETF', layer: 'Index ETFs', strategies: ['midterm_macro'], thesis: 'Broad market hedge', instrumentType: 'equity' },
      { ticker: 'XRT', description: 'SPDR S&P Retail ETF', layer: 'Sector ETFs', strategies: ['midterm_macro'], thesis: 'Consumer retail weakness indicator', instrumentType: 'equity' },
    ],
  },
  {
    name: 'Crypto',
    layers: SECTOR_TEMPLATES['Crypto'],
    entries: [
      { ticker: 'BTC/USD', description: 'Bitcoin', layer: 'Layer 1', strategies: ['crypto'], thesis: '24/7 Bitcoin, high volatility for alert pipeline testing', instrumentType: 'crypto' },
      { ticker: 'ETH/USD', description: 'Ethereum', layer: 'Layer 1', strategies: ['crypto'], thesis: '24/7 Ethereum, DeFi/L2 activity proxy', instrumentType: 'crypto' },
    ],
  },
]

/** Flat list for backward compat with streamer subscription */
export const WATCHLIST: WatchlistEntry[] = SEED_WATCHLISTS.flatMap(s => s.entries)

export function getUniqueSymbols(): string[] {
  return [...new Set(WATCHLIST.map(w => w.ticker))]
}

export function getEntryByTicker(ticker: string): WatchlistEntry | undefined {
  return WATCHLIST.find(w => w.ticker === ticker)
}

export function getEntriesByStrategy(strategy: string): WatchlistEntry[] {
  return WATCHLIST.filter(w => w.strategies.includes(strategy))
}
