import json
from pykrx import stock

markets = ["KOSPI", "KOSDAQ", "KONEX"]
result = []
seen = set()

for market in markets:
    tickers = stock.get_market_ticker_list(market=market)

    for code in tickers:
        if code in seen:
            continue

        name = stock.get_market_ticker_name(code)

        if code and name:
            result.append({
                "code": code,
                "name": name,
                "market": market
            })
            seen.add(code)

with open("stocks.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("완료:", len(result))
