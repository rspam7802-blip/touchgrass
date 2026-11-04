"""24-month financial model for the TouchGrass business plan. Every figure is an assumption, stated here once."""

MONTHS = 24
START = ("Jan", 2027)
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def label(m: int) -> str:
    i = (MONTH_NAMES.index(START[0]) + m - 1)
    return f"{MONTH_NAMES[i % 12]} {START[1] + i // 12}"


# ---------- assumptions ----------
A = {
    "avg_ticket": 400,  # ₹, average paid plan ticket
    "fee_rate": 0.10,  # platform fee (built: default 10%, admin setting)
    "gateway_rate": 0.02,  # Razorpay cost absorbed by the platform fee (D-069)
    "plus_price": 149,  # ₹/month, proposed TouchGrass Plus
    "boost_price": 199,  # ₹ per featured boost, proposed
    "venue_fee": 2500,  # ₹/month per partner venue after a free pilot
    "brand_event_net": 100000,  # ₹ net per brand-sponsored experience
    "corporate_net": 25000,  # ₹ margin per corporate outing
    "infra_base": 70000,  # ₹/month fixed cloud, maps, monitoring
    "infra_per_mau": 4,  # ₹/month per monthly active user (compute, SMS OTP, maps, push)
    "legal_ops": 75000,  # ₹/month legal, accounting, compliance
    "misc": 50000,  # ₹/month tools, coworking, travel
}


def mau(m: int) -> int:
    # Closed beta (2 neighbourhoods), public Hyderabad launch in month 3, Bengaluru beta from month 8.
    seq = {1: 300, 2: 1000, 3: 3000}
    if m in seq:
        return seq[m]
    v = 3000.0
    for k in range(4, m + 1):
        g = 0.30 if k <= 6 else 0.20 if k <= 12 else 0.12 if k <= 18 else 0.08
        v *= 1 + g
        if k == 8:
            v += 1500  # Bengaluru beta cohort
    return int(round(v, -1))


def ramp(m: int, start: int, a: float, end: int, b: float) -> float:
    if m < start:
        return 0.0
    if m >= end:
        return b
    return a + (b - a) * (m - start) / (end - start)


def month(m: int) -> dict:
    u = mau(m)
    tickets_per_mau = ramp(m, 1, 0.05, 12, 0.25) if m <= 12 else ramp(m, 12, 0.25, 24, 0.35)
    tickets = u * tickets_per_mau
    gmv = tickets * A["avg_ticket"]
    fee = gmv * A["fee_rate"]
    plus = u * ramp(m, 6, 0.01, 24, 0.03) * A["plus_price"]
    boosts = u * ramp(m, 5, 0.004, 24, 0.01) * A["boost_price"]
    venues_n = 0 if m < 4 else int(round(10 + (120 - 10) * (m - 4) / 20))
    venues = venues_n * A["venue_fee"]
    brand_n = 0 if m < 7 else min(4, 1 + (m - 7) // 4)
    brand = brand_n * A["brand_event_net"]
    corp_n = 0 if m < 10 else min(6, 1 + (m - 10) // 3)
    corp = corp_n * A["corporate_net"]
    revenue = fee + plus + boosts + venues + brand + corp

    team = 600000 if m <= 3 else 1000000 if m <= 12 else 1600000
    marketing = 150000 if m <= 2 else 600000 if m == 3 else min(800000, 400000 + (m - 4) * 25000)
    infra = A["infra_base"] + u * A["infra_per_mau"]
    gateway = gmv * A["gateway_rate"]
    costs = team + marketing + infra + gateway + A["legal_ops"] + A["misc"]
    return {
        "m": m,
        "label": label(m),
        "mau": u,
        "tickets": tickets,
        "gmv": gmv,
        "fee": fee,
        "plus": plus,
        "boosts": boosts,
        "venues_n": venues_n,
        "venues": venues,
        "brand": brand,
        "corp": corp,
        "revenue": revenue,
        "team": team,
        "marketing": marketing,
        "infra": infra,
        "gateway": gateway,
        "other": A["legal_ops"] + A["misc"],
        "costs": costs,
        "net": revenue - costs,
    }


def run() -> list[dict]:
    rows, cum = [], 0.0
    for m in range(1, MONTHS + 1):
        r = month(m)
        cum += r["net"]
        r["cum"] = cum
        rows.append(r)
    return rows


if __name__ == "__main__":
    for r in run():
        print(
            f"{r['label']:9} MAU {r['mau']:>7,}  GMV {r['gmv']/1e5:7.1f}L  rev {r['revenue']/1e5:6.1f}L  "
            f"cost {r['costs']/1e5:6.1f}L  net {r['net']/1e5:6.1f}L  cum {r['cum']/1e5:7.1f}L"
        )
