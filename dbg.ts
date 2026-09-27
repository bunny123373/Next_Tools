import { explainRegex, cronNextRuns, encodeBase64 } from "./lib/tools/engines/dev.ts";
const e = explainRegex("^(?<year>\\d{4})-(0[1-9]|1[0-2])$");
console.log(e.atoms.slice(0, 4).map((a) => `${a.text} :: ${a.detail}`).join("\n"));
console.log("---");
const r = cronNextRuns("0 0 29 2 *", 3, new Date("2026-03-01T00:00:00Z"));
console.log(JSON.stringify(r, null, 1).slice(0, 900));
console.log("---");
console.log(Buffer.from("h\u00e9llo \u2014 w\u00f6rld \ud83c\udf89", "utf8").toString("base64"));
console.log(encodeBase64("h\u00e9llo \u2014 w\u00f6rld \ud83c\udf89", { variant: "standard", lineWidth: 0 }));
