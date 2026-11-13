import { describe, expect, it } from "vitest";
import { strFromU8 } from "fflate";
import { readXlsx, excelSerialToIso } from "@ft/parsers";
import { toCsv, toXlsx } from "./spreadsheet";

const header = ["תאריך", "תיאור", "סכום"];
const rows = [
  [{ date: "2026-10-05" }, 'שופרסל "דיל", סניף 3', -1070],
  [{ date: "2026-10-31" }, "=HYPERLINK(\"http://x\")", 12.5],
  [null, "a\nb", null],
];

describe("spreadsheet export", () => {
  it("writes an XLSX that reads back with real dates and numbers, and neutralizes formulas", () => {
    const [sheet] = readXlsx(toXlsx(header, rows, { sheetName: "תנועות", rtl: true }));
    expect(sheet!.name).toBe("תנועות");
    expect(sheet!.rows[0]).toEqual(header);
    expect(excelSerialToIso(sheet!.rows[1]![0] as number)).toBe("2026-10-05");
    expect(sheet!.rows[1]!.slice(1)).toEqual(['שופרסל "דיל", סניף 3', -1070]);
    expect(sheet!.rows[2]![1]).toBe("'=HYPERLINK(\"http://x\")");
    expect(sheet!.rows[2]![2]).toBe(12.5);
  });

  it("writes CSV with a BOM, quoting, and the same formula guard", () => {
    const bytes = toCsv(header, rows);
    // UTF-8 byte-order mark (decoders drop it, so check the bytes)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = strFromU8(bytes.slice(3)).split("\r\n");
    expect(lines[1]).toBe('2026-10-05,"שופרסל ""דיל"", סניף 3",-1070');
    expect(lines[2]).toBe(`2026-10-31,"'=HYPERLINK(""http://x"")",12.5`);
    expect(lines[3]).toBe(',"a\nb",');
  });
});
