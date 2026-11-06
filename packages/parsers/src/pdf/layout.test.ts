import { describe, expect, it } from "vitest";
import { buildRecords, cells, columnFor, findHeader, fixBidi, groupLines, type Column, type PdfItem } from "./layout.js";

const item = (x: number, r: number, y: number, s: string): PdfItem => ({ x, r, y, s });

describe("fixBidi", () => {
  it("un-mirrors brackets in Hebrew runs only", () => {
    expect(fixBidi(")מקס סטוק(")).toBe("(מקס סטוק)");
    expect(fixBidi("(888)850-3958")).toBe("(888)850-3958");
  });
  it("strips directional marks", () => {
    expect(fixBidi("‎123-45678/90‎")).toBe("123-45678/90");
  });
});

describe("groupLines", () => {
  it("merges items within the y tolerance and orders them right to left", () => {
    const lines = groupLines([{ page: 1, items: [item(10, 20, 100, "b"), item(50, 60, 101, "a"), item(10, 20, 80, "c")] }]);
    expect(lines.map((l) => l.items.map((i) => i.s).join(""))).toEqual(["ab", "c"]);
  });
});

describe("columns", () => {
  const columns: Column[] = [
    { name: "date", right: 524, kind: "number" },
    { name: "merchant", right: 442, kind: "text" },
    { name: "amount", right: 262, kind: "number" },
  ];

  it("assigns by right edge to the nearest column at or beyond it", () => {
    expect(columnFor(item(400, 440, 0, "x"), columns)?.name).toBe("merchant");
    expect(columnFor(item(240, 262, 0, "x"), columns)?.name).toBe("amount");
    expect(columnFor(item(600, 700, 0, "x"), columns)).toBeNull();
  });

  it("re-joins split numbers left to right and Hebrew words right to left", () => {
    const [line] = groupLines([
      {
        page: 1,
        items: [item(490, 524, 10, "12/08/26"), item(423, 442, 10, "רמי"), item(400, 421, 10, "לוי"), item(251, 262, 10, "39"), item(217, 250, 10, "3,100.")],
      },
    ]);
    expect(cells([line!], columns)).toEqual({ date: "12/08/26", merchant: "רמי לוי", amount: "3,100.39" });
  });

  it("finds header right edges in RTL order", () => {
    const [line] = groupLines([{ page: 1, items: [item(502, 524, 5, "תאריך"), item(430, 442, 5, "שם"), item(245, 262, 5, "סכום")] }]);
    expect(findHeader(line!, ["תאריך", "שם", "סכום"])).toEqual([524, 442, 262]);
    expect(findHeader(line!, ["שם", "תאריך"])).toBeNull();
  });
});

describe("buildRecords", () => {
  it("attaches wrapped lines (above or below) to the nearest anchor and re-joins hyphen wraps", () => {
    const lines = groupLines([
      {
        page: 1,
        items: [
          item(380, 470, 105, "FEVER*"),
          item(490, 524, 100, "12/09/26"),
          item(383, 407, 95, "בריאות-"),
          item(400, 407, 88, "י"),
          item(490, 524, 60, "13/09/26"),
          item(400, 440, 60, "שופרסל"),
        ],
      },
    ]);
    const columns: Column[] = [
      { name: "date", right: 524, kind: "number" },
      { name: "desc", right: 470, kind: "text" },
    ];
    const records = buildRecords(lines, (l) => /\d{2}\/\d{2}\/\d{2}/.test(l.items[0]!.s));
    expect(records.map((r) => r.anchor.items[0]!.s)).toEqual(["12/09/26", "13/09/26"]);
    expect(cells(records[0]!.lines, columns).desc).toBe("FEVER* בריאות-י");
    expect(cells(records[1]!.lines, columns).desc).toBe("שופרסל");
  });
});

describe("mid-word wraps", () => {
  const columns: Column[] = [
    { name: "date", right: 524, kind: "number" },
    { name: "desc", right: 407, kind: "text", fullWidthX: 350 },
  ];
  const rec = (first: PdfItem[], second: PdfItem[]) =>
    cells(groupLines([{ page: 1, items: [item(490, 524, 100, "15/10/26"), ...first, ...second] }]), columns).desc;

  it("glues a broken single word that filled the column", () => {
    expect(rec([item(348, 407, 100, "ל.מאסטרקאר")], [item(402, 407, 85, "ד")])).toBe("ל.מאסטרקארד");
  });
  it("keeps the space after a short word that wrapped at a word boundary", () => {
    expect(rec([item(377, 407, 100, "כרטיסי")], [item(371, 407, 85, "אשראי-י")])).toBe("כרטיסי אשראי-י");
  });
});
