"""Builds the TouchGrass business plan PDF (ReportLab, Inter for ₹ support)."""
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

import model

OUT = sys.argv[1]
LOGO = "/home/user/touchgrass/apps/mobile/assets/brand/logo.png"
FONTS = "/home/user/touchgrass/node_modules/@expo-google-fonts/inter"
pdfmetrics.registerFont(TTFont("Inter", f"{FONTS}/400Regular/Inter_400Regular.ttf"))
pdfmetrics.registerFont(TTFont("Inter-SemiBold", f"{FONTS}/600SemiBold/Inter_600SemiBold.ttf"))
pdfmetrics.registerFont(TTFont("Inter-Bold", f"{FONTS}/700Bold/Inter_700Bold.ttf"))
pdfmetrics.registerFont(TTFont("Inter-Italic", f"{FONTS}/400Regular_Italic/Inter_400Regular_Italic.ttf"))
pdfmetrics.registerFontFamily(
    "Inter", normal="Inter", bold="Inter-Bold", italic="Inter-Italic", boldItalic="Inter-Bold"
)

INK = colors.HexColor("#0B130E")
GREEN = colors.HexColor("#17961F")
DEEP = colors.HexColor("#3D5E0F")
LIME = colors.HexColor("#E5FB46")
MUTED = colors.HexColor("#526055")
LINE = colors.HexColor("#D7DDD3")
SOFT = colors.HexColor("#F4F7EC")

S = {
    "title": ParagraphStyle("title", fontName="Inter-Bold", fontSize=30, leading=36, textColor=INK),
    "subtitle": ParagraphStyle("subtitle", fontName="Inter", fontSize=13, leading=19, textColor=MUTED),
    "h1": ParagraphStyle("h1", fontName="Inter-Bold", fontSize=19, leading=24, textColor=INK, spaceBefore=4, spaceAfter=8),
    "h2": ParagraphStyle("h2", fontName="Inter-SemiBold", fontSize=12.5, leading=17, textColor=DEEP, spaceBefore=10, spaceAfter=4),
    "body": ParagraphStyle("body", fontName="Inter", fontSize=9.6, leading=14.2, textColor=INK, spaceAfter=5, alignment=TA_LEFT),
    "small": ParagraphStyle("small", fontName="Inter", fontSize=8.2, leading=11.5, textColor=MUTED),
    "bullet": ParagraphStyle("bullet", fontName="Inter", fontSize=9.6, leading=14, textColor=INK, leftIndent=12, bulletIndent=2, spaceAfter=2),
    "cell": ParagraphStyle("cell", fontName="Inter", fontSize=8.4, leading=11.4, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Inter-SemiBold", fontSize=8.4, leading=11.4, textColor=INK),
    "callout": ParagraphStyle("callout", fontName="Inter-SemiBold", fontSize=10.5, leading=15, textColor=INK),
}

story: list = []


def h1(t: str) -> None:
    story.append(Paragraph(t, S["h1"]))


def h2(t: str) -> None:
    story.append(Paragraph(t, S["h2"]))


def p(t: str) -> None:
    story.append(Paragraph(t, S["body"]))


def bullets(items: list[str]) -> None:
    for i in items:
        story.append(Paragraph(i, S["bullet"], bulletText="•"))
    story.append(Spacer(1, 3))


def small(t: str) -> None:
    story.append(Paragraph(t, S["small"]))


def table(rows: list[list], widths: list[float], header: bool = True, zebra: bool = True) -> None:
    data = [
        [Paragraph(str(c), S["cellb"] if (header and r == 0) else S["cell"]) for c in row]
        for r, row in enumerate(rows)
    ]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), LIME), ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK)]
    if zebra:
        for r in range(1 if header else 0, len(rows)):
            if r % 2 == 0:
                style.append(("BACKGROUND", (0, r), (-1, r), SOFT))
    t.setStyle(TableStyle(style))
    # Keep a short table (and a heading right before it) on one page.
    prev = story.pop() if story and isinstance(story[-1], Paragraph) and story[-1].style.name in ("h1", "h2") else None
    story.append(KeepTogether([x for x in (prev, t) if x is not None]))
    story.append(Spacer(1, 8))


def callout(t: str) -> None:
    t_ = Table([[Paragraph(t, S["callout"])]], colWidths=[170 * mm])
    t_.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LIME),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    # A callout right after a table belongs with it.
    if len(story) >= 2 and isinstance(story[-2], KeepTogether) and isinstance(story[-1], Spacer):
        story.pop()
        story[-1]._content.append(t_)
    else:
        story.append(t_)
    story.append(Spacer(1, 8))


def L(v: float) -> str:
    """₹ in lakh with one decimal; crore from 100 lakh."""
    sign = "−" if v < 0 else ""
    a = abs(v)
    if a >= 1e7:
        return f"{sign}₹{a / 1e7:,.2f} Cr"
    return f"{sign}₹{a / 1e5:,.1f} L"


def inr(v: float) -> str:
    return f"₹{v:,.0f}"


rows = model.run()
A = model.A
m12, m24 = rows[11], rows[23]
peak_burn = -min(r["cum"] for r in rows)

# ---------------------------------------------------------------- cover
story.append(Spacer(1, 30 * mm))
story.append(Image(LOGO, width=38 * mm, height=38 * mm, hAlign="LEFT"))
story.append(Spacer(1, 10 * mm))
story.append(Paragraph("TouchGrass", S["title"]))
story.append(Paragraph("Business plan, revenue model and launch playbook", S["subtitle"]))
story.append(Spacer(1, 4 * mm))
story.append(Paragraph("Log off. Pull up. &nbsp;·&nbsp; Hyderabad first, then South India", S["subtitle"]))
story.append(Spacer(1, 16 * mm))
callout(
    "An app for meeting people in real life: small plans with your squad and friends of friends, "
    "safe by design, in English, Telugu and Hindi. The product is built; this plan covers how it "
    "earns, how it launches and what it needs to get there."
)
story.append(Spacer(1, 30 * mm))
small("Version 1.0 · November 2026 · Confidential. All financial figures are planning assumptions, "
      "not results; they are stated in section 9 and should be revisited monthly against real data.")
story.append(PageBreak())

# ---------------------------------------------------------------- contents
h1("Contents")
contents = [
    "1. Executive summary",
    "2. The problem and the opportunity",
    "3. The product today",
    "4. Who it is for",
    "5. Market size",
    "6. Competition and positioning",
    "7. Business model and revenue streams",
    "8. Pricing and unit economics",
    "9. Financial plan (24 months)",
    "10. Go-to-market and launch playbook",
    "11. Operations: community, safety and support",
    "12. Legal, compliance and policies",
    "13. Team and hiring plan",
    "14. Technology, cost and scale",
    "15. KPIs and how we measure them",
    "16. Risks and mitigations",
    "17. Funding and use of funds",
    "18. Roadmap",
    "19. Product ideas to choose from",
    "20. Launch checklist (what a person must do)",
]
for c in contents:
    story.append(Paragraph(c, S["body"]))
story.append(PageBreak())

# ---------------------------------------------------------------- 1
h1("1. Executive summary")
p("<b>What.</b> TouchGrass helps people in Indian cities turn online connections into real plans: "
  "chai at a nearby cafe, a weekend trek, a board-game night, a run club. People plot small plans, pull up "
  "to their squad's plans, discover plans from friends of friends, and keep the memories (Lore and stories). "
  "Safety is built in: verified profiles, reliability scores, live location sharing and SOS, moderation, "
  "and mystery plans that hide exact places until shortly before.")
p("<b>Why now.</b> Young professionals and students in fast-growing cities like Hyderabad are new to the "
  "city, work long hours on screens, and find it hard to meet people outside work. Existing tools are "
  "either built for dating, for big ticketed events, or for large anonymous groups. Nobody owns the "
  "small, trusted, last-minute plan.")
p("<b>How it earns.</b> A 10% platform fee on paid plans (built and live in the product), partner-venue "
  "subscriptions, host boosts, an optional TouchGrass Plus membership, brand-sponsored experiences and "
  "corporate outings. Free plans stay free forever: they are the growth engine.")
p("<b>Launch.</b> Invite-only beta in two Hyderabad neighbourhoods (Gachibowli and Madhapur), then a "
  "public Hyderabad launch in month 3, Bengaluru beta in month 8 (already set up as a beta city), "
  "Visakhapatnam on a waitlist.")
table(
    [
        ["Planning target", "Month 12 (Dec 2027)", "Month 24 (Dec 2028)"],
        ["Monthly active users", f"{m12['mau']:,}", f"{m24['mau']:,}"],
        ["Paid tickets / month", f"{m12['tickets']:,.0f}", f"{m24['tickets']:,.0f}"],
        ["Ticket volume (GMV) / month", L(m12["gmv"]), L(m24["gmv"])],
        ["Revenue / month", L(m12["revenue"]), L(m24["revenue"])],
        ["Costs / month", L(m12["costs"]), L(m24["costs"])],
        ["Net / month", L(m12["net"]), L(m24["net"])],
    ],
    [70, 50, 50],
)
callout(
    f"Funding need: about {L(peak_burn)} over 24 months in this model, with monthly break-even "
    "around month 33 (about 1.2 lakh monthly users). Recommended: raise in two steps, a pre-seed "
    "of ₹1.5 to 2 Cr to prove Hyderabad, then a seed round on real retention and revenue."
)
story.append(PageBreak())

# ---------------------------------------------------------------- 2
h1("2. The problem and the opportunity")
h2("The problem")
bullets([
    "Moving to a new city for work or study is common, and building a social circle there is slow.",
    "Plans die in group chats: nobody commits, the place is unclear, and people drop out at the last minute.",
    "Meeting strangers feels unsafe, especially for women; most apps offer no verification or accountability.",
    "Big-event apps sell tickets to concerts and shows, not the small everyday plans that build friendships.",
    "Dating apps are the wrong frame for friendship, and \"friend modes\" inside them stay niche.",
])
h2("The opportunity")
p("A trusted, local, small-group plans app. The social graph is the moat: plans spread through squads and "
  "friends of friends, so trust and relevance come built in. Each plan creates more connections, each "
  "connection creates more plans. Paid plans, venues and brands monetise the activity without charging "
  "people to make friends.")
h2("Why Hyderabad first")
bullets([
    "Large, young, migrant workforce in the IT corridor (Gachibowli, Madhapur, Kondapur, HITEC City).",
    "Dense cafe, food, sports and culture scene within short travel distances.",
    "Telugu, Hindi and English speakers, which the app already supports end to end.",
    "Founders on the ground, a smaller market to win before Bengaluru.",
])

# ---------------------------------------------------------------- 3
h1("3. The product today")
p("The product is built and tested (iOS, Android and web share pages, plus an admin console). Highlights:")
table(
    [
        ["Area", "What exists"],
        ["Plans", "Plot a plan in a minute (what, where, when, who), free or paid, public, friends of friends, invite-only, women-only or balanced; mystery plans; +1s; waitlists; check-in at the venue; group chat (host can switch it off); comments under every plan."],
        ["Discovery", "Ranked feed with reasons (\"squad going\", \"nearby\"), featured carousel, category tiles, themed rows (tonight, this weekend, solo-friendly), full-screen map, search."],
        ["Social", "Squads (friends), contacts matching with hashed numbers, suggestions, activity, Free now with pings, crews (recurring groups), plan votes, stories (24 h, squad or friends of friends), Lore albums."],
        ["Safety", "Selfie verification, reliability tiers and cooldowns, live location and SOS to trusted contacts, block/report, text and image moderation, sanctions, admin moderation queue."],
        ["Money", "Razorpay checkout (UPI first), host payouts via Route, refunds by policy, receipts with GST, partner-venue perks with staff PIN."],
        ["Engagement", "Badges, streaks with freezes, challenges, monthly recaps, referrals with passes and credits, notifications with quiet hours."],
        ["Platform", "English, Telugu and Hindi; light and dark; accessibility (screen readers, large text, reduce motion); offline cache; multi-city admin with curators; privacy export and account deletion."],
    ],
    [30, 140],
)
story.append(PageBreak())

# ---------------------------------------------------------------- 4
h1("4. Who it is for")
table(
    [
        ["Persona", "Who", "What they want", "How TouchGrass helps"],
        ["The newcomer", "22 to 30, moved for work, 0 to 5 friends in the city", "Meet people like them without awkwardness", "Solo-friendly plans, newcomer welcome, find-your-group signal at the venue"],
        ["The organiser", "Always the one making plans", "Less chasing, more people actually showing up", "Plot, invites, waitlists, reliability scores, reminders, group chat"],
        ["The squad", "Existing friend groups", "Decide fast and do more together", "Free now, plan votes, crews, stories, Lore"],
        ["The host / creator", "Run clubs, workshop leaders, community pages", "Fill sessions and get paid", "Paid plans, payouts, featured slots, analytics, crews"],
        ["The venue", "Cafes, studios, turfs, board-game cafes", "Footfall on slow days", "Partner listing, perks, staff PIN check-in"],
        ["Women meeting new people", "Safety first", "Trust before turning up", "Verified profiles, women-only plans, live location, SOS, mystery locations"],
    ],
    [27, 38, 45, 60],
)

# ---------------------------------------------------------------- 5
h1("5. Market size")
p("Top-down sizing for the first two cities, using deliberately conservative planning assumptions. Replace "
  "these with surveyed numbers as soon as the beta produces them.")
table(
    [
        ["Layer", "Definition", "Planning estimate"],
        ["TAM", "Urban 18 to 35 smartphone users in India's top 8 metros who go out socially at least monthly", "Several crore people; out-of-home leisure spend is a large and growing category"],
        ["SAM", "18 to 35 in Hyderabad and Bengaluru, working or studying, socially active", "About 40 to 60 lakh people (assumption)"],
        ["SOM (24 months)", "Monthly active users in the plan", f"{m24['mau']:,} (about 1.5% of the SAM)"],
    ],
    [25, 85, 60],
)
p("Revenue opportunity per active user is modest per month but compounds through frequency: a user who "
  "joins two paid plans a month at ₹400 generates ₹80 in platform fees a month before venue, brand and "
  "subscription revenue.")

# ---------------------------------------------------------------- 6
h1("6. Competition and positioning")
table(
    [
        ["Alternative", "Strength", "Gap TouchGrass fills"],
        ["WhatsApp / Instagram groups", "Everyone already there", "No discovery beyond your circle, plans fizzle, no safety or reliability"],
        ["Meetup-style group apps", "Large interest groups", "Big anonymous groups, weak trust, little traction in Indian cities"],
        ["Ticketing apps (District, BookMyShow)", "Big events, payments, brand trust", "Not built for small social plans or making friends"],
        ["Dating apps with friend modes", "Large user bases", "Dating-first framing, one-to-one, not group plans"],
        ["Social discovery apps (e.g. Ripple)", "Modern social UX", "TouchGrass focuses on real-world plans, safety and local venues in Indian cities and languages"],
    ],
    [45, 50, 75],
)
callout("Positioning: the easiest, safest way to make real plans with people you almost know. "
        "Small, local, trusted and multilingual.")
story.append(PageBreak())

# ---------------------------------------------------------------- 7
h1("7. Business model and revenue streams")
p("Principle: <b>never charge people to make friends.</b> Free plans stay free; money comes from paid "
  "experiences, businesses and optional extras. We never sell personal data and never run ads that use it.")
table(
    [
        ["Stream", "Status", "How it works", "Price (proposed)"],
        ["1. Platform fee on paid plans", "Built", "Hosts sell tickets; TouchGrass keeps a fee (admin setting, default 10%) plus 18% GST on the fee; Razorpay costs come out of the fee; host gets the rest via Route", "10% of ticket"],
        ["2. Partner venues", "Built (perks, staff PIN)", "Venues list as partners, offer perks, appear on plans held there, get footfall reports", f"{inr(A['venue_fee'])}/month after a free 2-month pilot"],
        ["3. Host boosts / featured plans", "Featured slots built (admin); self-serve to add", "Hosts pay to feature a plan in the carousel or a themed row for 48 h, clearly labelled", f"{inr(A['boost_price'])} per boost"],
        ["4. TouchGrass Plus", "To build", "Optional membership: unlimited Free now pings, priority on waitlists, Plus-only plans, insights on your plans, profile themes. Never paywall safety, basic plans or seeing who saw your story", f"{inr(A['plus_price'])}/month or ₹1,299/year"],
        ["5. Brand-sponsored experiences", "Curated plans built", "Brands fund curated plans (a run club by a sportswear brand, a tasting by a cafe chain); clearly labelled sponsored", "₹50k to ₹3L per series"],
        ["6. Corporate team outings", "To build", "Companies book curated small-group outings and new-joiner meetups; invoice-based", "₹500 to ₹1,500 per head, 15 to 25% margin"],
        ["7. Crew memberships", "Crews built; billing to add", "Recurring groups (run clubs, book clubs) charge a monthly member fee; TouchGrass takes the platform fee", "10% of membership"],
        ["8. Gift passes", "Passes exist for referrals", "Buy a pass for a friend's first paid plan; good for birthdays and onboarding gifts", "Face value + fee"],
    ],
    [33, 25, 77, 35],
)
h2("Suggestions to grow revenue")
bullets([
    "<b>Start with fees and venues</b>; they need no new product and fit the launch. Add boosts once hosts see demand, Plus once retention is proven (month 6+).",
    "<b>Sell outcomes to venues</b>, not ads: \"we filled 40 seats on your slow Tuesday\" with check-in proof.",
    "<b>Bundle for brands</b>: a 4-week series in 3 neighbourhoods with Lore photos and recap stats beats a one-off.",
    "<b>Corporate onboarding</b>: HR teams in the IT corridor pay for new-joiner circles; this also brings new users.",
    "<b>Annual Plus</b> at a 27% discount improves cash flow and retention.",
    "<b>Do not do</b>: selling data, pay-to-message strangers, paywalled safety features, misleading \"sponsored\" content. Each would cost more trust than it earns.",
])
story.append(PageBreak())

# ---------------------------------------------------------------- 8
h1("8. Pricing and unit economics")
h2("One ₹400 ticket (as built)")
fee = A["avg_ticket"] * A["fee_rate"]
gst = fee * 0.18
gw = A["avg_ticket"] * A["gateway_rate"]
table(
    [
        ["Line", "Amount", "Notes"],
        ["Ticket price (inclusive)", inr(A["avg_ticket"]), "What the attendee pays"],
        ["Platform fee (10%)", inr(fee), "TouchGrass revenue"],
        ["GST on fee (18%)", inr(gst), "Collected for government, not revenue; charged on the fee only"],
        ["Payment gateway (about 2%)", inr(gw), "Absorbed by the platform from its fee (assumption: 2%)"],
        ["Net to TouchGrass", inr(fee - gw), "Before infrastructure and support"],
        ["Host receives", inr(A["avg_ticket"] - fee - gst), "Via Razorpay Route after the plan, minus refunds"],
    ],
    [55, 30, 85],
)
small("GST treatment and gateway rates must be confirmed with the chartered accountant and Razorpay contract.")
h2("Per active user (planning view, month 24)")
arpu = m24["revenue"] / m24["mau"]
cost_per = m24["costs"] / m24["mau"]
table(
    [
        ["Metric", "Value", "Assumption"],
        ["Revenue per monthly active user", inr(arpu), "All streams combined"],
        ["Cost per monthly active user", inr(cost_per), "Team, marketing, cloud, gateway, legal"],
        ["Blended acquisition cost (CAC)", "₹80 to ₹150", "Referrals, ambassadors and events; paid ads limited"],
        ["Payback", "6 to 12 months", "Depends on 3-month retention (target 35%+)"],
    ],
    [60, 30, 80],
)
p("The model works when people come back. The levers are retention (streaks, crews, recaps, Free now), "
  "plan frequency (more good plans nearby) and the share of paid plans, not aggressive pricing.")

# ---------------------------------------------------------------- 9
h1("9. Financial plan (24 months)")
p("Quarterly view of the monthly model. Revenue excludes GST collected. Costs include team, marketing, "
  "cloud and tools, payment gateway, legal and accounting, and overheads.")
qrows = [["Quarter", "MAU (end)", "Ticket GMV", "Revenue", "Costs", "Net", "Cumulative"]]
for q in range(8):
    chunk = rows[q * 3 : q * 3 + 3]
    end = chunk[-1]
    qrows.append([
        f"Q{q % 4 + 1} {2027 + q // 4}",
        f"{end['mau']:,}",
        L(sum(r["gmv"] for r in chunk)),
        L(sum(r["revenue"] for r in chunk)),
        L(sum(r["costs"] for r in chunk)),
        L(sum(r["net"] for r in chunk)),
        L(end["cum"]),
    ])
table(qrows, [22, 22, 26, 24, 24, 24, 28])
h2("Revenue mix at month 24 (monthly)")
mix = [("Platform fees", m24["fee"]), ("TouchGrass Plus", m24["plus"]), ("Host boosts", m24["boosts"]),
       ("Partner venues", m24["venues"]), ("Brand experiences", m24["brand"]), ("Corporate outings", m24["corp"])]
table([["Stream", "Monthly", "Share"]] + [[n, L(v), f"{v / m24['revenue'] * 100:.0f}%"] for n, v in mix],
      [70, 50, 50])
h2("Key assumptions")
bullets([
    "Users: 300 in the closed beta, 3,000 at public launch (month 3), growth 30%/month to month 6, 20% to month 12, 12% to month 18, 8% to month 24; Bengaluru beta adds 1,500 in month 8.",
    f"Paid tickets per active user per month: 0.05 at beta rising to 0.25 by month 12 and 0.35 by month 24; average ticket {inr(A['avg_ticket'])}.",
    "Plus from month 6 (1% of users, rising to 3%); boosts from month 5; venues from month 4 (10 rising to 120); brand experiences from month 7 (1 to 4 a month); corporate from month 10 (1 to 6 a month).",
    "Team ₹6 L/month (beta), ₹10 L/month (months 4 to 12), ₹16 L/month (year 2); marketing ₹1.5 L to ₹8 L/month; cloud ₹70k + ₹4 per active user per month; legal and overheads ₹1.25 L/month.",
    "Extending growth at 6%/month after month 24 with flat costs, monthly break-even arrives around month 33 at about 1.2 lakh active users.",
])
story.append(PageBreak())

# ---------------------------------------------------------------- 10
h1("10. Go-to-market and launch playbook")
h2("Strategy in one line")
p("Win one neighbourhood at a time with real plans every day, then let squads and friends of friends "
  "carry it to the next one.")
h2("Phase 0: before launch (now to December 2026)")
bullets([
    "Company, bank, GST, DLT sender ID and SMS templates, Razorpay KYC and Route, Apple and Google developer accounts (these take weeks; start now).",
    "Privacy policy and terms reviewed by a lawyer (DPDP Act), grievance officer named, support email live.",
    "Recruit 30 founding hosts (run clubs, quiz masters, board-game cafes, trek groups, artists) and 15 partner venues in Gachibowli and Madhapur.",
    "Build a content calendar of 60+ plans for the first 4 weeks so the feed is never empty.",
    "Waitlist landing page with referral position; collect 2,000+ sign-ups through campus and office communities.",
])
h2("Phase 1: closed beta (months 1 to 2)")
bullets([
    "Invite-only (invite gate on, codes per community), two neighbourhoods, 300 to 1,000 users.",
    "Daily founder-hosted plans for the first two weeks; weekly feedback calls with 20 users.",
    "Measure: plans per day, show-up rate, 4-week retention, time to first plan. Fix the top 5 frictions weekly.",
    "Ambassador programme: 20 campus and office ambassadors with invite codes, passes and recognition.",
])
h2("Phase 2: public Hyderabad launch (month 3)")
bullets([
    "Launch week: 7 days, 7 signature plans (sunrise trek, Irani chai crawl, board-game night, run club, open mic, pottery, lake-side picnic) with partner venues and local creators.",
    "Press and creators: Hyderabad lifestyle pages and creators get early access and host plans, not paid posts.",
    "Referral push: both sides get a pass for a paid plan (built).",
    "App store: screenshots in three languages, ratings prompt after a good check-in.",
])
h2("Phase 3: deepen Hyderabad (months 4 to 7)")
bullets([
    "Expand neighbourhood by neighbourhood (Kondapur, Jubilee Hills, Banjara Hills, Kukatpally); each needs 10 hosts and 5 venues before opening.",
    "Turn on venue subscriptions after the pilot, host boosts, and the first brand series.",
    "Corporate pilots with 3 IT companies for new-joiner circles.",
])
h2("Phase 4: Bengaluru beta (month 8) and beyond")
bullets([
    "Repeat the playbook with a Bengaluru city lead and curator (multi-city admin is built); Visakhapatnam waitlist already collecting.",
    "Only open a city when its waitlist, hosts and venues meet the bar; a thin city hurts the brand.",
])
h2("Channels and budget split (first 12 months)")
table(
    [
        ["Channel", "Share", "Why"],
        ["Community and ambassadors", "30%", "Highest trust, lowest CAC"],
        ["Signature events and venue co-marketing", "25%", "Shows the product working in real life"],
        ["Creators who host", "20%", "Content plus real plans, not one-off posts"],
        ["Referral rewards", "15%", "Squads grow squads; built into the app"],
        ["Paid social (tested)", "10%", "Only lookalike and retargeting once retention is proven"],
    ],
    [70, 25, 75],
)
story.append(PageBreak())

# ---------------------------------------------------------------- 11
h1("11. Operations: community, safety and support")
table(
    [
        ["Area", "How it runs", "Tools in the product"],
        ["Moderation", "Daily rota; held text and flagged images reviewed within 4 hours in launch weeks, 12 hours after", "Moderation queue, holds, sanctions, audit trail"],
        ["Verification", "Selfie checks reviewed within 24 hours; verified badge needed to host", "Verification queue (admin)"],
        ["Safety incidents", "SOS and serious reports escalate to the on-call lead immediately; police liaison process documented", "SOS to trusted contacts, live location, reports"],
        ["Host quality", "Ratings, reliability, curator review of new paid hosts", "Host applications, ratings, payouts on hold"],
        ["Support", "In-app and email, first reply within 24 hours; refunds by published policy", "Receipts, refund engine, account export and deletion"],
        ["City curation", "City curators feature plans, approve hosts and keep the feed full", "City-scoped admin roles, featured slots"],
    ],
    [30, 85, 55],
)

# ---------------------------------------------------------------- 12
h1("12. Legal, compliance and policies")
bullets([
    "<b>Company</b>: private limited company, PAN/TAN, current account; founders' agreement with vesting.",
    "<b>Data protection</b>: DPDP Act 2023 compliant privacy policy and consent; data stays in AWS Mumbai; in-app export and deletion (built).",
    "<b>IT Rules 2021</b>: grievance officer named and published; takedown timelines met by the moderation rota.",
    "<b>Payments</b>: Razorpay KYC, Route for host payouts, refund and cancellation policy page; host KYC before payouts (built).",
    "<b>Tax</b>: GST registration; GST charged on the platform fee; TDS/TCS obligations on marketplace payouts to be confirmed with the CA.",
    "<b>SMS</b>: DLT registration with sender ID and templates (OTP, safety alerts).",
    "<b>Age</b>: 18+ only (enforced at sign-up), stated in store listings.",
    "<b>Events liability</b>: terms limit liability for meet-ups; host responsibilities and community rules published; consider event insurance for large paid plans.",
    "<b>Trademarks</b>: file \"TouchGrass\" word mark and logo in relevant classes (software, events).",
])

# ---------------------------------------------------------------- 13
h1("13. Team and hiring plan")
table(
    [
        ["When", "Role", "Why"],
        ["Now", "Founder / CEO", "Vision, partnerships, fundraising, city launch"],
        ["Now", "Founder / CTO or lead engineer", "Own the codebase, releases, reliability"],
        ["Beta", "Mobile engineer, backend engineer", "Speed of iteration during beta"],
        ["Beta", "Community and partnerships lead (Hyderabad)", "Hosts, venues, ambassadors, events"],
        ["Launch", "Trust and safety associate (part time to full time)", "Moderation and verification queues"],
        ["Month 6", "Designer (product and brand)", "Store assets, campaigns, product polish"],
        ["Month 8", "Bengaluru city lead + curator", "Second city"],
        ["Year 2", "Growth/data analyst, sales for venues and brands", "Revenue scale"],
    ],
    [22, 60, 88],
)
story.append(PageBreak())

# ---------------------------------------------------------------- 14
h1("14. Technology, cost and scale")
p("The platform is built for production: NestJS API, realtime and worker services, PostgreSQL with PostGIS, "
  "Redis, S3 and CloudFront, all in AWS Mumbai with Terraform; Expo apps for iOS and Android; Next.js for "
  "web share pages and the admin console. Load-tested with k6; privacy, security and accessibility reviews "
  "are documented in the repository.")
table(
    [
        ["Cost item", "Launch (per month)", "Scales with"],
        ["AWS (compute, database, Redis, storage, CDN)", "₹40k to ₹60k", "Active users and photo/video storage"],
        ["Maps, SMS OTP, push, monitoring", "₹15k to ₹30k", "Sign-ins, searches, notifications"],
        ["App stores and tools", "₹10k", "Seats"],
        ["Payment gateway", "About 2% of ticket volume", "Paid plans"],
    ],
    [75, 45, 50],
)
small("Estimates; confirm with the AWS calculator once real traffic exists. Video stories will raise storage and transcoding costs.")

# ---------------------------------------------------------------- 15
h1("15. KPIs and how we measure them")
table(
    [
        ["KPI", "Target (by month 12)", "Where it comes from"],
        ["Weekly active users / monthly", "40%+", "Analytics overview (admin)"],
        ["Plans created per week per 1,000 MAU", "60+", "Events data"],
        ["Show-up rate (checked in / going)", "75%+", "Check-ins, reliability"],
        ["Time to first plan after sign-up", "Under 7 days", "Onboarding funnel"],
        ["4-week retention", "35%+", "Cohorts"],
        ["Share of plans that are paid", "15 to 25%", "Payments"],
        ["Host repeat rate (hosts a 2nd plan)", "60%+", "Hosting"],
        ["Safety: reports per 1,000 check-ins", "Falling; all reviewed in SLA", "Moderation queue"],
        ["NPS after plans", "50+", "Post-plan feedback"],
    ],
    [70, 40, 60],
)

# ---------------------------------------------------------------- 16
h1("16. Risks and mitigations")
table(
    [
        ["Risk", "Mitigation"],
        ["Empty feed (cold start)", "Launch one neighbourhood at a time; founding hosts; signature plans; curated plans from the team"],
        ["Safety incident damages trust", "Verification, women-only and balanced plans, mystery locations, SOS, fast moderation, clear incident playbook"],
        ["Low show-up rates", "Reliability tiers and cooldowns, reminders, waitlists, paid plans for committed groups"],
        ["Hosts leave to WhatsApp", "Payments, waitlists, discovery and reputation only work in-app; lower fees for top hosts"],
        ["Big players copy the idea", "Speed, local depth, multilingual product, trust and the squad graph"],
        ["Regulation and tax changes", "CA and lawyer on retainer; compliance built into the product"],
        ["Running out of money", "Staged raise; monthly review of the model; cut paid marketing first"],
    ],
    [55, 115],
)
story.append(PageBreak())

# ---------------------------------------------------------------- 17
h1("17. Funding and use of funds")
p(f"The model's cumulative need over 24 months is about {L(peak_burn)}. A staged plan reduces dilution and risk:")
table(
    [
        ["Round", "Amount", "Milestones it must reach"],
        ["Pre-seed (now)", "₹1.5 to 2 Cr", "Hyderabad launch, 15k+ MAU, 35% 4-week retention, ₹5 L+ monthly revenue, Bengaluru beta started"],
        ["Seed (month 10 to 12)", "₹4 to 6 Cr", "Two cities, 70k+ MAU, clear path to break-even, Plus and brand revenue proven"],
    ],
    [35, 30, 105],
)
table(
    [
        ["Use of pre-seed", "Share"],
        ["Team (engineering, community, safety)", "55%"],
        ["Launch marketing, events and ambassadors", "25%"],
        ["Cloud, tools, maps, SMS", "8%"],
        ["Legal, compliance, accounting", "7%"],
        ["Buffer", "5%"],
    ],
    [120, 50],
)
small("Alternatives to equity at the start: founder funds and friends-and-family, government startup programmes "
      "(Startup India, T-Hub in Hyderabad), and revenue from venue pilots and corporate outings.")

# ---------------------------------------------------------------- 18
h1("18. Roadmap")
table(
    [
        ["When", "Product", "Business"],
        ["Months 0 to 2", "Video stories (15 s), haptics, cover photos for demo plans, store assets", "Beta, founding hosts and venues, DLT and payments live"],
        ["Months 3 to 6", "Self-serve host boosts, venue dashboard, notification tuning", "Public launch, venue subscriptions, first brand series"],
        ["Months 6 to 9", "TouchGrass Plus, crew memberships billing, corporate booking flow", "Bengaluru beta, corporate pilots"],
        ["Months 9 to 12", "Gift passes, smarter matching for solo attendees, recaps 2.0", "Seed round, more neighbourhoods"],
        ["Year 2", "More cities and languages, partner APIs", "Scale venues and brands, approach break-even"],
    ],
    [28, 75, 67],
)
story.append(PageBreak())

# ---------------------------------------------------------------- 19
h1("19. Product ideas to choose from")
p("Pick the ones that fit the next milestone; each is sized roughly (S = days, M = 1 to 2 weeks, L = 3+ weeks).")
table(
    [
        ["Idea", "Why", "Size"],
        ["Video stories (15 s)", "Planned M4; stories with motion feel alive", "L"],
        ["Haptics on Pull up, likes, Ping", "Small delight, premium feel", "S"],
        ["Cover photos for every plan (generated or from venue)", "Photo-led cards look premium; empty gradients do not", "S"],
        ["Plan templates (\"Chai at 6\", \"Sunday trek\")", "Plot in two taps", "S"],
        ["\"Bring a friend\" link for a plan", "Viral loop through WhatsApp", "S"],
        ["Host dashboard with show-up and repeat stats", "Hosts stay when they see results", "M"],
        ["Self-serve host boosts", "Revenue stream 3", "M"],
        ["TouchGrass Plus", "Revenue stream 4", "M"],
        ["Venue dashboard (footfall, perk redemptions)", "Sells venue subscriptions", "M"],
        ["Crew memberships (monthly fee)", "Recurring host income", "M"],
        ["Solo-attendee buddy match (\"pair me with another solo\")", "Lowers the fear of going alone", "M"],
        ["Weather-aware suggestions (move outdoor plans indoors)", "Fewer cancellations in monsoon", "S"],
        ["Plan check-in photo wall that becomes Lore", "More memories, more sharing", "S"],
        ["Calendar sync both ways (busy times)", "Better plan times", "M"],
        ["WhatsApp share cards with live seat count", "Better invites outside the app", "S"],
        ["Corporate booking flow and invoices", "Revenue stream 6", "L"],
        ["Kannada and Tamil", "Bengaluru and Chennai", "M"],
        ["Smart reminders (\"leave in 15 min\" with traffic)", "Higher show-up", "M"],
    ],
    [78, 75, 17],
)

# ---------------------------------------------------------------- 20
h1("20. Launch checklist (what a person must do)")
p("From the repository's launch checklist (docs/LAUNCH_CHECKLIST.md); start the slow ones first.")
bullets([
    "Incorporate, open a current account, register GST; name a grievance officer and support email.",
    "Lawyer-reviewed privacy policy (DPDP), terms, refund policy and contact page on the website.",
    "DLT registration and SMS templates; MSG91 account and keys.",
    "Razorpay KYC, Route enabled, live keys and webhook secret.",
    "Apple Developer and Google Play organisation accounts; store listings in three languages; privacy labels.",
    "Domain, AWS account with billing alarms, Terraform state, first deployment and bootstrap.",
    "Google Maps, OpenWeather, PostHog, Sentry and Expo push keys.",
    "Monochrome Android notification icon and Play feature graphic.",
    "Founding hosts, partner venues with staff PINs, moderation rota, launch-week plans.",
    "Production smoke test: sign-up, plot, pull up, chat, check-in, paid plan, refund, report, deletion.",
])


def frame(c, doc):
    if doc.page == 1:
        c.setFillColor(LIME)
        c.rect(0, A4[1] - 14 * mm, A4[0], 14 * mm, stroke=0, fill=1)
        return
    c.saveState()
    c.setFillColor(LIME)
    c.rect(0, A4[1] - 6 * mm, A4[0], 6 * mm, stroke=0, fill=1)
    c.setFont("Inter", 7.5)
    c.setFillColor(MUTED)
    c.drawString(20 * mm, 10 * mm, "TouchGrass · Business plan · Confidential")
    c.drawRightString(A4[0] - 20 * mm, 10 * mm, f"{doc.page}")
    c.restoreState()


doc = SimpleDocTemplate(
    OUT,
    pagesize=A4,
    leftMargin=20 * mm,
    rightMargin=20 * mm,
    topMargin=16 * mm,
    bottomMargin=18 * mm,
    title="TouchGrass Business Plan",
    author="TouchGrass",
    subject="Business plan, revenue model and launch playbook",
)
doc.build(story, onFirstPage=frame, onLaterPages=frame)
print("ok", OUT)
