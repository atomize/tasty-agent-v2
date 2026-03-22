---
name: ai-supply-chain
description: The 7-layer AI infrastructure supply chain thesis. Load when analyzing alerts on supply chain symbols (Layer 1-7) to understand moats, catalysts, and inter-layer dependencies.
---

# AI Hidden Supply Chain — 7-Layer Infrastructure Thesis

The AI buildout has a physical supply chain that most investors ignore because they fixate on the obvious names (NVDA, AVGO). The real alpha is in the picks-and-shovels companies that are structurally critical but widely under-covered by retail. Every GPU cluster that ships requires all 7 layers to function.

## Layer 1 — Chip Packaging and Inspection

The bottleneck between chip design and chip deployment. Advanced packaging (2.5D, CoWoS) is capacity-constrained through 2027.

| Ticker | Role | Moat | Current Catalyst | Risk |
|--------|------|------|------------------|------|
| AMKR | 2.5D advanced packaging | TSMC alternative, Arizona + Vietnam fabs | HBM4 packaging demand, TSMC capacity overflow | Customer concentration (top 5 = 70% rev) |
| CAMT | HBM wafer inspection | Only pure-play HBM inspection equipment | HBM4 transition doubles inspection steps | Small cap, Israeli geopolitical risk |
| ACMR | Wafer cleaning equipment | AI fab cleaning requirements scale with node shrink | New fab construction cycles | China revenue exposure |

**Inter-layer dependency**: Every chip in Layers 3-4 passes through Layer 1 packaging. Packaging delays cascade downstream.

## Layer 2 — Optical Interconnects

Data centers are bandwidth-constrained. The transition from 400G to 800G to 1.6T transceivers is a multi-year upgrade cycle.

| Ticker | Role | Moat | Current Catalyst | Risk |
|--------|------|------|------------------|------|
| FN | 1.6T optical transceivers | Only manufacturer at scale for 1.6T | Hyperscaler orders accelerating, sole-source for major customers | Binary customer decisions, concentrated revenue |
| CIEN | Optical networking | Inter-DC optical backbone, WaveLogic 6 | Hyperscaler WAN buildout, subsea cable demand | Enterprise slowdown drag |
| LITE | Optical components | Laser sources and switches for AI servers | Next-gen photonic switching | Commodity component pricing pressure |

**Inter-layer dependency**: Every rack in Layer 4 needs optical I/O from Layer 2. 1.6T transceivers are gating rack density increases.

## Layer 3 — Signal Integrity and AI Connectivity

PCIe retimers, AI fabric switches, and custom ASICs. These are the "last inch" before the GPU compute.

| Ticker | Role | Moat | Current Catalyst | Risk |
|--------|------|------|------------------|------|
| ALAB | PCIe retimers + Scorpio AI fabric | NVLink Fusion integration, only merchant AI switch | GB200 ramp drives retimer attach rate | Pre-revenue AI switch, execution risk |
| CRDO | Competing retimer chips | PCIe 6.0 retimers, active electrical cables | Design wins at 2 of 3 major hyperscalers | Volatile, ALAB competitive pressure |
| MRVL | Custom AI ASICs | AWS Trainium, Microsoft Maia, Google TPU interconnect | 3nm volume ramp, 4 custom silicon programs | Custom silicon is lumpy and binary |

**Inter-layer dependency**: Layer 3 is the glue between GPU (Layer 1 packaging) and network (Layer 2 optical). Signal integrity failures = system failures.

## Layer 4 — Rack Deployment and Data Center Construction

Physical integration: servers → racks → rows → data centers. The construction pipeline is measured in years.

| Ticker | Role | Moat | Current Catalyst | Risk |
|--------|------|------|------------------|------|
| CLS | AI rack integration | Broadcom manufacturing partner, full rack assembly | GB200 rack buildout, NVL72 integration | Broadcom dependency, margin pressure |
| EME | DC electrical + construction | Largest U.S. electrical contractor | $100B+ DC construction pipeline through 2030 | Labor costs, project execution |
| CSCO | Ultra-Ethernet switching | Ultra Ethernet Consortium founding member | AI DC switching standardization | Legacy networking business drag |

## Layer 5 — Thermal and Power Management

Every data center must retrofit for liquid cooling. Power density per rack is 10x higher with AI workloads than traditional compute.

| Ticker | Role | Moat | Current Catalyst | Risk |
|--------|------|------|------------------|------|
| VRT | Liquid cooling + UPS | Market leader in DC power and thermal | Every hyperscaler retrofitting for liquid cooling | Valuation premium, execution at scale |
| MOHN | Thermal management systems | High-density rack cooling solutions | GB200 thermal requirements exceed air cooling | Small cap, limited public data |
| NVT | Electrical enclosures | Power distribution and thermal management | DC power infrastructure demand | Diversified business dilutes AI exposure |

**Inter-layer dependency**: Thermal limits rack density. If Layer 5 can't cool it, Layer 4 can't ship it.

## Layer 6 — Raw Materials

Copper and rare earths are the atoms behind the AI buildout. Demand is inelastic — you can't substitute copper in a data center.

| Ticker | Role | Moat | Current Catalyst | Risk |
|--------|------|------|------------------|------|
| FCX | World's largest public copper producer | Grasberg mine, irreplaceable reserves | AI copper demand + supply deficit through 2030 | Commodity price volatility, Indonesia regulatory |
| COPX | Copper miners ETF | Diversified copper miner basket | Copper deficit thesis without single-stock risk | ETF tracking, management fees |
| MP | Rare earth materials | Only integrated U.S. rare earth producer | Magnets for AI server motors and cooling | China rare earth competition, processing bottleneck |

## Layer 7 — Nuclear and Uranium

AI data centers need baseload power. Nuclear is the only zero-carbon source that scales to hyperscaler demand (500MW+ per campus).

| Ticker | Role | Moat | Current Catalyst | Risk |
|--------|------|------|------------------|------|
| CEG | Largest U.S. nuclear fleet operator | 13 nuclear plants, 24GW capacity | Microsoft, Amazon, Google PPAs signed | Regulatory, PPA pricing risk |
| CCJ | Largest listed uranium producer | McArthur River, Cigar Lake mines | Uranium spot above $80/lb, 55% earnings growth 2026 | Commodity cycle, Kazakh supply |
| UEC | U.S.-based uranium producer | In-situ recovery, low-cost production | Leveraged to spot uranium price | Development-stage risk, dilution |
| TLN | Nuclear PPA intermediary | Existing nuclear fleet + AI PPA deals | Hyperscaler power purchase agreements | PPA renegotiation risk |

**Inter-layer dependency**: Without Layer 7 power, nothing else runs. Nuclear PPAs are 15-20 year commitments — the most durable moat in the stack.

## Cross-Layer Analysis

When analyzing a supply chain alert:
1. Identify which layer the ticker belongs to
2. Check upstream dependencies (lower layers) for bottleneck signals
3. Check downstream beneficiaries (higher layers) for demand confirmation
4. Look for correlated moves across layers — if Layer 1 (packaging) and Layer 2 (optical) are both spiking, the signal is stronger than either alone
5. Position sizing should reflect layer risk: earlier layers (1-3) are higher-beta, later layers (5-7) are more defensive
