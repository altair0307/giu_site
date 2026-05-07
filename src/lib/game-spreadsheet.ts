import ExcelJS from "exceljs";

export const GAME_HEADERS = [
  "제목",
  "인원(명)",
  "베스트 인원",
  "시간(분)",
  "수량(개)",
  "비고",
  "소유자(사용 안 함)",
  "장르",
  "존재 여부",
  "난이도(웨이트)",
  "보드게임 정보 사이트"
] as const;

export type GameImportRow = {
  title: string;
  players: string | null;
  bestPlayers: string | null;
  playTime: string | null;
  quantity: number | null;
  note: string | null;
  genre: string | null;
  isPresent: boolean | null;
  weight: string | null;
  infoUrl: string | null;
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

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const title = cellText(row.getCell(1).value);
    if (!title) {
      return;
    }

    rows.push({
      title,
      players: nullableText(row.getCell(2).value),
      bestPlayers: nullableText(row.getCell(3).value),
      playTime: nullableText(row.getCell(4).value),
      quantity: nullableNumber(row.getCell(5).value),
      note: nullableText(row.getCell(6).value),
      genre: nullableText(row.getCell(8).value),
      isPresent: presentValue(row.getCell(9).value),
      weight: nullableWeight(row.getCell(10).value),
      infoUrl: nullableText(row.getCell(11).value)
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
      "",
      game.genre ?? "",
      game.isPresent === null || game.isPresent === undefined ? "" : game.isPresent ? "ㅇ" : "x",
      game.weight ?? "",
      game.infoUrl ?? ""
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
    { width: 12 },
    { width: 16 },
    { width: 36 }
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
