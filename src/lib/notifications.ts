import type { NotificationType } from "@prisma/client";
import { prisma } from "./db";

type NotificationInput = {
  type: NotificationType;
  dedupeKey: string;
  title: string;
  message: string;
  loanId?: string | null;
  loanRequestId?: string | null;
  userId?: string | null;
};

type DiscordEmbed = {
  title: string;
  description: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
};

const KOREA_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export function formatKoreaDateTime(date: Date) {
  return KOREA_TIME_FORMATTER.format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function sendDiscordEmbed(embed: DiscordEmbed) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "GIU 보드게임 알림",
      allowed_mentions: { parse: [] },
      embeds: [embed]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${response.status} ${body}`.trim());
  }
}

export async function sendManagedDiscordNotification(input: NotificationInput, embed: DiscordEmbed) {
  const existing = await prisma.notificationLog.findUnique({
    where: { dedupeKey: input.dedupeKey },
    select: { status: true }
  });

  if (existing?.status === "SENT") {
    return { sent: false, reason: "duplicate" as const };
  }

  try {
    await sendDiscordEmbed(embed);

    await prisma.notificationLog.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {
        status: "SENT",
        title: input.title,
        message: input.message,
        errorMessage: null,
        sentAt: new Date()
      },
      create: {
        type: input.type,
        channel: "DISCORD",
        status: "SENT",
        dedupeKey: input.dedupeKey,
        loanId: input.loanId ?? null,
        loanRequestId: input.loanRequestId ?? null,
        userId: input.userId ?? null,
        title: input.title,
        message: input.message,
        sentAt: new Date()
      }
    });

    return { sent: true, reason: "sent" as const };
  } catch (error) {
    await prisma.notificationLog.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {
        status: "FAILED",
        title: input.title,
        message: input.message,
        errorMessage: errorMessage(error)
      },
      create: {
        type: input.type,
        channel: "DISCORD",
        status: "FAILED",
        dedupeKey: input.dedupeKey,
        loanId: input.loanId ?? null,
        loanRequestId: input.loanRequestId ?? null,
        userId: input.userId ?? null,
        title: input.title,
        message: input.message,
        errorMessage: errorMessage(error)
      }
    });

    console.error(`[notification:${input.dedupeKey}] ${errorMessage(error)}`);
    return { sent: false, reason: "failed" as const };
  }
}

export async function notifyReturnRequested(input: {
  loanId: string;
  loanRequestId: string;
  gameTitle: string;
  borrowerName: string;
  borrowerLoginId: string;
  borrowerStudentId?: string | null;
  dueAt: Date;
  requestedAt: Date;
  userId: string;
}) {
  const borrower = `${input.borrowerName}(${input.borrowerLoginId}${
    input.borrowerStudentId ? ` / ${input.borrowerStudentId}` : ""
  })`;
  const title = "반납 요청";
  const message = `${borrower}님이 ${input.gameTitle} 반납을 요청했습니다.`;

  return sendManagedDiscordNotification(
    {
      type: "RETURN_REQUESTED",
      dedupeKey: `return-requested:${input.loanRequestId}`,
      loanId: input.loanId,
      loanRequestId: input.loanRequestId,
      userId: input.userId,
      title,
      message
    },
    {
      title,
      description: message,
      color: 0x215c55,
      fields: [
        { name: "게임", value: input.gameTitle, inline: true },
        { name: "요청자", value: borrower, inline: true },
        { name: "반납 예정", value: formatKoreaDateTime(input.dueAt), inline: true },
        { name: "요청 시각", value: formatKoreaDateTime(input.requestedAt), inline: true }
      ]
    }
  );
}

export async function notifyLoanOverdue(input: {
  loanId: string;
  gameTitle: string;
  borrowerName: string;
  borrowerLoginId: string;
  borrowerStudentId?: string | null;
  dueAt: Date;
  userId: string;
  dedupeDate: string;
}) {
  const borrower = `${input.borrowerName}(${input.borrowerLoginId}${
    input.borrowerStudentId ? ` / ${input.borrowerStudentId}` : ""
  })`;
  const title = "반납 지연";
  const message = `${borrower}님의 ${input.gameTitle} 반납 기한이 지났습니다.`;

  return sendManagedDiscordNotification(
    {
      type: "LOAN_OVERDUE",
      dedupeKey: `loan-overdue:${input.loanId}:${input.dedupeDate}`,
      loanId: input.loanId,
      userId: input.userId,
      title,
      message
    },
    {
      title,
      description: message,
      color: 0xb3261e,
      fields: [
        { name: "게임", value: input.gameTitle, inline: true },
        { name: "대여자", value: borrower, inline: true },
        { name: "반납 예정", value: formatKoreaDateTime(input.dueAt), inline: true }
      ]
    }
  );
}
