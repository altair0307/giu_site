"use server";

import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { createGeneralActivityLog, createLoanActivityLog, createMeetupActivityLog } from "@/lib/activity-log";
import { prisma } from "@/lib/db";
import { parseKoreaDateTimeLocal } from "@/lib/date-time";
import { NEGATIVE_RATING_REASON_VALUES, POSITIVE_RATING_REASON_VALUES, RATING_REASON_VALUES } from "@/lib/game-rating";
import { parseGameWorkbook } from "@/lib/game-spreadsheet";
import { notifyLoanBorrowed, notifyReturnRequested } from "@/lib/notifications";
import { assertRateLimit } from "@/lib/rate-limit";
import { getClientKey } from "@/lib/request";

const loginIdSchema = z
  .string()
  .trim()
  .min(3, "아이디는 3자 이상이어야 합니다.")
  .max(30, "아이디는 30자 이하여야 합니다.")
  .regex(/^[a-zA-Z0-9_-]+$/, "아이디는 영문, 숫자, _, -만 사용할 수 있습니다.");

const passwordSchema = z.string().min(8, "비밀번호는 8자 이상이어야 합니다.");
const MAX_LOAN_PHOTO_SIZE = 8 * 1024 * 1024;
const ALLOWED_LOAN_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const BRIDGE_SEAT_POSITIONS = ["NORTH", "EAST", "SOUTH", "WEST"] as const;
const BRIDGE_SUITS = ["S", "H", "D", "C"] as const;
const BRIDGE_RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const BRIDGE_CONTRACT_SUITS = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES", "NOTRUMP"] as const;
const BRIDGE_CALL_TYPES = ["PASS", "BID", "DOUBLE", "REDOUBLE"] as const;

type BridgeSeatPositionValue = (typeof BRIDGE_SEAT_POSITIONS)[number];
type BridgeSuitValue = (typeof BRIDGE_SUITS)[number];
type BridgeRankValue = (typeof BRIDGE_RANKS)[number];
type BridgeContractSuitValue = (typeof BRIDGE_CONTRACT_SUITS)[number];
type BridgeCallTypeValue = (typeof BRIDGE_CALL_TYPES)[number];
type BridgeDoubleStatusValue = "UNDOUBLED" | "DOUBLED" | "REDOUBLED";
type BridgeVulnerabilityValue = "NONE" | "NS" | "EW" | "BOTH";

export type ActionState = {
  ok?: boolean;
  message?: string;
  redirectTo?: string;
};

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function actionError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function createShuffledBridgeDeck() {
  const deck = BRIDGE_SUITS.flatMap((suit) => BRIDGE_RANKS.map((rank) => `${rank}${suit}`));

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

function randomBridgeSeatPosition(takenPositions: string[]) {
  const availablePositions = BRIDGE_SEAT_POSITIONS.filter((position) => !takenPositions.includes(position));

  if (availablePositions.length === 0) {
    return null;
  }

  return availablePositions[randomInt(availablePositions.length)];
}

function shuffledBridgeSeatPositions(count: number) {
  const positions = [...BRIDGE_SEAT_POSITIONS];

  for (let index = positions.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [positions[index], positions[swapIndex]] = [positions[swapIndex], positions[index]];
  }

  return positions.slice(0, count);
}

function nextBridgeTurn(position: BridgeSeatPositionValue) {
  return BRIDGE_SEAT_POSITIONS[(BRIDGE_SEAT_POSITIONS.indexOf(position) + 1) % BRIDGE_SEAT_POSITIONS.length];
}

function bridgePartner(position: BridgeSeatPositionValue) {
  return BRIDGE_SEAT_POSITIONS[(BRIDGE_SEAT_POSITIONS.indexOf(position) + 2) % BRIDGE_SEAT_POSITIONS.length];
}

function bridgeTeam(position: BridgeSeatPositionValue) {
  return position === "NORTH" || position === "SOUTH" ? "NS" : "EW";
}

function bridgeDealerForBoard(boardNumber: number) {
  return BRIDGE_SEAT_POSITIONS[(boardNumber - 1) % BRIDGE_SEAT_POSITIONS.length];
}

function bridgeVulnerabilityForBoard(boardNumber: number): BridgeVulnerabilityValue {
  const vulnerabilityCycle: BridgeVulnerabilityValue[] = [
    "NONE",
    "NS",
    "EW",
    "BOTH",
    "NS",
    "EW",
    "BOTH",
    "NONE",
    "EW",
    "BOTH",
    "NONE",
    "NS",
    "BOTH",
    "NONE",
    "NS",
    "EW"
  ];

  return vulnerabilityCycle[(boardNumber - 1) % vulnerabilityCycle.length];
}

function parseBridgeCard(card: string) {
  const suit = card.slice(-1) as BridgeSuitValue;
  const rank = card.slice(0, -1) as BridgeRankValue;

  if (!BRIDGE_SUITS.includes(suit) || !BRIDGE_RANKS.includes(rank)) {
    throw new Error("올바르지 않은 카드입니다.");
  }

  return { rank, suit };
}

function contractSuitToCardSuit(contractSuit: BridgeContractSuitValue) {
  const suitMap = {
    CLUBS: "C",
    DIAMONDS: "D",
    HEARTS: "H",
    SPADES: "S",
    NOTRUMP: null
  } as const;

  return suitMap[contractSuit];
}

function bridgeContractOrder(level: number, suit: BridgeContractSuitValue) {
  return (level - 1) * BRIDGE_CONTRACT_SUITS.length + BRIDGE_CONTRACT_SUITS.indexOf(suit);
}

function bridgeVulnerabilityForTeam(team: ReturnType<typeof bridgeTeam>, vulnerability: BridgeVulnerabilityValue) {
  return vulnerability === "BOTH" || vulnerability === team;
}

function readBridgeHands(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("손패 정보를 읽을 수 없습니다.");
  }

  return Object.fromEntries(
    BRIDGE_SEAT_POSITIONS.map((position) => {
      const cards = (value as Record<string, unknown>)[position];
      return [position, Array.isArray(cards) ? cards.filter((card): card is string => typeof card === "string") : []];
    })
  ) as Record<BridgeSeatPositionValue, string[]>;
}

function chooseBridgeTrickWinner(
  plays: { position: BridgeSeatPositionValue; card: string; createdAt: Date }[],
  contractSuit: BridgeContractSuitValue
) {
  const orderedPlays = [...plays].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const leadSuit = parseBridgeCard(orderedPlays[0].card).suit;
  const trumpSuit = contractSuitToCardSuit(contractSuit);

  return orderedPlays.reduce((winner, play) => {
    const winnerCard = parseBridgeCard(winner.card);
    const playCard = parseBridgeCard(play.card);
    const winnerIsTrump = trumpSuit !== null && winnerCard.suit === trumpSuit;
    const playIsTrump = trumpSuit !== null && playCard.suit === trumpSuit;

    if (playIsTrump && !winnerIsTrump) {
      return play;
    }

    if (playIsTrump === winnerIsTrump && playCard.suit === winnerCard.suit) {
      const playRank = BRIDGE_RANKS.indexOf(playCard.rank);
      const winnerRank = BRIDGE_RANKS.indexOf(winnerCard.rank);

      if (playRank < winnerRank) {
        return play;
      }
    }

    if (!winnerIsTrump && !playIsTrump && winnerCard.suit !== leadSuit && playCard.suit === leadSuit) {
      return play;
    }

    return winner;
  }, orderedPlays[0]).position;
}

function calculateBridgeContractResult({
  contractLevel,
  contractSuit,
  declarerTricks,
  doubleStatus = "UNDOUBLED",
  vulnerable = false
}: {
  contractLevel: number;
  contractSuit: BridgeContractSuitValue;
  declarerTricks: number;
  doubleStatus?: BridgeDoubleStatusValue;
  vulnerable?: boolean;
}) {
  const targetTricks = contractLevel + 6;
  const contractMade = declarerTricks >= targetTricks;
  const overtricks = contractMade ? declarerTricks - targetTricks : 0;
  const undertricks = contractMade ? 0 : targetTricks - declarerTricks;

  if (!contractMade) {
    if (doubleStatus === "UNDOUBLED") {
      return {
        contractMade,
        overtricks,
        undertricks,
        score: undertricks * (vulnerable ? -100 : -50)
      };
    }

    const doubledPenalty = Array.from({ length: undertricks }, (_, index) => {
      if (vulnerable) {
        return index === 0 ? 200 : 300;
      }

      if (index === 0) {
        return 100;
      }

      return index < 3 ? 200 : 300;
    }).reduce((sum, penalty) => sum + penalty, 0);
    const multiplier = doubleStatus === "REDOUBLED" ? 2 : 1;

    return {
      contractMade,
      overtricks,
      undertricks,
      score: doubledPenalty * multiplier * -1
    };
  }

  const isMinor = contractSuit === "CLUBS" || contractSuit === "DIAMONDS";
  const isNotrump = contractSuit === "NOTRUMP";
  const baseTrickScore = isNotrump ? 40 + Math.max(0, contractLevel - 1) * 30 : contractLevel * (isMinor ? 20 : 30);
  const scoreMultiplier = doubleStatus === "REDOUBLED" ? 4 : doubleStatus === "DOUBLED" ? 2 : 1;
  const trickScore = baseTrickScore * scoreMultiplier;
  const overtrickValue =
    doubleStatus === "REDOUBLED"
      ? vulnerable
        ? 400
        : 200
      : doubleStatus === "DOUBLED"
        ? vulnerable
          ? 200
          : 100
        : isMinor
          ? 20
          : 30;
  const insultBonus = doubleStatus === "REDOUBLED" ? 100 : doubleStatus === "DOUBLED" ? 50 : 0;
  const gameBonus = trickScore >= 100 ? (vulnerable ? 500 : 300) : 50;
  const slamBonus = contractLevel === 6 ? (vulnerable ? 750 : 500) : contractLevel === 7 ? (vulnerable ? 1500 : 1000) : 0;

  return {
    contractMade,
    overtricks,
    undertricks,
    score: trickScore + overtricks * overtrickValue + insultBonus + gameBonus + slamBonus
  };
}

async function createBridgeEvent(
  tx: Prisma.TransactionClient,
  input: {
    roomId: string;
    type:
      | "ROOM_CREATED"
      | "SEAT_JOINED"
      | "SEAT_LEFT"
      | "DEAL_CREATED"
      | "CONTRACT_SET"
      | "CALL_MADE"
      | "CARD_PLAYED"
      | "TRICK_COMPLETED"
      | "ROUND_COMPLETED"
      | "SEATS_RANDOMIZED"
      | "SEATS_CHANGED";
    actorId?: string;
    payload?: Prisma.InputJsonValue;
  }
) {
  await tx.bridgeEvent.create({
    data: {
      roomId: input.roomId,
      type: input.type,
      actorId: input.actorId,
      payload: input.payload
    }
  });
}

async function readLoanPhoto(formData: FormData) {
  const file = formData.get("photo");

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("사진을 업로드해주세요.");
  }

  if (!ALLOWED_LOAN_PHOTO_TYPES.has(file.type)) {
    throw new Error("사진은 JPG, PNG, WebP 형식만 업로드할 수 있습니다.");
  }

  if (file.size > MAX_LOAN_PHOTO_SIZE) {
    throw new Error("사진은 8MB 이하로 업로드해주세요.");
  }

  return {
    contentType: file.type,
    size: file.size,
    data: Buffer.from(await file.arrayBuffer())
  };
}

async function assertGameHasNoUpcomingMeetup(gameId: string, startsAt = new Date()) {
  const upcomingMeetup = await prisma.meetup.findFirst({
    where: {
      gameId,
      startsAt: { gte: startsAt }
    },
    select: { id: true }
  });

  if (upcomingMeetup) {
    throw new Error("이미 예정된 약속이 있는 게임은 대여하거나 다른 약속에 선택할 수 없습니다.");
  }
}

async function findMeetupForLog(tx: Prisma.TransactionClient, meetupId: string) {
  return tx.meetup.findUnique({
    where: { id: meetupId },
    include: {
      game: { select: { title: true } },
      table: { select: { name: true } },
      host: { select: { name: true, loginId: true } },
      participants: {
        include: {
          user: { select: { id: true, name: true, loginId: true, studentId: true } }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
}

function calculateRatingTrustWeight({
  verified,
  selfReported,
  reasonTagCount,
  hasComment,
  recentRatingCount
}: {
  verified: boolean;
  selfReported: boolean;
  reasonTagCount: number;
  hasComment: boolean;
  recentRatingCount: number;
}) {
  let weight = verified ? 1 : selfReported ? 0.7 : 0.5;

  if (reasonTagCount > 0) {
    weight += 0.1;
  }

  if (hasComment) {
    weight += 0.1;
  }

  if (recentRatingCount >= 10) {
    weight -= 0.4;
  } else if (recentRatingCount >= 5) {
    weight -= 0.2;
  }

  return Math.min(1, Math.max(0.1, Number(weight.toFixed(2))));
}

export async function registerAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    assertRateLimit(await getClientKey("register"), 5, 60_000);

    const parsed = z
      .object({
        name: z.string().trim().min(2, "이름을 입력해주세요.").max(20),
        loginId: loginIdSchema,
        studentId: z.string().trim().max(30).optional(),
        password: passwordSchema,
        passwordConfirm: z.string().min(1, "비밀번호 확인을 입력해주세요.")
      })
      .refine((data) => data.password === data.passwordConfirm, {
        message: "비밀번호와 비밀번호 확인이 다릅니다."
      })
      .parse({
        name: value(formData, "name"),
        loginId: value(formData, "loginId"),
        studentId: value(formData, "studentId") || undefined,
        password: String(formData.get("password") ?? ""),
        passwordConfirm: String(formData.get("passwordConfirm") ?? "")
      });

    const existing = await prisma.user.findUnique({
      where: { loginId: parsed.loginId }
    });

    if (existing) {
      return { message: "이미 사용 중인 아이디입니다." };
    }

    const userCount = await prisma.user.count();
    const passwordHash = await bcrypt.hash(parsed.password, 12);

    const user = await prisma.user.create({
      data: {
        name: parsed.name,
        loginId: parsed.loginId,
        studentId: parsed.studentId,
        passwordHash,
        role: userCount === 0 ? "ADMIN" : "MEMBER"
      }
    });

    await createSession(user.id);
    await createGeneralActivityLog(prisma, {
      category: "USER",
      action: "REGISTER",
      actor: user,
      target: { type: "USER", id: user.id, name: user.name },
      message: `${user.name} 회원이 가입했습니다.`,
      metadata: {
        loginId: user.loginId,
        studentId: user.studentId,
        role: user.role
      }
    });
  } catch (error) {
    return { message: actionError(error, "회원가입에 실패했습니다.") };
  }

  redirect("/");
}

export async function loginAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let mustChangePassword = false;

  try {
    assertRateLimit(await getClientKey("login"), 8, 60_000);

    const parsed = z
      .object({
        loginId: loginIdSchema,
        password: z.string().min(1, "비밀번호를 입력해주세요.")
      })
      .parse({
        loginId: value(formData, "loginId"),
        password: String(formData.get("password") ?? "")
      });

    const user = await prisma.user.findUnique({
      where: { loginId: parsed.loginId }
    });

    if (!user || !(await bcrypt.compare(parsed.password, user.passwordHash))) {
      return { message: "아이디 또는 비밀번호가 올바르지 않습니다." };
    }

    await createSession(user.id);
    mustChangePassword = user.mustChangePassword;
  } catch (error) {
    return { message: actionError(error, "로그인에 실패했습니다.") };
  }

  if (mustChangePassword) {
    redirect("/account/password");
  }

  redirect("/");
}

export async function changePasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`change-password:${user.id}`, 8, 60_000);

    const parsed = z
      .object({
        password: passwordSchema,
        passwordConfirm: z.string().min(1, "비밀번호 확인을 입력해주세요.")
      })
      .refine((data) => data.password === data.passwordConfirm, {
        message: "비밀번호와 비밀번호 확인이 다릅니다."
      })
      .parse({
        password: String(formData.get("password") ?? ""),
        passwordConfirm: String(formData.get("passwordConfirm") ?? "")
      });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(parsed.password, 12),
        mustChangePassword: false
      }
    });
    await createGeneralActivityLog(prisma, {
      category: "ACCOUNT",
      action: "CHANGE_PASSWORD",
      actor: user,
      target: { type: "USER", id: user.id, name: user.name },
      message: `${user.name} 회원이 비밀번호를 변경했습니다.`
    });

    revalidatePath("/");
    revalidatePath("/admin/logs");
    revalidatePath("/account/password");
  } catch (error) {
    return { message: actionError(error, "비밀번호 변경에 실패했습니다.") };
  }

  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function saveGameRatingAction(formData: FormData): Promise<ActionState> {
  const user = await requireUser();

  try {
    assertRateLimit(`rate-game:${user.id}`, 20, 60_000);

    const parsed = z
      .object({
        gameId: z.string().min(1),
        score: z.coerce
          .number()
          .min(1, "평점은 1.0점 이상이어야 합니다.")
          .max(5, "평점은 5.0점 이하여야 합니다.")
          .refine((score) => Math.abs(score * 10 - Math.round(score * 10)) < 0.000001, "평점은 0.1 단위로 입력해주세요.")
          .transform((score) => Math.round(score * 10) / 10),
        played: z.boolean(),
        reasonTags: z.array(z.string()).min(1, "평점 이유 태그를 하나 이상 선택해주세요.").max(RATING_REASON_VALUES.size),
        comment: z.string().trim().max(300).optional()
      })
      .parse({
        gameId: value(formData, "gameId"),
        score: formData.get("score"),
        played: formData.get("played") === "on",
        reasonTags: formData.getAll("reasonTags").map((tag) => String(tag)),
        comment: value(formData, "comment") || undefined
      });

    const reasonTags = Array.from(new Set(parsed.reasonTags)).filter((tag) => RATING_REASON_VALUES.has(tag));

    if (reasonTags.length === 0) {
      throw new Error("평점 이유 태그를 하나 이상 선택해주세요.");
    }

    const expectedReasonValues =
      parsed.score >= 4
        ? POSITIVE_RATING_REASON_VALUES
        : parsed.score >= 3
          ? new Set([...POSITIVE_RATING_REASON_VALUES, ...NEGATIVE_RATING_REASON_VALUES])
          : NEGATIVE_RATING_REASON_VALUES;
    const expectedReasonLabel = parsed.score >= 4 ? "좋았던 이유" : parsed.score >= 3 ? "좋았던 이유 또는 아쉬웠던 이유" : "아쉬웠던 이유";

    if (reasonTags.some((tag) => !expectedReasonValues.has(tag))) {
      throw new Error(`${parsed.score.toFixed(1)}점에는 ${expectedReasonLabel} 태그만 선택할 수 있습니다.`);
    }

    const game = await prisma.game.findUnique({
      where: { id: parsed.gameId },
      select: { id: true, title: true }
    });

    if (!game) {
      throw new Error("평가할 게임을 찾을 수 없습니다.");
    }

    const [verifiedLoanCount, recentRatingCount, existingRating] = await Promise.all([
      prisma.loanActivityLog.count({
        where: {
          type: "BORROW",
          gameId: parsed.gameId,
          borrowerId: user.id
        }
      }),
      prisma.gameRating.count({
        where: {
          userId: user.id,
          updatedAt: { gte: new Date(Date.now() - 60_000) }
        }
      }),
      prisma.gameRating.findUnique({
        where: {
          gameId_userId: {
            gameId: parsed.gameId,
            userId: user.id
          }
        },
        select: {
          score: true,
          playedStatus: true,
          trustWeight: true,
          reasonTags: true,
          comment: true,
          isHidden: true
        }
      })
    ]);

    const verified = verifiedLoanCount > 0;
    const playedStatus = verified ? "VERIFIED" : parsed.played ? "SELF_REPORTED" : "UNVERIFIED";
    const trustWeight = calculateRatingTrustWeight({
      verified,
      selfReported: parsed.played,
      reasonTagCount: reasonTags.length,
      hasComment: Boolean(parsed.comment),
      recentRatingCount
    });

    await prisma.gameRating.upsert({
      where: {
        gameId_userId: {
          gameId: parsed.gameId,
          userId: user.id
        }
      },
      create: {
        gameId: parsed.gameId,
        userId: user.id,
        score: parsed.score,
        playedStatus,
        trustWeight,
        reasonTags,
        comment: parsed.comment
      },
      update: {
        score: parsed.score,
        playedStatus,
        trustWeight,
        reasonTags,
        comment: parsed.comment,
        isHidden: false
      }
    });

    await createGeneralActivityLog(prisma, {
      category: "RATING",
      action: existingRating ? "UPDATE_RATING" : "CREATE_RATING",
      actor: user,
      target: { type: "GAME", id: game.id, name: game.title },
      message: existingRating
        ? `${user.name} 회원이 ${game.title} 보드게임 평점을 수정했습니다.`
        : `${user.name} 회원이 ${game.title} 보드게임에 평점을 남겼습니다.`,
      metadata: {
        score: parsed.score,
        playedStatus,
        trustWeight,
        reasonTags,
        hasComment: Boolean(parsed.comment),
        previous: existingRating
          ? {
              score: existingRating.score,
              playedStatus: existingRating.playedStatus,
              trustWeight: existingRating.trustWeight,
              reasonTags: existingRating.reasonTags,
              hasComment: Boolean(existingRating.comment),
              wasHidden: existingRating.isHidden
            }
          : null
      }
    });

    revalidatePath("/");
    revalidatePath("/account");
    revalidatePath("/admin/logs");

    return { ok: true };
  } catch (error) {
    return { message: actionError(error, "평점을 저장하지 못했습니다.") };
  }
}

export async function addGameAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`add-game:${user.id}`, 10, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 게임을 추가할 수 있습니다." };
    }

    const parsed = z
      .object({
        title: z.string().trim().min(1).max(60),
        players: z.string().trim().max(40).optional(),
        bestPlayers: z.string().trim().max(40).optional(),
        playTime: z.string().trim().max(40).optional(),
        quantity: z.coerce.number().int().min(0).max(999).optional().nullable(),
        note: z.string().trim().max(300).optional(),
        genre: z.string().trim().max(80).optional(),
        isPresent: z.enum(["", "true", "false"]).optional(),
        weight: z.string().trim().max(40).optional(),
        infoUrl: z.string().trim().max(500).optional()
      })
      .parse({
        title: value(formData, "title"),
        players: value(formData, "players") || undefined,
        bestPlayers: value(formData, "bestPlayers") || undefined,
        playTime: value(formData, "playTime") || undefined,
        quantity: value(formData, "quantity") === "" ? null : formData.get("quantity"),
        note: value(formData, "note") || undefined,
        genre: value(formData, "genre") || undefined,
        isPresent: value(formData, "isPresent") as "" | "true" | "false",
        weight: value(formData, "weight") || undefined,
        infoUrl: value(formData, "infoUrl") || undefined
      });

    const game = await prisma.game.create({
      data: {
        ...parsed,
        isPresent: parsed.isPresent === "" || parsed.isPresent === undefined ? null : parsed.isPresent === "true"
      }
    });
    await createGeneralActivityLog(prisma, {
      category: "GAME",
      action: "CREATE",
      actor: user,
      target: { type: "GAME", id: game.id, name: game.title },
      message: `${user.name} 관리자가 ${game.title} 보드게임을 등록했습니다.`,
      metadata: {
        players: game.players,
        bestPlayers: game.bestPlayers,
        playTime: game.playTime,
        quantity: game.quantity,
        genre: game.genre,
        isPresent: game.isPresent,
        weight: game.weight
      }
    });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/games");
    revalidatePath("/admin/logs");
    return { ok: true, message: "게임을 추가했습니다." };
  } catch (error) {
    return { message: actionError(error, "게임 추가에 실패했습니다.") };
  }
}

export async function borrowGameAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`borrow:${user.id}`, 12, 60_000);

  const gameId = value(formData, "gameId");
  const photo = await readLoanPhoto(formData);
  const now = new Date();
  await assertGameHasNoUpcomingMeetup(gameId, now);

  const borrowedLoan = await prisma.$transaction(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });

    if (!game || game.status !== "AVAILABLE") {
      throw new Error("대여 요청 가능한 게임이 아닙니다.");
    }

    const pendingRequest = await tx.loanRequest.findFirst({
      where: {
        gameId,
        type: "BORROW",
        status: "PENDING"
      }
    });

    if (pendingRequest) {
      throw new Error("이미 대여 승인 대기 중인 게임입니다.");
    }

    const request = await tx.loanRequest.create({
      data: {
        type: "BORROW",
        status: "APPROVED",
        gameId,
        requesterId: user.id,
        reviewedAt: now
      }
    });

    const loan = await tx.loan.create({
      data: {
        gameId,
        borrowerId: user.id,
        borrowedAt: now,
        dueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    await tx.loanPhoto.create({
      data: {
        type: "BORROW",
        loanId: loan.id,
        loanRequestId: request.id,
        ...photo
      }
    });

    await tx.loanRequest.update({
      where: { id: request.id },
      data: { loanId: loan.id }
    });

    await tx.game.update({
      where: { id: gameId },
      data: { status: "BORROWED" }
    });

    await createLoanActivityLog(tx, {
      type: "BORROW",
      loanId: loan.id,
      gameId,
      gameTitle: game.title,
      borrowerId: user.id,
      borrowerName: user.name,
      borrowerLoginId: user.loginId,
      borrowerStudentId: user.studentId,
      occurredAt: now,
      dueAt: loan.dueAt
    });

    return {
      loanId: loan.id,
      loanRequestId: request.id,
      gameTitle: game.title,
      borrowerName: user.name,
      borrowerLoginId: user.loginId,
      borrowerStudentId: user.studentId,
      borrowedAt: loan.borrowedAt,
      dueAt: loan.dueAt,
      userId: user.id
    };
  });

  await notifyLoanBorrowed(borrowedLoan);

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
  revalidatePath("/admin/logs");
}

export async function returnGameAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`return:${user.id}`, 12, 60_000);

  const loanId = value(formData, "loanId");
  const photo = await readLoanPhoto(formData);
  const activeLoan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: { game: true }
  });

  if (!activeLoan || activeLoan.status !== "ACTIVE") {
    throw new Error("반납 가능한 대여 기록이 아닙니다.");
  }

  if (activeLoan.borrowerId !== user.id && user.role !== "ADMIN") {
    throw new Error("본인 또는 관리자만 반납 요청을 할 수 있습니다.");
  }

  const pendingRequest = await prisma.loanRequest.findFirst({
    where: {
      loanId,
      type: "RETURN",
      status: "PENDING"
    }
  });

  if (pendingRequest) {
    throw new Error("이미 반납 승인 대기 중인 대여 기록입니다.");
  }

  const returnRequest = await prisma.$transaction(async (tx) => {
    const request = await tx.loanRequest.create({
      data: {
        type: "RETURN",
        gameId: activeLoan.gameId,
        loanId,
        requesterId: user.id
      }
    });

    await tx.loanPhoto.create({
      data: {
        type: "RETURN",
        loanId,
        loanRequestId: request.id,
        ...photo
      }
    });

    return request;
  });

  await notifyReturnRequested({
    loanId,
    loanRequestId: returnRequest.id,
    gameTitle: activeLoan.game.title,
    borrowerName: user.name,
    borrowerLoginId: user.loginId,
    borrowerStudentId: user.studentId,
    dueAt: activeLoan.dueAt,
    requestedAt: returnRequest.requestedAt,
    userId: user.id
  });

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
  revalidatePath("/admin/logs");
}

export async function approveLoanRequestAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`approve-loan-request:${user.id}`, 30, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 대여/반납 요청을 승인할 수 있습니다.");
  }

  const requestId = value(formData, "requestId");
  const now = new Date();

  const borrowedLoan = await prisma.$transaction(async (tx) => {
    const request = await tx.loanRequest.findUnique({
      where: { id: requestId },
      include: {
        game: true,
        requester: { select: { id: true, name: true, loginId: true, studentId: true } },
        loan: {
          include: {
            borrower: { select: { id: true, name: true, loginId: true, studentId: true } }
          }
        }
      }
    });

    if (!request || request.status !== "PENDING") {
      throw new Error("승인 가능한 요청이 아닙니다.");
    }

    if (request.type === "BORROW") {
      const game = await tx.game.findUnique({ where: { id: request.gameId } });

      if (!game || game.status !== "AVAILABLE") {
        throw new Error("현재 대여 가능한 게임이 아닙니다.");
      }

      const loan = await tx.loan.create({
        data: {
          gameId: request.gameId,
          borrowerId: request.requesterId,
          borrowedAt: now,
          dueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        }
      });

      await tx.game.update({
        where: { id: request.gameId },
        data: { status: "BORROWED" }
      });

      await tx.loanRequest.updateMany({
        where: {
          id: { not: request.id },
          gameId: request.gameId,
          type: "BORROW",
          status: "PENDING"
        },
        data: {
          status: "REJECTED",
          reviewerId: user.id,
          reviewedAt: now
        }
      });

      await createLoanActivityLog(tx, {
        type: "BORROW",
        loanId: loan.id,
        gameId: request.gameId,
        gameTitle: request.game.title,
        borrowerId: request.requester.id,
        borrowerName: request.requester.name,
        borrowerLoginId: request.requester.loginId,
        borrowerStudentId: request.requester.studentId,
        occurredAt: now,
        dueAt: loan.dueAt
      });

      await tx.loanRequest.update({
        where: { id: request.id },
        data: { loanId: loan.id }
      });

      await tx.loanRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          reviewerId: user.id,
          reviewedAt: now
        }
      });

      return {
        loanId: loan.id,
        loanRequestId: request.id,
        gameTitle: request.game.title,
        borrowerName: request.requester.name,
        borrowerLoginId: request.requester.loginId,
        borrowerStudentId: request.requester.studentId,
        borrowedAt: loan.borrowedAt,
        dueAt: loan.dueAt,
        userId: request.requester.id
      };
    } else {
      if (!request.loanId || !request.loan || request.loan.status !== "ACTIVE") {
        throw new Error("반납 승인 가능한 대여 기록이 아닙니다.");
      }

      await tx.game.update({
        where: { id: request.gameId },
        data: { status: "AVAILABLE" }
      });

      await createLoanActivityLog(tx, {
        type: "RETURN",
        loanId: request.loan.id,
        gameId: request.gameId,
        gameTitle: request.game.title,
        borrowerId: request.loan.borrower.id,
        borrowerName: request.loan.borrower.name,
        borrowerLoginId: request.loan.borrower.loginId,
        borrowerStudentId: request.loan.borrower.studentId,
        occurredAt: now,
        dueAt: request.loan.dueAt
      });

      await tx.loan.delete({
        where: { id: request.loanId }
      });
    }

    return null;
  });

  if (borrowedLoan) {
    await notifyLoanBorrowed(borrowedLoan);
  }

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
  revalidatePath("/admin/logs");
}

export async function rejectLoanRequestAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`reject-loan-request:${user.id}`, 30, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 대여/반납 요청을 거절할 수 있습니다.");
  }

  const result = await prisma.loanRequest.updateMany({
    where: {
      id: value(formData, "requestId"),
      status: "PENDING"
    },
    data: {
      status: "REJECTED",
      reviewerId: user.id,
      reviewedAt: new Date()
    }
  });

  if (result.count === 0) {
    throw new Error("거절 가능한 요청이 아닙니다.");
  }

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
}

export async function deleteLoanAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`delete-loan:${user.id}`, 20, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 대여 기록을 삭제할 수 있습니다.");
  }

  const loanId = value(formData, "loanId");
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    select: { id: true, gameId: true, status: true }
  });

  if (!loan) {
    throw new Error("삭제할 대여 기록을 찾을 수 없습니다.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.loan.delete({ where: { id: loan.id } });

    if (loan.status === "ACTIVE") {
      await tx.game.update({
        where: { id: loan.gameId },
        data: { status: "AVAILABLE" }
      });
    }
  });

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
  redirect("/admin/loans?notice=loan-deleted");
}

export async function pruneActivityLogsAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`prune-activity-logs:${user.id}`, 4, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 로그를 정리할 수 있습니다.");
  }

  const days = z.coerce.number().int().min(30).max(3650).parse(formData.get("days") ?? 365);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.loanActivityLog.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
    prisma.meetupActivityLog.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
    prisma.generalActivityLog.deleteMany({ where: { occurredAt: { lt: cutoff } } })
  ]);

  revalidatePath("/admin");
  revalidatePath("/admin/logs");
  redirect(`/admin/logs?notice=logs-pruned&days=${days}`);
}

export async function saveAnnouncementAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`save-announcement:${user.id}`, 12, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 공지를 수정할 수 있습니다." };
    }

    const publishedAtValue = value(formData, "publishedAt");
    const parsed = z
      .object({
        id: z.string().optional(),
        title: z.string().trim().min(1, "공지 제목을 입력해주세요.").max(80, "공지 제목은 80자 이하여야 합니다."),
        body: z.string().trim().min(1, "공지 내용을 입력해주세요.").max(2000, "공지 내용은 2000자 이하여야 합니다."),
        isActive: z.boolean(),
        publishedAt: z.date()
      })
      .parse({
        id: value(formData, "id") || undefined,
        title: value(formData, "title"),
        body: value(formData, "body"),
        isActive: formData.get("isActive") === "on",
        publishedAt: publishedAtValue ? parseKoreaDateTimeLocal(publishedAtValue) : new Date()
      });

    if (Number.isNaN(parsed.publishedAt.getTime())) {
      return { message: "게시일 형식이 올바르지 않습니다." };
    }

    const announcement = parsed.id
      ? await prisma.announcement.update({
        where: { id: parsed.id },
        data: {
          title: parsed.title,
          body: parsed.body,
          isActive: parsed.isActive,
          publishedAt: parsed.publishedAt
        }
      })
      : await prisma.announcement.create({
        data: {
          title: parsed.title,
          body: parsed.body,
          isActive: parsed.isActive,
          publishedAt: parsed.publishedAt
        }
      });

    await createGeneralActivityLog(prisma, {
      category: "ANNOUNCEMENT",
      action: parsed.id ? "UPDATE" : "CREATE",
      actor: user,
      target: { type: "ANNOUNCEMENT", id: announcement.id, name: announcement.title },
      message: `${user.name} 관리자가 공지사항을 ${parsed.id ? "수정" : "등록"}했습니다.`,
      metadata: {
        isActive: announcement.isActive,
        publishedAt: announcement.publishedAt.toISOString()
      }
    });

    revalidatePath("/");
    revalidatePath("/account");
    revalidatePath("/admin/logs");
    revalidatePath("/admin/announcements");
    return { ok: true, message: parsed.id ? "공지사항을 수정했습니다." : "공지사항을 등록했습니다." };
  } catch (error) {
    return { message: actionError(error, "공지사항 저장에 실패했습니다.") };
  }
}

export async function deleteAnnouncementAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`delete-announcement:${user.id}`, 12, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 공지를 삭제할 수 있습니다.");
  }

  const announcement = await prisma.announcement.delete({
    where: { id: value(formData, "id") }
  });
  await createGeneralActivityLog(prisma, {
    category: "ANNOUNCEMENT",
    action: "DELETE",
    actor: user,
    target: { type: "ANNOUNCEMENT", id: announcement.id, name: announcement.title },
    message: `${user.name} 관리자가 공지사항을 삭제했습니다.`,
    metadata: {
      isActive: announcement.isActive,
      publishedAt: announcement.publishedAt.toISOString()
    }
  });

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin/logs");
  revalidatePath("/admin/announcements");
  redirect("/admin/announcements?notice=announcement-deleted");
}

export async function updateGameAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`update-game:${user.id}`, 30, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 게임을 수정할 수 있습니다." };
    }

    const parsed = z
      .object({
        id: z.string().min(1),
        title: z.string().trim().min(1).max(60),
        players: z.string().trim().max(40).optional(),
        bestPlayers: z.string().trim().max(40).optional(),
        playTime: z.string().trim().max(40).optional(),
        quantity: z.coerce.number().int().min(0).max(999).optional().nullable(),
        note: z.string().trim().max(300).optional(),
        genre: z.string().trim().max(80).optional(),
        isPresent: z.enum(["", "true", "false"]).optional(),
        weight: z.string().trim().max(40).optional(),
        infoUrl: z.string().trim().max(500).optional()
      })
      .parse({
        id: value(formData, "id"),
        title: value(formData, "title"),
        players: value(formData, "players") || undefined,
        bestPlayers: value(formData, "bestPlayers") || undefined,
        playTime: value(formData, "playTime") || undefined,
        quantity: value(formData, "quantity") === "" ? null : formData.get("quantity"),
        note: value(formData, "note") || undefined,
        genre: value(formData, "genre") || undefined,
        isPresent: value(formData, "isPresent") as "" | "true" | "false",
        weight: value(formData, "weight") || undefined,
        infoUrl: value(formData, "infoUrl") || undefined
      });

    const game = await prisma.game.update({
      where: { id: parsed.id },
      data: {
        title: parsed.title,
        players: parsed.players ?? null,
        bestPlayers: parsed.bestPlayers ?? null,
        playTime: parsed.playTime ?? null,
        quantity: parsed.quantity ?? null,
        note: parsed.note ?? null,
        genre: parsed.genre ?? null,
        isPresent: parsed.isPresent === "" || parsed.isPresent === undefined ? null : parsed.isPresent === "true",
        weight: parsed.weight ?? null,
        infoUrl: parsed.infoUrl ?? null
      }
    });
    await createGeneralActivityLog(prisma, {
      category: "GAME",
      action: "UPDATE",
      actor: user,
      target: { type: "GAME", id: game.id, name: game.title },
      message: `${user.name} 관리자가 ${game.title} 보드게임 정보를 수정했습니다.`,
      metadata: {
        quantity: game.quantity,
        genre: game.genre,
        isPresent: game.isPresent,
        weight: game.weight
      }
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/logs");
    return { ok: true, message: "게임 정보를 수정했습니다." };
  } catch (error) {
    return { message: actionError(error, "게임 수정에 실패했습니다.") };
  }
}

export async function updateGameFormAction(formData: FormData) {
  const result = await updateGameAction({}, formData);

  if (!result.ok) {
    throw new Error(result.message ?? "게임 수정에 실패했습니다.");
  }
}

export async function updateUserAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`update-user:${user.id}`, 30, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 회원 정보를 수정할 수 있습니다." };
    }

    const parsed = z
      .object({
        id: z.string().min(1),
        name: z.string().trim().min(2).max(20),
        studentId: z.string().trim().max(30).optional(),
        role: z.enum(["MEMBER", "ADMIN"])
      })
      .parse({
        id: value(formData, "id"),
        name: value(formData, "name"),
        studentId: value(formData, "studentId") || undefined,
        role: value(formData, "role")
      });

    if (parsed.id === user.id && parsed.role !== "ADMIN") {
      return { message: "본인의 관리자 권한은 해제할 수 없습니다." };
    }

    const targetUser = await prisma.user.update({
      where: { id: parsed.id },
      data: {
        name: parsed.name,
        studentId: parsed.studentId ?? null,
        role: parsed.role
      }
    });
    await createGeneralActivityLog(prisma, {
      category: "USER",
      action: "UPDATE",
      actor: user,
      target: { type: "USER", id: targetUser.id, name: targetUser.name },
      message: `${user.name} 관리자가 ${targetUser.name} 회원 정보를 수정했습니다.`,
      metadata: {
        loginId: targetUser.loginId,
        studentId: targetUser.studentId,
        role: targetUser.role
      }
    });

    revalidatePath("/admin");
    revalidatePath("/admin/logs");
    revalidatePath("/admin/users");
    return { ok: true, message: "회원 정보를 수정했습니다." };
  } catch (error) {
    return { message: actionError(error, "회원 정보 수정에 실패했습니다.") };
  }
}

export async function updateUserFormAction(formData: FormData) {
  const result = await updateUserAction({}, formData);

  if (!result.ok) {
    throw new Error(result.message ?? "회원 정보 수정에 실패했습니다.");
  }
}

export async function resetUserPasswordAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`reset-user-password:${user.id}`, 20, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 비밀번호를 초기화할 수 있습니다.");
  }

  const targetUserId = value(formData, "id");

  const targetUser = await prisma.user.update({
    where: { id: targetUserId },
    data: {
      passwordHash: await bcrypt.hash("1981", 12),
      mustChangePassword: true
    }
  });

  await prisma.session.deleteMany({ where: { userId: targetUserId } });
  await createGeneralActivityLog(prisma, {
    category: "ACCOUNT",
    action: "RESET_PASSWORD",
    actor: user,
    target: { type: "USER", id: targetUser.id, name: targetUser.name },
    message: `${user.name} 관리자가 ${targetUser.name} 회원의 비밀번호를 초기화했습니다.`,
    metadata: {
      loginId: targetUser.loginId,
      studentId: targetUser.studentId
    }
  });
  revalidatePath("/admin");
  revalidatePath("/admin/logs");
  revalidatePath("/admin/users");
  redirect("/admin/users?notice=password-reset");
}

export async function deleteUserAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`delete-user:${user.id}`, 10, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 사용자를 삭제할 수 있습니다.");
  }

  const targetUserId = value(formData, "id");
  const confirm = value(formData, "confirm");

  if (targetUserId === user.id) {
    throw new Error("본인 계정은 삭제할 수 없습니다.");
  }

  if (confirm !== "DELETE") {
    throw new Error("삭제 확인 문구가 올바르지 않습니다.");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, loginId: true, studentId: true, role: true }
  });

  if (!targetUser) {
    throw new Error("삭제할 회원을 찾을 수 없습니다.");
  }

  await prisma.user.delete({ where: { id: targetUserId } });
  await createGeneralActivityLog(prisma, {
    category: "USER",
    action: "DELETE",
    actor: user,
    target: { type: "USER", id: targetUser.id, name: targetUser.name },
    message: `${user.name} 관리자가 ${targetUser.name} 회원 계정을 삭제했습니다.`,
    metadata: {
      loginId: targetUser.loginId,
      studentId: targetUser.studentId,
      role: targetUser.role
    }
  });
  revalidatePath("/admin");
  revalidatePath("/admin/logs");
  revalidatePath("/admin/users");
  redirect("/admin/users?notice=user-deleted");
}

export async function importGamesAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`import-games:${user.id}`, 4, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 게임 DB를 업로드할 수 있습니다." };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { message: "업로드할 엑셀 파일을 선택해주세요." };
    }

    const rows = await parseGameWorkbook(Buffer.from(await file.arrayBuffer()));
    if (rows.length === 0) {
      return { message: "가져올 게임 데이터가 없습니다." };
    }

    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let keptCount = 0;

    await prisma.$transaction(async (tx) => {
      const existingGames = await tx.game.findMany({
        include: {
          _count: {
            select: {
              loans: true,
              loanRequests: true,
              meetups: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      });
      const gamesByTitle = new Map<string, typeof existingGames>();

      for (const game of existingGames) {
        const key = game.title.trim().toLowerCase();
        gamesByTitle.set(key, [...(gamesByTitle.get(key) ?? []), game]);
      }

      const matchedGameIds = new Set<string>();

      for (const row of rows) {
        const key = row.title.trim().toLowerCase();
        const candidates = gamesByTitle.get(key) ?? [];
        const existingGame = candidates.find((game) => !matchedGameIds.has(game.id));
        const data = {
          title: row.title,
          players: row.players,
          bestPlayers: row.bestPlayers,
          playTime: row.playTime,
          quantity: row.quantity,
          note: row.note,
          genre: row.genre,
          isPresent: row.isPresent,
          weight: row.weight,
          infoUrl: row.infoUrl
        };

        if (existingGame) {
          await tx.game.update({
            where: { id: existingGame.id },
            data
          });
          matchedGameIds.add(existingGame.id);
          updatedCount += 1;
          continue;
        }

        const createdGame = await tx.game.create({ data });
        matchedGameIds.add(createdGame.id);
        createdCount += 1;
      }

      const obsoleteGames = existingGames.filter((game) => !matchedGameIds.has(game.id));

      for (const game of obsoleteGames) {
        const hasRelatedData = game._count.loans > 0 || game._count.loanRequests > 0 || game._count.meetups > 0;

        if (hasRelatedData) {
          keptCount += 1;
          continue;
        }

        await tx.game.delete({
          where: { id: game.id }
        });
        deletedCount += 1;
      }

      await tx.meetup.updateMany({
        where: {
          gameId: {
            notIn: Array.from(matchedGameIds)
          }
        },
        data: { gameId: null }
      });

      await createGeneralActivityLog(tx, {
        category: "GAME",
        action: "IMPORT",
        actor: user,
        target: { type: "GAME", name: "보드게임 DB" },
        message: `${user.name} 관리자가 보드게임 DB를 엑셀로 반영했습니다.`,
        metadata: {
          rowCount: rows.length,
          createdCount,
          updatedCount,
          deletedCount,
          keptCount
        }
      });
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/games");
    revalidatePath("/admin/logs");
    return {
      ok: true,
      message: `${rows.length}개 행을 반영했습니다. 수정 ${updatedCount}개, 추가 ${createdCount}개, 삭제 ${deletedCount}개${
        keptCount > 0 ? `, 대여/기록 보존 ${keptCount}개` : ""
      }.`
    };
  } catch (error) {
    return { message: actionError(error, "게임 DB 업로드에 실패했습니다.") };
  }
}

export async function createMeetupAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let redirectTo: string | null = null;

  try {
    const user = await requireUser();
    assertRateLimit(`meetup:${user.id}`, 8, 60_000);

    const parsed = z
      .object({
        kind: z.enum(["GENERAL", "BRIDGE"]).default("GENERAL"),
        title: z.string().trim().min(1).max(80),
        description: z.string().trim().max(300).optional(),
        startsAt: z.coerce.date(),
        maxPeople: z.coerce.number().int().min(2).max(30),
        gameId: z.string().optional(),
        tableId: z.string().min(1, "테이블을 선택해주세요.")
      })
      .parse({
        kind: value(formData, "kind") === "BRIDGE" ? "BRIDGE" : "GENERAL",
        title: value(formData, "title"),
        description: value(formData, "description") || undefined,
        startsAt: parseKoreaDateTimeLocal(value(formData, "startsAt")),
        maxPeople: formData.get("maxPeople"),
        gameId: value(formData, "gameId") || undefined,
        tableId: value(formData, "tableId")
      });
    const meetupData = {
      ...parsed,
      maxPeople: parsed.kind === "BRIDGE" ? 4 : parsed.maxPeople,
      gameId: parsed.kind === "BRIDGE" ? undefined : parsed.gameId
    };

    if (meetupData.kind !== "BRIDGE" && meetupData.startsAt < new Date()) {
      return { message: "미래 시간으로 약속을 잡아주세요." };
    }

    if (meetupData.gameId) {
      const [game, conflictingMeetup] = await Promise.all([
        prisma.game.findUnique({
          where: { id: meetupData.gameId },
          select: { status: true }
        }),
        prisma.meetup.findFirst({
          where: {
            gameId: meetupData.gameId,
            startsAt: { gte: new Date() }
          },
          select: { id: true }
        })
      ]);

      if (!game || game.status !== "AVAILABLE") {
        return { message: "대여 중인 게임은 약속에 선택할 수 없습니다." };
      }

      if (conflictingMeetup) {
        return { message: "이미 예정된 약속이 있는 게임은 선택할 수 없습니다." };
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const meetup = await tx.meetup.create({
        data: {
          ...meetupData,
          hostId: user.id
        }
      });

      await tx.meetupParticipant.create({
        data: {
          meetupId: meetup.id,
          userId: user.id
        }
      });

      let bridgeRoomId: string | null = null;

      if (meetup.kind === "BRIDGE") {
        const hostPosition = randomBridgeSeatPosition([]);
        const room = await tx.bridgeRoom.create({
          data: {
            meetupId: meetup.id,
            hostId: user.id,
            seats: {
              create: {
                userId: user.id,
                position: hostPosition ?? "NORTH"
              }
            }
          }
        });

        bridgeRoomId = room.id;

        await createBridgeEvent(tx, {
          roomId: room.id,
          type: "ROOM_CREATED",
          actorId: user.id,
          payload: {
            meetupId: meetup.id,
            seats: [{ position: hostPosition ?? "NORTH", userId: user.id }]
          }
        });

        await createGeneralActivityLog(tx, {
          category: "BRIDGE",
          action: "ROOM_CREATE",
          actor: user,
          target: { type: "BRIDGE_ROOM", id: room.id, name: meetup.title },
          message: `${user.name} 사용자가 브릿지 테이블을 열었습니다.`,
          metadata: {
            meetupId: meetup.id,
            participants: [
              {
                position: hostPosition ?? "NORTH",
                userId: user.id,
                name: user.name,
                loginId: user.loginId
              }
            ]
          }
        });
      }

      const meetupForLog = await findMeetupForLog(tx, meetup.id);

      if (!meetupForLog) {
        throw new Error("약속 로그를 생성할 수 없습니다.");
      }

      await createMeetupActivityLog(tx, "SCHEDULED", meetupForLog, new Date());

      return {
        meetupId: meetup.id,
        bridgeRoomId
      };
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/logs");
    redirectTo = created.bridgeRoomId ? `/bridge/${created.bridgeRoomId}` : `/meetups/${created.meetupId}/manage`;
  } catch (error) {
    return { message: actionError(error, "약속 생성에 실패했습니다.") };
  }

  redirect(redirectTo);
}

export async function createBridgeRoomAction(formData: FormData) {
  const meetupId = value(formData, "meetupId");
  const { user } = await requireMeetupManager(meetupId);
  assertRateLimit(`bridge-room:${user.id}`, 10, 60_000);

  const roomId = await prisma.$transaction(async (tx) => {
    const meetup = await tx.meetup.findUnique({
      where: { id: meetupId },
      include: {
        bridgeRoom: { select: { id: true } },
        participants: {
          include: { user: { select: { id: true, name: true, loginId: true } } },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!meetup) {
      throw new Error("약속을 찾을 수 없습니다.");
    }

    if (meetup.kind !== "BRIDGE") {
      throw new Error("브릿지 약속에서만 테이블을 열 수 있습니다.");
    }

    if (meetup.bridgeRoom) {
      return meetup.bridgeRoom.id;
    }

    const seatedParticipants = meetup.participants.slice(0, BRIDGE_SEAT_POSITIONS.length);
    const positions = shuffledBridgeSeatPositions(seatedParticipants.length);
    const room = await tx.bridgeRoom.create({
      data: {
        meetupId,
        hostId: user.id,
        seats: {
          create: seatedParticipants.map((participant, index) => ({
            userId: participant.userId,
            position: positions[index]
          }))
        }
      }
    });

    await createBridgeEvent(tx, {
      roomId: room.id,
      type: "ROOM_CREATED",
      actorId: user.id,
      payload: {
        meetupId,
        seats: seatedParticipants.map((participant, index) => ({
          position: positions[index],
          userId: participant.userId
        }))
      }
    });

    await createGeneralActivityLog(tx, {
      category: "BRIDGE",
      action: "ROOM_CREATE",
      actor: user,
      target: { type: "BRIDGE_ROOM", id: room.id, name: meetup.title },
      message: `${user.name} 사용자가 브릿지 테이블을 열었습니다.`,
      metadata: {
        meetupId,
        participants: seatedParticipants.map((participant, index) => ({
          position: positions[index],
          userId: participant.user.id,
          name: participant.user.name,
          loginId: participant.user.loginId
        }))
      }
    });

    return room.id;
  });

  revalidatePath("/");
  revalidatePath(`/meetups/${meetupId}/manage`);
  revalidatePath("/admin");
  revalidatePath("/admin/logs");
  redirect(`/bridge/${roomId}`);
}

export async function randomizeBridgeSeatsAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`bridge-seat-randomize:${user.id}`, 20, 60_000);

  const roomId = value(formData, "roomId");

  await prisma.$transaction(async (tx) => {
    const room = await tx.bridgeRoom.findUnique({
      where: { id: roomId },
      include: {
        deals: { select: { id: true }, take: 1 },
        seats: {
          include: { user: { select: { id: true, name: true, loginId: true } } },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!room) {
      throw new Error("브릿지 방을 찾을 수 없습니다.");
    }

    if (room.hostId !== user.id && user.role !== "ADMIN") {
      throw new Error("방장 또는 관리자만 자리를 섞을 수 있습니다.");
    }

    if (room.status !== "LOBBY" || room.deals.length > 0) {
      throw new Error("딜이 시작되기 전 로비에서만 자리를 섞을 수 있습니다.");
    }

    if (room.seats.length === 0) {
      throw new Error("섞을 좌석이 없습니다.");
    }

    const positions = shuffledBridgeSeatPositions(room.seats.length);

    await tx.bridgeSeat.deleteMany({ where: { roomId } });
    await tx.bridgeSeat.createMany({
      data: room.seats.map((seat, index) => ({
        roomId,
        userId: seat.userId,
        position: positions[index]
      }))
    });

    await createBridgeEvent(tx, {
      roomId,
      type: "SEATS_RANDOMIZED",
      actorId: user.id,
      payload: {
        seats: room.seats.map((seat, index) => ({
          position: positions[index],
          userId: seat.userId
        }))
      }
    });

    await createGeneralActivityLog(tx, {
      category: "BRIDGE",
      action: "SEATS_RANDOMIZE",
      actor: user,
      target: { type: "BRIDGE_ROOM", id: roomId },
      message: `${user.name} 사용자가 브릿지 좌석을 섞었습니다.`,
      metadata: {
        participants: room.seats.map((seat, index) => ({
          position: positions[index],
          userId: seat.user.id,
          name: seat.user.name,
          loginId: seat.user.loginId
        }))
      }
    });
  });

  revalidatePath(`/bridge/${roomId}`);
  revalidatePath("/admin/logs");
}

export async function changeBridgeSeatAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  assertRateLimit(`bridge-seat-change:${user.id}`, 30, 60_000);

  try {
    const roomId = value(formData, "roomId");
    const targetUserId = value(formData, "userId");
    const targetPosition = value(formData, "position") as BridgeSeatPositionValue;

    if (!targetUserId) {
      throw new Error("좌석을 변경할 사용자를 선택해주세요.");
    }

    if (!BRIDGE_SEAT_POSITIONS.includes(targetPosition)) {
      throw new Error("이동할 좌석을 선택해주세요.");
    }

    await prisma.$transaction(async (tx) => {
      const room = await tx.bridgeRoom.findUnique({
        where: { id: roomId },
        include: {
          deals: { select: { id: true }, take: 1 },
          seats: {
            include: { user: { select: { id: true, name: true, loginId: true } } },
            orderBy: { createdAt: "asc" }
          }
        }
      });

      if (!room) {
        throw new Error("브릿지 방을 찾을 수 없습니다.");
      }

      if (room.hostId !== user.id && user.role !== "ADMIN") {
        throw new Error("방장 또는 관리자만 자리를 변경할 수 있습니다.");
      }

      if (room.status !== "LOBBY" || room.deals.length > 0) {
        throw new Error("딜이 시작되기 전 로비에서만 자리를 변경할 수 있습니다.");
      }

      const movingSeat = room.seats.find((seat) => seat.userId === targetUserId);

      if (!movingSeat) {
        throw new Error("좌석에 앉은 참여자만 이동할 수 있습니다.");
      }

      if (movingSeat.position === targetPosition) {
        throw new Error("이미 선택한 좌석에 앉아 있습니다.");
      }

      const targetSeat = room.seats.find((seat) => seat.position === targetPosition);
      const nextSeats = room.seats.map((seat) => {
        if (seat.userId === movingSeat.userId) {
          return { ...seat, position: targetPosition };
        }

        if (targetSeat && seat.userId === targetSeat.userId) {
          return { ...seat, position: movingSeat.position };
        }

        return seat;
      });

      await tx.bridgeSeat.deleteMany({ where: { roomId } });
      await tx.bridgeSeat.createMany({
        data: nextSeats.map((seat) => ({
          roomId,
          userId: seat.userId,
          position: seat.position
        }))
      });

      await createBridgeEvent(tx, {
        roomId,
        type: "SEATS_CHANGED",
        actorId: user.id,
        payload: {
          movedUserId: movingSeat.userId,
          from: movingSeat.position,
          to: targetPosition,
          swappedUserId: targetSeat?.userId ?? null,
          seats: nextSeats.map((seat) => ({
            position: seat.position,
            userId: seat.userId
          }))
        }
      });

      await createGeneralActivityLog(tx, {
        category: "BRIDGE",
        action: "SEAT_CHANGE",
        actor: user,
        target: { type: "BRIDGE_ROOM", id: roomId },
        message: `${user.name} 사용자가 브릿지 좌석을 변경했습니다.`,
        metadata: {
          movedUser: {
            userId: movingSeat.user.id,
            name: movingSeat.user.name,
            loginId: movingSeat.user.loginId
          },
          from: movingSeat.position,
          to: targetPosition,
          swappedUser: targetSeat
            ? {
                userId: targetSeat.user.id,
                name: targetSeat.user.name,
                loginId: targetSeat.user.loginId
              }
            : null,
          participants: nextSeats.map((seat) => ({
            position: seat.position,
            userId: seat.user.id,
            name: seat.user.name,
            loginId: seat.user.loginId
          }))
        }
      });
    });

    revalidatePath(`/bridge/${roomId}`);
    revalidatePath("/admin/logs");
    return { ok: true };
  } catch (error) {
    return { message: actionError(error, "좌석 변경에 실패했습니다.") };
  }
}

export async function createBridgeDealAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`bridge-deal:${user.id}`, 10, 60_000);

  const roomId = value(formData, "roomId");

  await prisma.$transaction(async (tx) => {
    const room = await tx.bridgeRoom.findUnique({
      where: { id: roomId },
      include: {
        deals: {
          select: { id: true, boardNumber: true, completedAt: true },
          orderBy: { boardNumber: "desc" }
        },
        seats: {
          include: { user: { select: { id: true, name: true, loginId: true } } },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!room) {
      throw new Error("브릿지 방을 찾을 수 없습니다.");
    }

    if (room.hostId !== user.id && user.role !== "ADMIN") {
      throw new Error("방장 또는 관리자만 딜을 생성할 수 있습니다.");
    }

    if (room.status !== "LOBBY" && room.status !== "PLAYING") {
      throw new Error("진행 가능한 브릿지 방에서만 딜을 생성할 수 있습니다.");
    }

    const activeDeal = room.deals.find((deal) => !deal.completedAt);

    if (activeDeal) {
      throw new Error("진행 중인 딜이 있습니다.");
    }

    if (room.seats.length !== 4) {
      throw new Error("좌석 4명이 모두 배정되어야 딜을 생성할 수 있습니다.");
    }

    const boardNumber = (room.deals[0]?.boardNumber ?? 0) + 1;
    const dealer = bridgeDealerForBoard(boardNumber);
    const vulnerability = bridgeVulnerabilityForBoard(boardNumber);
    const positions = boardNumber === 1 ? shuffledBridgeSeatPositions(room.seats.length) : room.seats.map((seat) => seat.position);

    if (boardNumber === 1) {
      await tx.bridgeSeat.deleteMany({ where: { roomId } });
      await tx.bridgeSeat.createMany({
        data: room.seats.map((seat, index) => ({
          roomId,
          userId: seat.userId,
          position: positions[index]
        }))
      });
    }

    const deck = createShuffledBridgeDeck();
    const hands = Object.fromEntries(
      BRIDGE_SEAT_POSITIONS.map((position, index) => [position, deck.slice(index * 13, (index + 1) * 13)])
    );

    await tx.bridgeDeal.create({
      data: {
        roomId,
        boardNumber,
        dealer,
        biddingTurn: dealer,
        vulnerability,
        hands
      }
    });

    await tx.bridgeRoom.update({
      where: { id: roomId },
      data: { status: "PLAYING" }
    });

    await createBridgeEvent(tx, {
      roomId,
      type: "DEAL_CREATED",
      actorId: user.id,
      payload: {
        boardNumber,
        dealer,
        vulnerability,
        seats: room.seats.map((seat, index) => ({
          position: positions[index],
          userId: seat.userId
        }))
      }
    });

    await createGeneralActivityLog(tx, {
      category: "BRIDGE",
      action: "DEAL_CREATE",
      actor: user,
      target: { type: "BRIDGE_ROOM", id: roomId },
      message: `${user.name} 사용자가 브릿지 딜을 생성했습니다.`,
      metadata: {
        boardNumber,
        dealer,
        vulnerability,
        participants: room.seats.map((seat, index) => ({
          position: positions[index],
          userId: seat.user.id,
          name: seat.user.name,
          loginId: seat.user.loginId
        }))
      }
    });
  });

  revalidatePath(`/bridge/${roomId}`);
  revalidatePath("/admin/logs");
}

export async function makeBridgeCallAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  assertRateLimit(`bridge-call:${user.id}`, 40, 60_000);

  try {
    const roomId = value(formData, "roomId");
    const callType = value(formData, "callType") as BridgeCallTypeValue;
    const level = Number(value(formData, "level"));
    const suit = value(formData, "suit") as BridgeContractSuitValue;

    if (!BRIDGE_CALL_TYPES.includes(callType)) {
      throw new Error("올바르지 않은 콜입니다.");
    }

    await prisma.$transaction(async (tx) => {
      const room = await tx.bridgeRoom.findUnique({
        where: { id: roomId },
        include: {
          deals: {
            where: { completedAt: null },
            take: 1,
            include: {
              calls: { orderBy: { sequence: "asc" } }
            }
          },
          seats: true
        }
      });

      const deal = room?.deals[0];

      if (!room || !deal) {
        throw new Error("딜이 생성된 뒤 비딩할 수 있습니다.");
      }

      if (room.status !== "PLAYING") {
        throw new Error("진행 중인 방에서만 비딩할 수 있습니다.");
      }

      if (deal.contractLevel || deal.completedAt || !deal.biddingTurn) {
        throw new Error("이미 비딩이 끝났습니다.");
      }

      const mySeat = room.seats.find((seat) => seat.userId === user.id)?.position;

      if (!mySeat) {
        throw new Error("좌석에 앉은 사용자만 비딩할 수 있습니다.");
      }

      if (mySeat !== deal.biddingTurn) {
        throw new Error("현재 비딩 차례가 아닙니다.");
      }

      const calls = deal.calls;
      const lastBid = [...calls].reverse().find((call) => call.type === "BID");
      const lastBidTeam = lastBid ? bridgeTeam(lastBid.position) : null;
      const myTeam = bridgeTeam(mySeat);
      const nextSequence = calls.length + 1;
      let nextDoubleStatus = deal.doubleStatus as BridgeDoubleStatusValue;
      let callLevel: number | null = null;
      let callSuit: BridgeContractSuitValue | null = null;

      if (callType === "BID") {
        if (!Number.isInteger(level) || level < 1 || level > 7) {
          throw new Error("입찰 레벨은 1부터 7까지 선택해주세요.");
        }

        if (!BRIDGE_CONTRACT_SUITS.includes(suit)) {
          throw new Error("입찰 무늬를 선택해주세요.");
        }

        if (lastBid?.level && lastBid.suit && bridgeContractOrder(level, suit) <= bridgeContractOrder(lastBid.level, lastBid.suit)) {
          throw new Error("이전 입찰보다 높은 계약만 부를 수 있습니다.");
        }

        callLevel = level;
        callSuit = suit;
        nextDoubleStatus = "UNDOUBLED";
      }

      if (callType === "DOUBLE") {
        if (!lastBid || !lastBidTeam || lastBidTeam === myTeam) {
          throw new Error("상대 팀의 마지막 입찰에만 더블할 수 있습니다.");
        }

        if (deal.doubleStatus !== "UNDOUBLED") {
          throw new Error("이미 더블 또는 리더블된 계약입니다.");
        }

        nextDoubleStatus = "DOUBLED";
      }

      if (callType === "REDOUBLE") {
        if (!lastBid || !lastBidTeam || lastBidTeam !== myTeam || deal.doubleStatus !== "DOUBLED") {
          throw new Error("상대가 더블한 우리 팀 계약에만 리더블할 수 있습니다.");
        }

        nextDoubleStatus = "REDOUBLED";
      }

      await tx.bridgeCall.create({
        data: {
          roomId,
          dealId: deal.id,
          position: mySeat,
          type: callType,
          level: callLevel,
          suit: callSuit,
          sequence: nextSequence
        }
      });

      const updatedCalls = [
        ...calls,
        {
          position: mySeat,
          type: callType,
          level: callLevel,
          suit: callSuit,
          sequence: nextSequence
        }
      ];
      const updatedLastBid = [...updatedCalls].reverse().find((call) => call.type === "BID");
      const trailingPasses = [...updatedCalls].reverse().findIndex((call) => call.type !== "PASS");
      const passCount = trailingPasses === -1 ? updatedCalls.length : trailingPasses;
      const allPassedOut = !updatedLastBid && updatedCalls.length >= 4;
      const auctionComplete = Boolean(updatedLastBid && passCount >= 3);

      if (allPassedOut) {
        await tx.bridgeDeal.update({
          where: { id: deal.id },
          data: {
            biddingTurn: null,
            completedAt: new Date(),
            score: 0
          }
        });
      } else if (auctionComplete && updatedLastBid?.level && updatedLastBid.suit) {
        const contractTeam = bridgeTeam(updatedLastBid.position);
        const declarerCall = updatedCalls.find(
          (call) => call.type === "BID" && call.suit === updatedLastBid.suit && bridgeTeam(call.position) === contractTeam
        );
        const declarer = declarerCall?.position;

        if (!declarer) {
          throw new Error("선언자를 결정할 수 없습니다.");
        }

        const dummy = bridgePartner(declarer);
        const openingLeader = nextBridgeTurn(declarer);

        await tx.bridgeDeal.update({
          where: { id: deal.id },
          data: {
            biddingTurn: null,
            contractLevel: updatedLastBid.level,
            contractSuit: updatedLastBid.suit,
            doubleStatus: nextDoubleStatus,
            declarer,
            dummy,
            currentTurn: openingLeader,
            playStartedAt: new Date()
          }
        });

        await createBridgeEvent(tx, {
          roomId,
          type: "CONTRACT_SET",
          actorId: user.id,
          payload: {
            contractLevel: updatedLastBid.level,
            contractSuit: updatedLastBid.suit,
            doubleStatus: nextDoubleStatus,
            declarer,
            dummy,
            currentTurn: openingLeader
          }
        });
      } else {
        await tx.bridgeDeal.update({
          where: { id: deal.id },
          data: {
            biddingTurn: nextBridgeTurn(mySeat),
            doubleStatus: nextDoubleStatus
          }
        });
      }

      await createBridgeEvent(tx, {
        roomId,
        type: "CALL_MADE",
        actorId: user.id,
        payload: {
          position: mySeat,
          type: callType,
          level: callLevel,
          suit: callSuit,
          sequence: nextSequence,
          nextTurn: allPassedOut || auctionComplete ? null : nextBridgeTurn(mySeat)
        }
      });

      if (allPassedOut) {
        await createBridgeEvent(tx, {
          roomId,
          type: "ROUND_COMPLETED",
          actorId: user.id,
          payload: {
            passedOut: true,
            score: 0
          }
        });
      }
    });

    revalidatePath(`/bridge/${roomId}`);
    return { ok: true };
  } catch (error) {
    return { message: actionError(error, "비딩에 실패했습니다.") };
  }
}

export async function setBridgeContractAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  assertRateLimit(`bridge-contract:${user.id}`, 20, 60_000);

  try {
    const roomId = value(formData, "roomId");
    const contractLevel = Number(value(formData, "contractLevel"));
    const contractSuit = value(formData, "contractSuit") as BridgeContractSuitValue;
    const declarer = value(formData, "declarer") as BridgeSeatPositionValue;

    if (!Number.isInteger(contractLevel) || contractLevel < 1 || contractLevel > 7) {
      throw new Error("컨트랙트 레벨은 1부터 7까지 선택해주세요.");
    }

    if (!BRIDGE_CONTRACT_SUITS.includes(contractSuit)) {
      throw new Error("컨트랙트 무늬를 선택해주세요.");
    }

    if (!BRIDGE_SEAT_POSITIONS.includes(declarer)) {
      throw new Error("선언자를 선택해주세요.");
    }

    await prisma.$transaction(async (tx) => {
      const room = await tx.bridgeRoom.findUnique({
        where: { id: roomId },
        include: {
          deals: {
            where: { completedAt: null },
            take: 1,
            select: { id: true, contractLevel: true }
          },
          seats: true
        }
      });

      const deal = room?.deals[0];

      if (!room || !deal) {
        throw new Error("딜이 생성된 방에서만 컨트랙트를 정할 수 있습니다.");
      }

      if (room.hostId !== user.id && user.role !== "ADMIN") {
        throw new Error("방장 또는 관리자만 컨트랙트를 정할 수 있습니다.");
      }

      if (room.status !== "PLAYING") {
        throw new Error("진행 중인 방에서만 컨트랙트를 정할 수 있습니다.");
      }

      if (deal.contractLevel) {
        throw new Error("이미 컨트랙트가 정해졌습니다.");
      }

      if (room.seats.length !== 4 || !room.seats.some((seat) => seat.position === declarer)) {
        throw new Error("좌석 4명이 모두 배정되어야 컨트랙트를 정할 수 있습니다.");
      }

      const dummy = bridgePartner(declarer);
      const openingLeader = nextBridgeTurn(declarer);

      await tx.bridgeDeal.update({
        where: { id: deal.id },
        data: {
          contractLevel,
          contractSuit,
          declarer,
          dummy,
          currentTurn: openingLeader,
          playStartedAt: new Date()
        }
      });

      await createBridgeEvent(tx, {
        roomId,
        type: "CONTRACT_SET",
        actorId: user.id,
        payload: {
          contractLevel,
          contractSuit,
          declarer,
          dummy,
          currentTurn: openingLeader
        }
      });
    });

    revalidatePath(`/bridge/${roomId}`);
    return { ok: true };
  } catch (error) {
    return { message: actionError(error, "컨트랙트 확정에 실패했습니다.") };
  }
}

export async function playBridgeCardAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  assertRateLimit(`bridge-play:${user.id}`, 60, 60_000);

  try {
    const roomId = value(formData, "roomId");
    const card = value(formData, "card");
    parseBridgeCard(card);

    await prisma.$transaction(async (tx) => {
      const room = await tx.bridgeRoom.findUnique({
        where: { id: roomId },
        include: {
          deals: {
            where: { completedAt: null },
            take: 1
          },
          seats: true
        }
      });

    const deal = room?.deals[0];

    if (!room || !deal) {
      throw new Error("딜이 생성된 방에서만 카드를 낼 수 있습니다.");
    }

    if (room.status !== "PLAYING") {
      throw new Error("진행 중인 방에서만 카드를 낼 수 있습니다.");
    }

    if (deal.completedAt) {
      throw new Error("이미 라운드가 끝났습니다.");
    }

    if (!deal.contractLevel || !deal.contractSuit || !deal.declarer || !deal.dummy || !deal.currentTurn) {
      throw new Error("컨트랙트가 정해진 뒤 카드를 낼 수 있습니다.");
    }

    const mySeat = room.seats.find((seat) => seat.userId === user.id)?.position;

    if (!mySeat) {
      throw new Error("좌석에 앉은 사용자만 카드를 낼 수 있습니다.");
    }

    const currentTurn = deal.currentTurn;
    const declarer = deal.declarer;
    const dummy = deal.dummy;
    const playedPosition = currentTurn;

    if (currentTurn === dummy) {
      if (mySeat !== declarer) {
        throw new Error("더미 차례에는 선언자만 카드를 낼 수 있습니다.");
      }
    } else if (mySeat !== currentTurn) {
      throw new Error("현재 차례가 아닙니다.");
    }

    const hands = readBridgeHands(deal.hands);
    const hand = hands[playedPosition];

    if (!hand.includes(card)) {
      throw new Error("해당 좌석의 손패에 없는 카드입니다.");
    }

    let trick = await tx.bridgeTrick.findFirst({
      where: {
        dealId: deal.id,
        completedAt: null
      },
      include: {
        plays: { orderBy: { createdAt: "asc" } }
      },
      orderBy: { trickNumber: "desc" }
    });

    if (!trick) {
      const trickCount = await tx.bridgeTrick.count({
        where: { dealId: deal.id }
      });

      if (trickCount >= 13) {
        throw new Error("이미 모든 트릭이 끝났습니다.");
      }

      trick = await tx.bridgeTrick.create({
        data: {
          roomId,
          dealId: deal.id,
          trickNumber: trickCount + 1,
          leader: currentTurn
        },
        include: {
          plays: { orderBy: { createdAt: "asc" } }
        }
      });
    }

    if (trick.plays.some((play) => play.position === playedPosition)) {
      throw new Error("이미 이 트릭에 카드를 냈습니다.");
    }

    if (trick.plays.length > 0) {
      const leadSuit = parseBridgeCard(trick.plays[0].card).suit;
      const cardSuit = parseBridgeCard(card).suit;
      const canFollowSuit = hand.some((handCard) => parseBridgeCard(handCard).suit === leadSuit);

      if (canFollowSuit && cardSuit !== leadSuit) {
        throw new Error("같은 무늬가 있으면 먼저 따라 내야 합니다.");
      }
    }

    await tx.bridgePlay.create({
      data: {
        roomId,
        dealId: deal.id,
        trickId: trick.id,
        position: playedPosition,
        card
      }
    });

    const updatedHand = hand.filter((handCard) => handCard !== card);
    const updatedHands = {
      ...hands,
      [playedPosition]: updatedHand
    };
    const plays = await tx.bridgePlay.findMany({
      where: { trickId: trick.id },
      orderBy: { createdAt: "asc" }
    });
    const trickCompleted = plays.length === 4;
    const winner = trickCompleted
      ? chooseBridgeTrickWinner(
          plays.map((play) => ({
            position: play.position,
            card: play.card,
            createdAt: play.createdAt
          })),
          deal.contractSuit
        )
      : null;
    const nextTurn = winner ?? nextBridgeTurn(playedPosition);
    const roundCompleted = trickCompleted && winner !== null && trick.trickNumber === 13;
    let roundResult:
      | {
          declarerTricks: number;
          defenderTricks: number;
          contractMade: boolean;
          overtricks: number;
          undertricks: number;
          score: number;
        }
      | null = null;

    if (roundCompleted && winner) {
      const previousCompletedTricks = await tx.bridgeTrick.findMany({
        where: {
          dealId: deal.id,
          completedAt: { not: null }
        },
        select: { winner: true }
      });
      const declarerTeam = bridgeTeam(deal.declarer);
      const completedWinners = [...previousCompletedTricks.map((completedTrick) => completedTrick.winner), winner];
      const declarerTricks = completedWinners.filter(
        (completedWinner): completedWinner is BridgeSeatPositionValue =>
          completedWinner !== null && bridgeTeam(completedWinner) === declarerTeam
      ).length;
      const defenderTricks = 13 - declarerTricks;
      const contractResult = calculateBridgeContractResult({
        contractLevel: deal.contractLevel,
        contractSuit: deal.contractSuit,
        declarerTricks,
        doubleStatus: deal.doubleStatus,
        vulnerable: bridgeVulnerabilityForTeam(declarerTeam, deal.vulnerability)
      });

      roundResult = {
        declarerTricks,
        defenderTricks,
        ...contractResult
      };
    }

    await tx.bridgeDeal.update({
      where: { id: deal.id },
      data: {
        hands: updatedHands,
        currentTurn: roundCompleted ? null : nextTurn,
        completedAt: roundCompleted ? new Date() : undefined,
        declarerTricks: roundResult?.declarerTricks,
        defenderTricks: roundResult?.defenderTricks,
        contractMade: roundResult?.contractMade,
        overtricks: roundResult?.overtricks,
        undertricks: roundResult?.undertricks,
        score: roundResult?.score
      }
    });

    if (trickCompleted && winner) {
      await tx.bridgeTrick.update({
        where: { id: trick.id },
        data: {
          winner,
          completedAt: new Date()
        }
      });
    }

    await createBridgeEvent(tx, {
      roomId,
      type: "CARD_PLAYED",
      actorId: user.id,
      payload: {
        trickNumber: trick.trickNumber,
        position: playedPosition,
        card,
        nextTurn
      }
    });

    if (trickCompleted && winner) {
      await createBridgeEvent(tx, {
        roomId,
        type: "TRICK_COMPLETED",
        actorId: user.id,
        payload: {
          trickNumber: trick.trickNumber,
          winner,
          nextTurn
        }
      });
    }

    if (roundCompleted && winner && roundResult) {
      await createBridgeEvent(tx, {
        roomId,
        type: "ROUND_COMPLETED",
        actorId: user.id,
        payload: {
          declarer: deal.declarer,
          declarerTeam: bridgeTeam(deal.declarer),
          doubleStatus: deal.doubleStatus,
          vulnerability: deal.vulnerability,
          declarerTricks: roundResult.declarerTricks,
          defenderTricks: roundResult.defenderTricks,
          contractMade: roundResult.contractMade,
          overtricks: roundResult.overtricks,
          undertricks: roundResult.undertricks,
          score: roundResult.score
        }
      });

      await createGeneralActivityLog(tx, {
        category: "BRIDGE",
        action: "ROUND_COMPLETE",
        actor: user,
        target: { type: "BRIDGE_ROOM", id: roomId },
        message: `${user.name} 사용자가 브릿지 라운드를 완료했습니다.`,
        metadata: {
          declarer: deal.declarer,
          declarerTeam: bridgeTeam(deal.declarer),
          contractLevel: deal.contractLevel,
          contractSuit: deal.contractSuit,
          doubleStatus: deal.doubleStatus,
          vulnerability: deal.vulnerability,
          declarerTricks: roundResult.declarerTricks,
          defenderTricks: roundResult.defenderTricks,
          contractMade: roundResult.contractMade,
          overtricks: roundResult.overtricks,
          undertricks: roundResult.undertricks,
          score: roundResult.score
        }
      });
    }
  });

    revalidatePath(`/bridge/${roomId}`);
    revalidatePath("/admin/logs");
    return { ok: true };
  } catch (error) {
    return { message: actionError(error, "카드를 낼 수 없습니다.") };
  }
}

async function requireMeetupManager(meetupId: string) {
  const user = await requireUser();
  const meetup = await prisma.meetup.findUnique({
    where: { id: meetupId },
    select: { id: true, hostId: true }
  });

  if (!meetup) {
    throw new Error("약속을 찾을 수 없습니다.");
  }

  if (meetup.hostId !== user.id && user.role !== "ADMIN") {
    throw new Error("개최자 또는 관리자만 약속을 관리할 수 있습니다.");
  }

  return { user, meetup };
}

export async function joinMeetupAndGetTarget(meetupId: string) {
  const user = await requireUser();
  assertRateLimit(`join:${user.id}`, 20, 60_000);

  let targetHref = `/meetups/${meetupId}/manage`;

  await prisma.$transaction(async (tx) => {
    const meetup = await tx.meetup.findUnique({
      where: { id: meetupId },
      include: {
        bridgeRoom: {
          include: {
            seats: true,
            deals: { select: { id: true }, take: 1 }
          }
        },
        participants: true
      }
    });

    if (!meetup) {
      throw new Error("약속을 찾을 수 없습니다.");
    }

    const alreadyJoined = meetup.participants.some((participant) => participant.userId === user.id);
    const canManageMeetup = meetup.hostId === user.id || user.role === "ADMIN";

    if (!alreadyJoined && !canManageMeetup && meetup.participants.length >= meetup.maxPeople) {
      throw new Error("정원이 찼습니다.");
    }

    if (!alreadyJoined && meetup.kind === "BRIDGE" && (meetup.bridgeRoom?.deals.length ?? 0) > 0) {
      throw new Error("이미 딜이 시작된 브릿지 약속에는 참여할 수 없습니다.");
    }

    if (!alreadyJoined && !canManageMeetup) {
      await tx.meetupParticipant.create({
        data: {
          meetupId,
          userId: user.id
        }
      });
    }

    if (meetup.kind === "BRIDGE" && meetup.bridgeRoom) {
      targetHref = `/bridge/${meetup.bridgeRoom.id}`;
      const alreadySeated = meetup.bridgeRoom.seats.some((seat) => seat.userId === user.id);
      const takenPositions = meetup.bridgeRoom.seats.map((seat) => seat.position);
      const position = randomBridgeSeatPosition(takenPositions);

      if (!alreadySeated && !canManageMeetup) {
        if (!position) {
          throw new Error("브릿지 좌석이 모두 찼습니다.");
        }

        await tx.bridgeSeat.create({
          data: {
            roomId: meetup.bridgeRoom.id,
            userId: user.id,
            position
          }
        });

        await createBridgeEvent(tx, {
          roomId: meetup.bridgeRoom.id,
          type: "SEAT_JOINED",
          actorId: user.id,
          payload: {
            position,
            userId: user.id
          }
        });
      }
    }
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(targetHref);

  return targetHref;
}

export async function cancelMeetupAction(formData: FormData) {
  const meetupId = value(formData, "meetupId");
  const returnTo = value(formData, "returnTo") || "/";
  const { user } = await requireMeetupManager(meetupId);
  assertRateLimit(`cancel-meetup:${user.id}`, 20, 60_000);

  await prisma.$transaction(async (tx) => {
    const meetupForLog = await findMeetupForLog(tx, meetupId);

    if (!meetupForLog) {
      throw new Error("약속을 찾을 수 없습니다.");
    }

    await createMeetupActivityLog(tx, "CANCELED", meetupForLog, new Date());
    await tx.meetup.delete({ where: { id: meetupId } });
  });
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/logs");
  redirect(returnTo);
}

export async function cancelMeetupWithAlertAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const meetupId = value(formData, "meetupId");
  const returnTo = value(formData, "returnTo") || "/";

  try {
    const { user } = await requireMeetupManager(meetupId);
    assertRateLimit(`cancel-meetup:${user.id}`, 20, 60_000);

    await prisma.$transaction(async (tx) => {
      const meetupForLog = await findMeetupForLog(tx, meetupId);

      if (!meetupForLog) {
        throw new Error("이미 취소되었거나 찾을 수 없는 방입니다.");
      }

      await createMeetupActivityLog(tx, "CANCELED", meetupForLog, new Date());
      await tx.meetup.delete({ where: { id: meetupId } });
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/logs");
    return { ok: true, message: "방을 취소했습니다.", redirectTo: returnTo };
  } catch (error) {
    return { message: actionError(error, "방을 취소할 수 없습니다."), redirectTo: returnTo };
  }
}

export async function completeMeetupAction(formData: FormData) {
  const meetupId = value(formData, "meetupId");
  const returnTo = value(formData, "returnTo") || "/";
  const { user } = await requireMeetupManager(meetupId);
  assertRateLimit(`complete-meetup:${user.id}`, 20, 60_000);
  let bridgeRoomId: string | null = null;

  await prisma.$transaction(async (tx) => {
    const meetupForLog = await findMeetupForLog(tx, meetupId);

    if (!meetupForLog) {
      throw new Error("약속을 찾을 수 없습니다.");
    }

    await createMeetupActivityLog(tx, "COMPLETED", meetupForLog, new Date());

    if (meetupForLog.kind === "BRIDGE") {
      const bridgeRoom = await tx.bridgeRoom.findUnique({
        where: { meetupId },
        include: {
          deals: {
            where: { completedAt: null },
            select: { id: true }
          }
        }
      });

      if (bridgeRoom?.deals.length) {
        throw new Error("진행 중인 딜이 끝난 뒤 세션을 종료할 수 있습니다.");
      }

      if (bridgeRoom) {
        bridgeRoomId = bridgeRoom.id;
        await tx.bridgeRoom.update({
          where: { id: bridgeRoom.id },
          data: { status: "COMPLETED" }
        });

        await createGeneralActivityLog(tx, {
          category: "BRIDGE",
          action: "SESSION_COMPLETE",
          actor: user,
          target: { type: "BRIDGE_ROOM", id: bridgeRoom.id, name: meetupForLog.title },
          message: `${user.name} 사용자가 브릿지 세션을 종료했습니다.`,
          metadata: { meetupId }
        });
      }
    } else {
      await tx.meetup.delete({ where: { id: meetupId } });
    }
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/meetups");
  revalidatePath("/admin/logs");
  if (bridgeRoomId) {
    revalidatePath(`/bridge/${bridgeRoomId}`);
    revalidatePath(`/meetups/${meetupId}/manage`);
  }
  redirect(returnTo);
}

async function leaveMeetupForUser(meetupId: string, targetUserId: string, actorId: string) {
  let bridgeRoomId: string | null = null;

  await prisma.$transaction(async (tx) => {
    const meetup = await tx.meetup.findUnique({
      where: { id: meetupId },
      include: {
        bridgeRoom: {
          include: {
            seats: true,
            deals: { select: { id: true }, take: 1 }
          }
        },
        participants: true
      }
    });

    if (!meetup) {
      throw new Error("약속을 찾을 수 없습니다.");
    }

    if (meetup?.kind === "BRIDGE" && (meetup.bridgeRoom?.deals.length ?? 0) > 0) {
      throw new Error("이미 딜이 시작된 브릿지 약속에서는 나갈 수 없습니다.");
    }

    bridgeRoomId = meetup?.bridgeRoom?.id ?? null;
    const leavingSeat = bridgeRoomId
      ? await tx.bridgeSeat.findFirst({
          where: {
            roomId: bridgeRoomId,
            userId: targetUserId
          },
          select: { position: true }
        })
      : null;

    await tx.meetupParticipant.deleteMany({
      where: {
        meetupId,
        userId: targetUserId
      }
    });

    if (bridgeRoomId) {
      await tx.bridgeSeat.deleteMany({
        where: {
          roomId: bridgeRoomId,
          userId: targetUserId
        }
      });

      if (leavingSeat || targetUserId !== actorId) {
        await createBridgeEvent(tx, {
          roomId: bridgeRoomId,
          type: "SEAT_LEFT",
          actorId,
          payload: {
            position: leavingSeat?.position ?? null,
            userId: targetUserId
          }
        });
      }
    }
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/meetups/${meetupId}/manage`);
  if (bridgeRoomId) {
    revalidatePath(`/bridge/${bridgeRoomId}`);
  }

  return bridgeRoomId;
}

export async function joinMeetupAction(formData: FormData) {
  const meetupId = value(formData, "meetupId");
  const targetHref = await joinMeetupAndGetTarget(meetupId);

  redirect(targetHref);
}

export async function leaveMeetupAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`leave:${user.id}`, 20, 60_000);

  const meetupId = value(formData, "meetupId");
  await leaveMeetupForUser(meetupId, user.id, user.id);
}

export async function leaveMeetupWithAlertAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  assertRateLimit(`leave:${user.id}`, 20, 60_000);

  const meetupId = value(formData, "meetupId");
  const returnTo = value(formData, "returnTo") || "/";

  try {
    await leaveMeetupForUser(meetupId, user.id, user.id);
    return { ok: true, message: "방에서 나갔습니다.", redirectTo: returnTo };
  } catch (error) {
    return { message: actionError(error, "방에서 나갈 수 없습니다.") };
  }
}

export async function removeMeetupParticipantAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  assertRateLimit(`remove-participant:${actor.id}`, 30, 60_000);

  const meetupId = value(formData, "meetupId");
  const userId = value(formData, "userId");

  try {
    if (!userId) {
      throw new Error("내보낼 참여자를 선택해주세요.");
    }

    const meetup = await prisma.meetup.findUnique({
      where: { id: meetupId },
      select: { hostId: true }
    });

    if (!meetup) {
      throw new Error("방을 찾을 수 없습니다.");
    }

    if (meetup.hostId !== actor.id && actor.role !== "ADMIN") {
      throw new Error("방장 또는 관리자만 참여자를 내보낼 수 있습니다.");
    }

    if (userId === meetup.hostId) {
      throw new Error("방장은 내보낼 수 없습니다.");
    }

    await leaveMeetupForUser(meetupId, userId, actor.id);
    return { ok: true, message: "참여자를 방에서 내보냈습니다." };
  } catch (error) {
    return { message: actionError(error, "참여자를 내보낼 수 없습니다.") };
  }
}
