import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildGameWorkbook, GAME_HEADERS, parseGameWorkbook } from "./game-spreadsheet";

async function workbookBuffer(headers: string[], values: unknown[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  worksheet.addRow(headers);
  worksheet.addRow(values);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

test("새 양식의 세부 장르와 뒤쪽 열을 올바르게 읽는다", async () => {
  const rows = await parseGameWorkbook(
    await workbookBuffer([...GAME_HEADERS], ["달무티", "4~8", "6~8", "∞", 3, "구판", "기우회", "카드 게임", "클라이밍", "x", 1.28])
  );

  assert.deepEqual(rows, [
    {
      title: "달무티",
      players: "4~8",
      bestPlayers: "6~8",
      playTime: "∞",
      quantity: 3,
      note: "구판",
      owner: "기우회",
      genre: "카드 게임",
      detailGenre: "클라이밍",
      isPresent: false,
      weight: "1.28",
      infoUrl: undefined
    }
  ]);
});

test("이전 양식도 열 헤더를 기준으로 계속 읽는다", async () => {
  const rows = await parseGameWorkbook(
    await workbookBuffer(
      ["제목", "인원(명)", "베스트 인원", "시간(분)", "수량(개)", "비고", "소유자", "장르", "존재 여부", "난이도(웨이트)", "보드게임 정보 사이트"],
      ["티츄", 4, 4, 60, 1, "신판", "진수빈", "카드 게임", "ㅇ", 1.5, "https://example.com/tichu"]
    )
  );

  assert.equal(rows[0].detailGenre, null);
  assert.equal(rows[0].isPresent, true);
  assert.equal(rows[0].weight, "1.5");
  assert.equal(rows[0].infoUrl, "https://example.com/tichu");
});

test("다운로드 파일은 새 A-K 양식을 사용한다", async () => {
  const buffer = await buildGameWorkbook([
    {
      title: "스컬킹",
      players: "2~8",
      bestPlayers: "4~6",
      playTime: "30",
      quantity: 1,
      note: null,
      owner: "기우회",
      genre: "카드 게임",
      detailGenre: "트릭테이킹",
      isPresent: true,
      weight: "1.74",
      infoUrl: "https://example.com/skull-king"
    }
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  const headerValues = worksheet.getRow(1).values as ExcelJS.CellValue[];
  const gameValues = worksheet.getRow(2).values as ExcelJS.CellValue[];

  assert.deepEqual(headerValues.slice(1), [...GAME_HEADERS]);
  assert.deepEqual(gameValues.slice(1), ["스컬킹", "2~8", "4~6", "30", 1, "", "기우회", "카드 게임", "트릭테이킹", "ㅇ", "1.74"]);
  assert.equal(worksheet.autoFilter?.toString(), "A1:K1");
});
