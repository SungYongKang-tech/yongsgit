const fs = require("fs");

const csv = fs.readFileSync("krx.csv", "utf-8");

const lines = csv.split("\n");

const result = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();

  if (!line) continue;

  const cols = line.split(",");

  const name = String(cols[0] || "")
    .replace(/"/g, "")
    .trim();

  let code = String(cols[1] || "")
    .replace(/"/g, "")
    .trim();

  code = code.padStart(6, "0");

  if (!/^\d{6}$/.test(code)) continue;
  if (!name) continue;

  result.push({
    code,
    name
  });
}

fs.writeFileSync(
  "stocks.json",
  JSON.stringify(result, null, 2),
  "utf-8"
);

console.log("완료:", result.length);
