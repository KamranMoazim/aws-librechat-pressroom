import random
from datetime import date, timedelta

STATUSES = ["quoted", "approved", "prepress", "proofing", "printing", "finishing", "shipped", "closed"]
PRODUCTS = [
    ("Vinyl banner", "13 oz vinyl, hemmed, grommets"),
    ("Window graphics", "Perforated vinyl, laminated"),
    ("Trade show backdrop", "Dye-sub fabric, SEG frame"),
    ("Yard signs", "4 mm coroplast, H-stakes"),
    ("Vehicle wrap", "Cast vinyl, overlaminate"),
    ("Brochures", "100 lb gloss text, tri-fold"),
    ("Business cards", "16 pt matte, soft-touch"),
    ("Floor decals", "Anti-slip laminate"),
]
CUSTOMERS = [
    "Acme Outdoor", "Northwind Foods", "Contoso Health", "Fabrikam Motors", "Tailspin Toys",
    "Wide World Events", "Litware Schools", "Proseware Bank", "Adventure Works", "Blue Yonder Air",
    "City of Riverton", "Margie's Travel",
]
RESTRICTED_CUSTOMERS = {"City of Riverton"}


def build_data(job_count: int = 200, seed: int = 42) -> dict:
    rng = random.Random(seed)
    customers = {
        f"C{index + 100}": {
            "id": f"C{index + 100}",
            "name": name,
            "terms": rng.choice(["Net 30", "Net 45", "Prepaid"]),
            "restricted": name in RESTRICTED_CUSTOMERS,
        }
        for index, name in enumerate(CUSTOMERS)
    }
    jobs, estimates = {}, {}
    start = date(2026, 9, 1)
    for index in range(job_count):
        number = f"J{24000 + index}"
        customer = rng.choice(list(customers.values()))
        product, spec = rng.choice(PRODUCTS)
        quantity = rng.choice([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000])
        cost = round(rng.uniform(80, 9000), 2)
        price = round(cost * rng.uniform(1.25, 1.9), 2)
        estimate_id = f"E{50000 + index}"
        estimates[estimate_id] = {
            "id": estimate_id,
            "jobNumber": number,
            "customerId": customer["id"],
            "lines": [
                {"item": "Materials", "amount": round(cost * 0.55, 2)},
                {"item": "Press time", "amount": round(cost * 0.3, 2)},
                {"item": "Finishing", "amount": round(cost * 0.15, 2)},
            ],
            "estimatedCost": cost,
            "quotedPrice": price,
            "marginPct": round((price - cost) / price * 100, 1),
        }
        due = start + timedelta(days=rng.randint(3, 120))
        jobs[number] = {
            "jobNumber": number,
            "customerId": customer["id"],
            "customerName": customer["name"],
            "title": f"{product} for {customer['name']}",
            "status": rng.choice(STATUSES),
            "dueDate": due.isoformat(),
            "quantity": quantity,
            "parts": [{"part": 1, "description": product, "spec": spec, "quantity": quantity}],
            "notes": [],
            "estimateId": estimate_id,
            "estimatedCost": cost,
            "quotedPrice": price,
            "marginPct": estimates[estimate_id]["marginPct"],
            "restricted": customer["restricted"],
            "version": 1,
        }
    return {"customers": customers, "jobs": jobs, "estimates": estimates}
