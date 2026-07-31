import ExcelJS from "exceljs";

export const GAME_HEADERS = [
  "제목",
  "인원(명)",
  "베스트 인원",
  "시간(분)",
  "수량(개)",
  "비고",
  "소유자",
  "장르",
  "세부 장르",
  "존재 여부",
  "난이도(웨이트)"
] as const;

export type GameImportRow = {
  title: string;
  players: string | null;
  bestPlayers: string | null;
  playTime: string | null;
  quantity: number | null;
  note: string | null;
  owner: string | null;
  genre: string | null;
  detailGenre: string | null;
  isPresent: boolean | null;
  weight: string | null;
  infoUrl?: string | null;
};

type ExportRow = GameImportRow & {
  status?: "AVAILABLE" | "BORROWED";
};

function cellText(value: ExcelJS.CellValue | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim();
    }
    if ("result" in value) {
      return String(value.result ?? "").trim();
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
  }

  return String(value).trim();
}

function nullableText(value: ExcelJS.CellValue | undefined) {
  const text = cellText(value);
  return text === "" ? null : text;
}

function nullableNumber(value: ExcelJS.CellValue | undefined) {
  const text = cellText(value);
  if (text === "") {
    return null;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function nullableWeight(value: ExcelJS.CellValue | undefined) {
  const text = cellText(value);
  return text === "" || text === "." ? null : text;
}

function presentValue(value: ExcelJS.CellValue | undefined) {
  const text = cellText(value).toLowerCase();
  if (!text) {
    return null;
  }

  if (["ㅇ", "o", "ok", "true", "y", "yes"].includes(text)) {
    return true;
  }

  if (["x", "false", "n", "no"].includes(text)) {
    return false;
  }

  return null;
}

export async function parseGameWorkbook(buffer: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const rows: GameImportRow[] = [];
  const headerRow = worksheet.getRow(1);
  const headerColumns = new Map<string, number>();

  headerRow.eachCell((cell, columnNumber) => {
    const header = cellText(cell.value).replace(/\s+/g, " ");
    if (header) {
      headerColumns.set(header, columnNumber);
    }
  });

  const column = (header: string, legacyColumn: number) => headerColumns.get(header) ?? legacyColumn;
  const hasDetailGenre = headerColumns.has("세부 장르");

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const title = cellText(row.getCell(column("제목", 1)).value);
    if (!title) {
      return;
    }

    rows.push({
      title,
      players: nullableText(row.getCell(column("인원(명)", 2)).value),
      bestPlayers: nullableText(row.getCell(column("베스트 인원", 3)).value),
      playTime: nullableText(row.getCell(column("시간(분)", 4)).value),
      quantity: nullableNumber(row.getCell(column("수량(개)", 5)).value),
      note: nullableText(row.getCell(column("비고", 6)).value),
      owner: nullableText(row.getCell(column("소유자", 7)).value),
      genre: nullableText(row.getCell(column("장르", 8)).value),
      detailGenre: hasDetailGenre ? nullableText(row.getCell(column("세부 장르", 9)).value) : null,
      isPresent: presentValue(row.getCell(column("존재 여부", hasDetailGenre ? 10 : 9)).value),
      weight: nullableWeight(row.getCell(column("난이도(웨이트)", hasDetailGenre ? 11 : 10)).value),
      infoUrl: headerColumns.has("보드게임 정보 사이트")
        ? nullableText(row.getCell(column("보드게임 정보 사이트", 11)).value)
        : undefined
    });
  });

  return rows;
}

export async function buildGameWorkbook(rows: ExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("보드게임");
  worksheet.addRow([...GAME_HEADERS]);

  for (const game of rows) {
    worksheet.addRow([
      game.title,
      game.players ?? "",
      game.bestPlayers ?? "",
      game.playTime ?? "",
      game.quantity ?? "",
      game.note ?? "",
      game.owner ?? "",
      game.genre ?? "",
      game.detailGenre ?? "",
      game.isPresent === null || game.isPresent === undefined ? "" : game.isPresent ? "ㅇ" : "x",
      game.weight ?? ""
    ]);
  }

  worksheet.columns = [
    { width: 28 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 10 },
    { width: 24 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 12 },
    { width: 16 }
  ];

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD6EEF6" }
  };
  worksheet.autoFilter = "A1:K1";
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
