export interface WatchlistEntry {
  ticker: string
  layer: string | null
  strategies: string[]
  thesis: string
  instrumentType: 'equity' | 'crypto'
}

export const WATCHLIST: WatchlistEntry[] = [
  // === Strategy 1: AI Hidden Supply Chain (7 layers) ===

  // Layer 1 — Chip Packaging & Inspection
  { ticker: 'AMKR', layer: 'Layer 1 — Chip Packaging', strategies: ['supply_chain'], thesis: '2.5D advanced packaging, TSMC alternative, Arizona + Vietnam expansion', instrumentType: 'equity' },
  { ticker: 'CAMT', layer: 'Layer 1 — Chip Inspection', strategies: ['supply_chain'], thesis: 'HBM wafer inspection, HBM4 transition catalyst', instrumentType: 'equity' },
  { ticker: 'ACMR', layer: 'Layer 1 — Chip Cleaning', strategies: ['supply_chain'], thesis: 'Wafer cleaning equipment for AI fabs', instrumentType: 'equity' },

  // Layer 2 — Optical Interconnects
  { ticker: 'FN', layer: 'Layer 2 — Optical Interconnects', strategies: ['supply_chain'], thesis: 'Only manufacturer for 1.6T transceivers at scale', instrumentType: 'equity' },
  { ticker: 'CIEN', layer: 'Layer 2 — Optical Networking', strategies: ['supply_chain'], thesis: 'Optical networking for inter-data center connectivity', instrumentType: 'equity' },
  { ticker: 'LITE', layer: 'Layer 2 — Optical Components', strategies: ['supply_chain'], thesis: 'Optical switches and laser components for AI servers', instrumentType: 'equity' },

  // Layer 3 — Signal Integrity & AI Connectivity
  { ticker: 'ALAB', layer: 'Layer 3 — Signal Connectivity', strategies: ['supply_chain'], thesis: 'PCIe retimers, Scorpio AI fabric switches, NVLink Fusion', instrumentType: 'equity' },
  { ticker: 'CRDO', layer: 'Layer 3 — Signal Integrity', strategies: ['supply_chain'], thesis: 'Competing retimer chips, high volatility leverage', instrumentType: 'equity' },
  { ticker: 'MRVL', layer: 'Layer 3 — Custom ASICs', strategies: ['supply_chain'], thesis: 'AWS/Microsoft custom AI chips, 3nm volume ramp', instrumentType: 'equity' },

  // Layer 4 — Rack Deployment
  { ticker: 'CLS', layer: 'Layer 4 — Rack Integration', strategies: ['supply_chain'], thesis: 'AI rack integration, Broadcom manufacturing partner', instrumentType: 'equity' },
  { ticker: 'EME', layer: 'Layer 4 — DC Construction', strategies: ['supply_chain'], thesis: 'Physical data center construction and electrical infrastructure', instrumentType: 'equity' },
  { ticker: 'CSCO', layer: 'Layer 4 — Networking', strategies: ['supply_chain'], thesis: 'Ultra-ethernet consortium, data center switching', instrumentType: 'equity' },

  // Layer 5 — Thermal & Power Management
  { ticker: 'VRT', layer: 'Layer 5 — Thermal & Power', strategies: ['supply_chain'], thesis: 'Liquid cooling, UPS — every DC must retrofit', instrumentType: 'equity' },
  { ticker: 'MOHN', layer: 'Layer 5 — Thermal Systems', strategies: ['supply_chain'], thesis: 'Thermal management systems for high-density racks', instrumentType: 'equity' },
  { ticker: 'NVT', layer: 'Layer 5 — Electrical Enclosures', strategies: ['supply_chain'], thesis: 'Electrical enclosures and thermal management', instrumentType: 'equity' },

  // Layer 6 — Raw Materials
  { ticker: 'FCX', layer: 'Layer 6 — Copper', strategies: ['supply_chain'], thesis: 'Largest public copper producer, inelastic AI demand', instrumentType: 'equity' },
  { ticker: 'COPX', layer: 'Layer 6 — Copper Miners ETF', strategies: ['supply_chain'], thesis: 'Diversified copper miner exposure', instrumentType: 'equity' },
  { ticker: 'MP', layer: 'Layer 6 — Rare Earth', strategies: ['supply_chain'], thesis: 'Rare earth materials, magnets for AI hardware', instrumentType: 'equity' },

  // Layer 7 — Nuclear & Uranium
  { ticker: 'CEG', layer: 'Layer 7 — Nuclear Power', strategies: ['supply_chain'], thesis: 'Largest U.S. nuclear operator, hyperscaler PPAs', instrumentType: 'equity' },
  { ticker: 'CCJ', layer: 'Layer 7 — Uranium', strategies: ['supply_chain'], thesis: 'Largest listed uranium producer, 55% earnings growth 2026', instrumentType: 'equity' },
  { ticker: 'UEC', layer: 'Layer 7 — Uranium Mining', strategies: ['supply_chain'], thesis: 'U.S.-based, leveraged to spot uranium price', instrumentType: 'equity' },
  { ticker: 'TLN', layer: 'Layer 7 — Nuclear PPAs', strategies: ['supply_chain'], thesis: 'Nuclear PPA deals with AI hyperscalers', instrumentType: 'equity' },

  // === Strategy 2: Midterm Macro Options (5 sectors) ===

  // Energy
  { ticker: 'XLE', layer: 'Macro — Energy', strategies: ['midterm_macro'], thesis: 'Energy sector ETF, oil geopolitics exposure', instrumentType: 'equity' },
  { ticker: 'XOM', layer: 'Macro — Energy', strategies: ['midterm_macro'], thesis: 'Oil major, Strait of Hormuz beneficiary', instrumentType: 'equity' },
  { ticker: 'CVX', layer: 'Macro — Energy', strategies: ['midterm_macro'], thesis: 'Integrated oil major, energy infrastructure', instrumentType: 'equity' },

  // Defense & Aerospace
  { ticker: 'RTX', layer: 'Macro — Defense', strategies: ['midterm_macro'], thesis: 'Patriot $50B contract, Strait of Hormuz play', instrumentType: 'equity' },
  { ticker: 'LMT', layer: 'Macro — Defense', strategies: ['midterm_macro'], thesis: 'F-35 program, European rearmament beneficiary', instrumentType: 'equity' },
  { ticker: 'NOC', layer: 'Macro — Defense', strategies: ['midterm_macro'], thesis: 'B-21 ramp, Golden Dome awards', instrumentType: 'equity' },
  { ticker: 'GD', layer: 'Macro — Defense', strategies: ['midterm_macro'], thesis: 'Gulfstream + defense platforms', instrumentType: 'equity' },

  // AI & Semiconductors (overlap with supply chain)
  { ticker: 'NVDA', layer: 'Macro — AI Semis', strategies: ['midterm_macro', 'supply_chain'], thesis: 'Core AI GPU — visibility on capex cycle', instrumentType: 'equity' },
  { ticker: 'AVGO', layer: 'Macro — AI Semis', strategies: ['midterm_macro', 'supply_chain'], thesis: 'Custom AI chips, 106% AI revenue YoY', instrumentType: 'equity' },
  { ticker: 'AMD', layer: 'Macro — AI Semis', strategies: ['midterm_macro'], thesis: 'MI300X ramp, data center GPU share gains', instrumentType: 'equity' },
  { ticker: 'MU', layer: 'Macro — AI Semis', strategies: ['midterm_macro'], thesis: 'HBM3E production ramp, memory pricing', instrumentType: 'equity' },
  { ticker: 'SMCI', layer: 'Macro — AI Semis', strategies: ['midterm_macro'], thesis: 'AI server integration, liquid cooling', instrumentType: 'equity' },

  // Biotech & Healthcare
  { ticker: 'VRTX', layer: 'Macro — Biotech', strategies: ['midterm_macro'], thesis: 'FDA catalysts, gene therapy pipeline', instrumentType: 'equity' },

  // Macro Bear / Hedges
  { ticker: 'QQQ', layer: 'Macro — Hedges', strategies: ['midterm_macro'], thesis: 'Tech-heavy hedge, portfolio protection', instrumentType: 'equity' },
  { ticker: 'SPY', layer: 'Macro — Hedges', strategies: ['midterm_macro'], thesis: 'Broad market hedge', instrumentType: 'equity' },
  { ticker: 'XRT', layer: 'Macro — Hedges', strategies: ['midterm_macro'], thesis: 'Consumer retail weakness indicator', instrumentType: 'equity' },

  // === Strategy 3: Crypto (24/7 alert testing) ===
  { ticker: 'BTC/USD', layer: 'Crypto', strategies: ['crypto'], thesis: '24/7 Bitcoin, high volatility for alert pipeline testing', instrumentType: 'crypto' },
  { ticker: 'ETH/USD', layer: 'Crypto', strategies: ['crypto'], thesis: '24/7 Ethereum, DeFi/L2 activity proxy', instrumentType: 'crypto' },
]

export function getUniqueSymbols(): string[] {
  return [...new Set(WATCHLIST.map(w => w.ticker))]
}

export function getEntryByTicker(ticker: string): WatchlistEntry | undefined {
  return WATCHLIST.find(w => w.ticker === ticker)
}

export function getEntriesByStrategy(strategy: string): WatchlistEntry[] {
  return WATCHLIST.filter(w => w.strategies.includes(strategy))
}
