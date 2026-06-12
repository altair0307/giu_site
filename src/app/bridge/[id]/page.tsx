import Link from "next/link";
import { redirect } from "next/navigation";
import {
  cancelMeetupWithAlertAction,
  changeBridgeSeatAction,
  completeMeetupAction,
  createBridgeDealAction,
  leaveMeetupWithAlertAction,
  logoutAction,
  makeBridgeCallAction,
  playBridgeCardAction,
  randomizeBridgeSeatsAction,
  removeMeetupParticipantAction
} from "@/app/actions";
import { BridgeActionForm } from "@/app/bridge/[id]/bridge-action-form";
import { BridgeRoundSummaryPopup } from "@/app/bridge/[id]/bridge-round-summary-popup";
import { BridgeRoomSync } from "@/app/bridge/[id]/bridge-room-sync";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const seatLabels = {
  NORTH: "North",
  EAST: "East",
  SOUTH: "South",
  WEST: "West"
} as const;

const seatOrder = ["NORTH", "EAST", "SOUTH", "WEST"] as const;
const suitLabels = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣"
} as const;
const contractSuitLabels = {
  CLUBS: "♣",
  DIAMONDS: "♦",
  HEARTS: "♥",
  SPADES: "♠",
  NOTRUMP: "NT"
} as const;
const callTypeLabels = {
  PASS: "Pass",
  BID: "Bid",
  DOUBLE: "Double",
  REDOUBLE: "Redouble"
} as const;
const doubleStatusLabels = {
  UNDOUBLED: "",
  DOUBLED: "X",
  REDOUBLED: "XX"
} as const;
const vulnerabilityLabels = {
  NONE: "취약 없음",
  NS: "North/South 취약",
  EW: "East/West 취약",
  BOTH: "양팀 취약"
} as const;
const suitOrder = ["S", "H", "D", "C"] as const;
const rankOrder = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const contractSuitOrder = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES", "NOTRUMP"] as const;

type BridgeRoomPageProps = {
  params: Promise<{ id: string }>;
};

type BridgeSuit = keyof typeof suitLabels;
type BridgeSeat = (typeof seatOrder)[number];
type BridgeRank = (typeof rankOrder)[number];

function parseCard(card: string) {
  const suit = card.slice(-1) as BridgeSuit;
  const rank = card.slice(0, -1);

  return { rank, suit };
}

function sortCards(cards: string[]) {
  return [...cards].sort((a, b) => {
    const cardA = parseCard(a);
    const cardB = parseCard(b);
    const suitDiff = suitOrder.indexOf(cardA.suit) - suitOrder.indexOf(cardB.suit);

    if (suitDiff !== 0) {
      return suitDiff;
    }

    const rankA = rankOrder.includes(cardA.rank as BridgeRank) ? rankOrder.indexOf(cardA.rank as BridgeRank) : rankOrder.length;
    const rankB = rankOrder.includes(cardB.rank as BridgeRank) ? rankOrder.indexOf(cardB.rank as BridgeRank) : rankOrder.length;

    return rankA - rankB;
  });
}

function readHands(value: unknown): Partial<Record<BridgeSeat, string[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([position]) => seatOrder.includes(position as BridgeSeat))
      .map(([position, cards]) => [
        position,
        Array.isArray(cards) ? cards.filter((card): card is string => typeof card === "string") : []
      ])
  ) as Partial<Record<BridgeSeat, string[]>>;
}

function bridgeTeam(position: BridgeSeat) {
  return position === "NORTH" || position === "SOUTH" ? "North/South" : "East/West";
}

function bridgeTeamCode(position: BridgeSeat) {
  return position === "NORTH" || position === "SOUTH" ? "NS" : "EW";
}

function isVulnerableTeam(team: ReturnType<typeof bridgeTeamCode>, vulnerability: keyof typeof vulnerabilityLabels) {
  return vulnerability === "BOTH" || vulnerability === team;
}

function relativeTableSlot(position: BridgeSeat, viewerPosition: BridgeSeat) {
  const diff = (seatOrder.indexOf(position) - seatOrder.indexOf(viewerPosition) + seatOrder.length) % seatOrder.length;

  if (diff === 0) {
    return "bottom";
  }

  if (diff === 1) {
    return "left";
  }

  if (diff === 2) {
    return "top";
  }

  return "right";
}

function formatBridgeCall(call: { type: keyof typeof callTypeLabels; level: number | null; suit: keyof typeof contractSuitLabels | null }) {
  if (call.type === "BID" && call.level && call.suit) {
    return `${call.level}${contractSuitLabels[call.suit]}`;
  }

  return callTypeLabels[call.type];
}

export default async function BridgeRoomPage({ params }: BridgeRoomPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  const room = await prisma.bridgeRoom.findUnique({
    where: { id },
    include: {
      meetup: {
        include: {
          table: true,
          participants: { select: { userId: true } }
        }
      },
      seats: {
        include: {
          user: { select: { id: true, name: true, loginId: true } }
        }
      },
      deals: {
        orderBy: { boardNumber: "desc" },
        include: {
          calls: { orderBy: { sequence: "asc" } },
          tricks: {
            include: {
              plays: {
                orderBy: { createdAt: "asc" }
              }
            },
            orderBy: { trickNumber: "desc" }
          }
        }
      }
    }
  });

  if (!room) {
    redirect("/");
  }

  const isParticipant = room.meetup.participants.some((participant) => participant.userId === user.id);

  if (!isParticipant && user.role !== "ADMIN") {
    redirect("/");
  }

  const seatsByPosition = new Map(room.seats.map((seat) => [seat.position, seat]));
  const mySeat = room.seats.find((seat) => seat.userId === user.id);
  const viewerPosition = (mySeat?.position ?? "SOUTH") as BridgeSeat;
  const hasFourSeats = room.seats.length === 4;
  const canManageRoom = room.hostId === user.id || user.role === "ADMIN";
  const sessionIsComplete = room.status === "COMPLETED";
  const activeDeal = room.deals.find((deal) => !deal.completedAt);
  const currentDeal = activeDeal ?? room.deals[0];
  const hasAnyDeal = room.deals.length > 0;
  const completedDeals = room.deals.filter((deal) => deal.completedAt).sort((a, b) => a.boardNumber - b.boardNumber);
  const sessionScore = completedDeals.reduce(
    (score, deal) => {
      if (typeof deal.score !== "number" || !deal.declarer) {
        return score;
      }

      if (bridgeTeamCode(deal.declarer) === "NS") {
        return { ns: score.ns + deal.score, ew: score.ew - deal.score };
      }

      return { ns: score.ns - deal.score, ew: score.ew + deal.score };
    },
    { ns: 0, ew: 0 }
  );
  const canCreateDeal =
    canManageRoom && !sessionIsComplete && !activeDeal && (room.status === "LOBBY" || room.status === "PLAYING");
  const canRandomizeSeats = canManageRoom && room.status === "LOBBY" && !hasAnyDeal && room.seats.length > 1;
  const canChangeSeats = canManageRoom && room.status === "LOBBY" && !hasAnyDeal && room.seats.length > 0;
  const canLeaveRoom = Boolean(mySeat && room.status === "LOBBY" && !hasAnyDeal && room.hostId !== user.id);
  const hands = readHands(currentDeal?.hands);
  const myHand = mySeat ? sortCards(hands[mySeat.position] ?? []) : [];
  const contractIsSet = Boolean(currentDeal?.contractLevel && currentDeal.contractSuit && currentDeal.declarer && currentDeal.dummy);
  const biddingIsActive = Boolean(currentDeal?.biddingTurn && !contractIsSet && !currentDeal.completedAt);
  const canBid = Boolean(biddingIsActive && mySeat?.position === currentDeal?.biddingTurn);
  const passedOut = Boolean(currentDeal?.completedAt && !currentDeal.contractLevel && typeof currentDeal.score === "number");
  const lastBid = [...(currentDeal?.calls ?? [])].reverse().find((call) => call.type === "BID");
  const currentTrick = currentDeal?.tricks[0];
  const currentTrickPlaysByPosition = new Map(currentTrick?.plays.map((play) => [play.position, play]) ?? []);
  const currentTrickWinner = currentTrick?.winner;
  const completedTricks = currentDeal?.tricks.filter((trick) => trick.winner) ?? [];
  const hasOpeningLead = currentDeal?.tricks.some((trick) => trick.plays.length > 0) ?? false;
  const targetTricks = currentDeal?.contractLevel ? currentDeal.contractLevel + 6 : null;
  const declarerTeam =
    contractIsSet && currentDeal?.declarer ? (bridgeTeam(currentDeal.declarer) as ReturnType<typeof bridgeTeam>) : null;
  const computedDeclarerWonTricks = declarerTeam
    ? completedTricks.filter((trick) => trick.winner && bridgeTeam(trick.winner) === declarerTeam).length
    : 0;
  const declarerWonTricks = currentDeal?.declarerTricks ?? computedDeclarerWonTricks;
  const roundIsComplete = Boolean(currentDeal?.completedAt);
  const dummyHand = contractIsSet && hasOpeningLead && currentDeal?.dummy ? sortCards(hands[currentDeal.dummy] ?? []) : [];
  const playablePosition =
    currentDeal?.currentTurn && mySeat
      ? currentDeal.currentTurn === currentDeal.dummy && mySeat.position === currentDeal.declarer
        ? currentDeal.dummy
        : currentDeal.currentTurn === mySeat.position
          ? mySeat.position
          : null
      : null;
  const canPlayMyHand = !sessionIsComplete && playablePosition === mySeat?.position;
  const canPlayDummyHand = !sessionIsComplete && playablePosition === currentDeal?.dummy && mySeat?.position === currentDeal?.declarer;
  const vulnerableTextIsActive = Boolean(currentDeal && currentDeal.vulnerability !== "NONE");

  return (
    <main className="app-shell">
      {!sessionIsComplete ? <BridgeRoomSync roomId={room.id} currentUserId={user.id} /> : null}
      {!sessionIsComplete && roundIsComplete && currentDeal?.id && declarerTeam && targetTricks && typeof currentDeal.score === "number" ? (
        <BridgeRoundSummaryPopup
          dealId={currentDeal.id}
          declarerTeam={declarerTeam}
          wonTricks={declarerWonTricks}
          targetTricks={targetTricks}
          contractMade={Boolean(currentDeal.contractMade)}
          overtricks={currentDeal.overtricks ?? 0}
          undertricks={currentDeal.undertricks ?? 0}
          score={currentDeal.score}
          doubleStatus={currentDeal.doubleStatus}
        />
      ) : null}
      <header className="topbar">
        <div>
          <p className="eyebrow">Bridge</p>
          <h1>{room.meetup.title}</h1>
        </div>
        <div className="account-box">
          <Link className="ghost-link" href="/">
            대여 화면
          </Link>
          <form action={logoutAction}>
            <button className="ghost-button">로그아웃</button>
          </form>
        </div>
      </header>

      <section className="bridge-room-layout">
        <aside className="panel bridge-status-panel">
          <h2>진행 상태</h2>
          {sessionIsComplete ? (
            <div className="bridge-result made">
              <strong>세션 종료</strong>
              <span>
                최종 점수 NS {sessionScore.ns} · EW {sessionScore.ew}
              </span>
            </div>
          ) : null}
          <p className="muted">
            {currentDeal
              ? (
                  <>
                    보드 {currentDeal.boardNumber} · {seatLabels[currentDeal.dealer]} 딜러 ·{" "}
                    <span className={vulnerableTextIsActive ? "bridge-vulnerability vulnerable" : "bridge-vulnerability"}>
                      {vulnerabilityLabels[currentDeal.vulnerability]}
                    </span>
                  </>
                )
              : "현재는 브릿지 로비 단계입니다."}
          </p>
          {passedOut ? (
            <div className="bridge-result">
              <strong>패스 아웃</strong>
              <span>모든 플레이어가 패스해 라운드가 0점으로 종료되었습니다.</span>
            </div>
          ) : null}
          {hasAnyDeal ? (
            <div className="bridge-summary">
              <p>
                누적 점수 <strong>NS {sessionScore.ns}</strong> · <strong>EW {sessionScore.ew}</strong>
              </p>
            </div>
          ) : null}
          {contractIsSet && currentDeal?.contractSuit && currentDeal.declarer && currentDeal.dummy ? (
            <div className="bridge-summary">
              <p>
                컨트랙트{" "}
                <strong>
                  {currentDeal.contractLevel}
                  {contractSuitLabels[currentDeal.contractSuit]}
                  {doubleStatusLabels[currentDeal.doubleStatus] ? ` ${doubleStatusLabels[currentDeal.doubleStatus]}` : ""}
                </strong>{" "}
                · 선언자{" "}
                <strong>{seatLabels[currentDeal.declarer]}</strong> · 더미 <strong>{seatLabels[currentDeal.dummy]}</strong>
              </p>
              <p className="muted">
                {currentDeal.currentTurn ? `현재 차례: ${seatLabels[currentDeal.currentTurn]}` : "라운드 완료"}
              </p>
              {targetTricks ? (
                <p className="bridge-trick-count">
                  트릭 <strong>{declarerWonTricks}/{targetTricks}</strong>
                </p>
              ) : null}
              {roundIsComplete && typeof currentDeal.score === "number" ? (
                <div className={currentDeal.contractMade ? "bridge-result made" : "bridge-result failed"}>
                  <strong>{currentDeal.contractMade ? "계약 성공" : "계약 실패"}</strong>
                  <span>
                    {currentDeal.contractMade
                      ? `초과 트릭 ${currentDeal.overtricks ?? 0} · 선언자 점수 +${currentDeal.score}`
                      : `부족 트릭 ${currentDeal.undertricks ?? 0} · 선언자 점수 ${currentDeal.score}`}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          {!sessionIsComplete && biddingIsActive && currentDeal?.biddingTurn ? (
            <div className="bridge-bidding-panel">
              <div>
                <strong>비딩 차례</strong>
                <p className="muted">{seatLabels[currentDeal.biddingTurn]}</p>
              </div>
              <div>
                <strong>마지막 입찰</strong>
                <p className="muted">{lastBid ? formatBridgeCall(lastBid) : "아직 입찰 없음"}</p>
              </div>
              {canBid ? (
                <BridgeActionForm className="bridge-call-form" action={makeBridgeCallAction}>
                  <input type="hidden" name="roomId" value={room.id} />
                  <div className="bridge-call-buttons">
                    <button className="ghost-button" name="callType" value="DOUBLE">
                      Double
                    </button>
                    <button className="ghost-button" name="callType" value="REDOUBLE">
                      Redouble
                    </button>
                  </div>
                  <div className="bridge-bid-row">
                    <label>
                      레벨
                      <select name="level" defaultValue="1">
                        {[1, 2, 3, 4, 5, 6, 7].map((bidLevel) => (
                          <option value={bidLevel} key={bidLevel}>
                            {bidLevel}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      무늬
                      <select name="suit" defaultValue="CLUBS">
                        {contractSuitOrder.map((contractSuit) => (
                          <option value={contractSuit} key={contractSuit}>
                            {contractSuitLabels[contractSuit]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="primary-button" name="callType" value="BID">
                      Bid
                    </button>
                    <button className="secondary-button" name="callType" value="PASS">
                      Pass
                    </button>
                  </div>
                </BridgeActionForm>
              ) : (
                <p className="form-note">내 비딩 차례가 되면 콜 버튼이 활성화됩니다.</p>
              )}
            </div>
          ) : null}
          {canCreateDeal ? (
            <div className="bridge-lobby-actions">
              {canRandomizeSeats ? (
                <form action={randomizeBridgeSeatsAction}>
                  <input type="hidden" name="roomId" value={room.id} />
                  <button className="ghost-button">자리 섞기</button>
                </form>
              ) : null}
              <form action={createBridgeDealAction}>
                <input type="hidden" name="roomId" value={room.id} />
                <button className="secondary-button" disabled={!hasFourSeats}>
                  {hasAnyDeal ? "다음 딜 시작" : "딜 생성"}
                </button>
              </form>
            </div>
          ) : null}
          {canChangeSeats ? (
            <BridgeActionForm className="bridge-seat-change-form" action={changeBridgeSeatAction}>
              <input type="hidden" name="roomId" value={room.id} />
              <label>
                참여자
                <select name="userId" defaultValue={mySeat?.userId ?? room.seats[0]?.userId}>
                  {room.seats.map((seat) => (
                    <option value={seat.userId} key={seat.userId}>
                      {seat.user.name} · {seatLabels[seat.position]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                좌석
                <select name="position" defaultValue="NORTH">
                  {seatOrder.map((position) => {
                    const seat = seatsByPosition.get(position);

                    return (
                      <option value={position} key={position}>
                        {seatLabels[position]}{seat ? ` · ${seat.user.name}` : " · 빈 자리"}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button className="secondary-button">좌석 변경</button>
            </BridgeActionForm>
          ) : null}
          {canManageRoom && canChangeSeats ? (
            <div className="bridge-participant-actions">
              <strong>참여자 관리</strong>
              {room.seats.map((seat) => (
                <div className="bridge-participant-action-row" key={seat.userId}>
                  <span>
                    {seat.user.name} · {seatLabels[seat.position]}
                  </span>
                  {seat.userId !== room.hostId ? (
                    <BridgeActionForm action={removeMeetupParticipantAction}>
                      <input type="hidden" name="meetupId" value={room.meetupId} />
                      <input type="hidden" name="userId" value={seat.userId} />
                      <button className="ghost-button">내보내기</button>
                    </BridgeActionForm>
                  ) : (
                    <small className="muted">방장</small>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {!currentDeal && !hasFourSeats ? <p className="form-note">참여자 4명이 모두 좌석에 앉으면 딜을 생성할 수 있습니다.</p> : null}
          {canLeaveRoom ? (
            <BridgeActionForm className="danger-actions" action={leaveMeetupWithAlertAction}>
              <input type="hidden" name="meetupId" value={room.meetupId} />
              <input type="hidden" name="returnTo" value="/" />
              <button className="ghost-button">방 나가기</button>
            </BridgeActionForm>
          ) : null}
          {canManageRoom ? (
            <div className="danger-actions">
              {!sessionIsComplete ? (
                <form action={completeMeetupAction}>
                  <input type="hidden" name="meetupId" value={room.meetupId} />
                  <input type="hidden" name="returnTo" value={`/bridge/${room.id}`} />
                  <button className="secondary-button">세션 종료</button>
                </form>
              ) : null}
              <BridgeActionForm action={cancelMeetupWithAlertAction}>
                <input type="hidden" name="meetupId" value={room.meetupId} />
                <input type="hidden" name="returnTo" value="/" />
                <button className="ghost-button">{sessionIsComplete ? "결과 삭제" : "방 취소"}</button>
              </BridgeActionForm>
            </div>
          ) : null}
        </aside>

        <article className="panel bridge-table-panel">
          <div className="section-heading">
            <h2>브릿지 테이블</h2>
            <span className="badge green">{room.status}</span>
          </div>
          <p className="muted">{room.meetup.table.name} · 좌석 4명</p>
          <div className="bridge-seat-grid">
            {seatOrder.map((position) => {
              const seat = seatsByPosition.get(position);
              const play = currentTrickPlaysByPosition.get(position);
              const tableSlot = relativeTableSlot(position, viewerPosition);
              const isDeclarer = currentDeal?.declarer === position;
              const isVulnerableSeat = currentDeal ? isVulnerableTeam(bridgeTeamCode(position), currentDeal.vulnerability) : false;

              return (
                <div className={`bridge-seat ${tableSlot}${isDeclarer ? " declarer" : ""}`} key={position}>
                  <span className={isVulnerableSeat ? "vulnerable-seat" : ""}>{seatLabels[position]}</span>
                  <strong>
                    {isDeclarer ? <span className="declarer-star" aria-label="선언자">★</span> : null}
                    {seat?.user.name ?? "빈 자리"}
                  </strong>
                  {seat ? <small>{seat.user.loginId}</small> : null}
                  {play ? <small className="bridge-played-marker">카드 냄</small> : null}
                </div>
              );
            })}
            <div className="bridge-table-center">
              {seatOrder.map((position) => {
                const play = currentTrickPlaysByPosition.get(position);
                const tableSlot = relativeTableSlot(position, viewerPosition);

                if (!play) {
                  return (
                    <div className={`bridge-table-play ${tableSlot}`} key={position}>
                      <span>{seatLabels[position]}</span>
                      <div className="bridge-card-placeholder" />
                    </div>
                  );
                }

                const { rank, suit } = parseCard(play.card);
                const isRed = suit === "H" || suit === "D";

                return (
                  <div className={`bridge-table-play ${tableSlot}`} key={position}>
                    <span>{seatLabels[position]}</span>
                    <article className={isRed ? "playing-card red" : "playing-card"}>
                      <span className="playing-card-rank">{rank}</span>
                      <span className="playing-card-suit">{suitLabels[suit]}</span>
                    </article>
                  </div>
                );
              })}
              {currentTrickWinner ? (
                <div className="bridge-trick-result">
                  <strong>{bridgeTeam(currentTrickWinner)}</strong>
                  <span>{seatLabels[currentTrickWinner]} 승</span>
                </div>
              ) : null}
            </div>
          </div>
        </article>
      </section>

      {currentDeal ? (
        <section className="section-block">
          <div className="section-heading">
            <h2>비딩 기록</h2>
            <span>{currentDeal.calls.length}콜</span>
          </div>
          {currentDeal.calls.length > 0 ? (
            <div className="bridge-call-history">
              {currentDeal.calls.map((call) => (
                <div className="bridge-call-item" key={call.id}>
                  <span>{seatLabels[call.position]}</span>
                  <strong>{formatBridgeCall(call)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">아직 비딩 기록이 없습니다.</p>
          )}
        </section>
      ) : null}

      {completedDeals.length > 0 ? (
        <section className="section-block">
          <div className="section-heading">
            <h2>보드 결과</h2>
            <span>NS {sessionScore.ns} · EW {sessionScore.ew}</span>
          </div>
          <div className="bridge-call-history">
            {completedDeals.map((deal) => {
              const declarerSide = deal.declarer ? bridgeTeamCode(deal.declarer) : null;
              const nsScore = typeof deal.score === "number" ? (declarerSide === "NS" ? deal.score : declarerSide === "EW" ? -deal.score : 0) : 0;
              const ewScore = nsScore * -1;
              const contractText =
                deal.contractLevel && deal.contractSuit && deal.declarer
                  ? `${deal.contractLevel}${contractSuitLabels[deal.contractSuit]}${doubleStatusLabels[deal.doubleStatus] ? ` ${doubleStatusLabels[deal.doubleStatus]}` : ""} · ${seatLabels[deal.declarer]}`
                  : "패스 아웃";

              return (
                <div className="bridge-call-item" key={deal.id}>
                  <span>보드 {deal.boardNumber} · {contractText}</span>
                  <strong>
                    NS {nsScore} · EW {ewScore}
                  </strong>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {!sessionIsComplete ? (
      <section className="section-block">
        <div className="section-heading">
          <h2>현재 트릭</h2>
          <span>{currentTrick ? `${currentTrick.trickNumber}번째` : "대기"}</span>
        </div>
        {currentTrick ? (
          <div className="bridge-trick-row">
            {currentTrick.plays.map((play) => {
              const { rank, suit } = parseCard(play.card);
              const isRed = suit === "H" || suit === "D";

              return (
                <div className="bridge-trick-card" key={play.id}>
                  <span>{seatLabels[play.position]}</span>
                  <article className={isRed ? "playing-card red" : "playing-card"}>
                    <span className="playing-card-rank">{rank}</span>
                    <span className="playing-card-suit">{suitLabels[suit]}</span>
                  </article>
                </div>
              );
            })}
            {currentTrick.plays.length === 0 ? <p className="empty">아직 낸 카드가 없습니다.</p> : null}
            {currentTrickWinner ? (
              <p className="bridge-trick-winner">
                {bridgeTeam(currentTrickWinner)} 팀이 {currentTrick.trickNumber}번째 트릭을 가져갔습니다.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="empty">컨트랙트가 확정되면 첫 트릭이 시작됩니다.</p>
        )}
      </section>
      ) : null}

      {!sessionIsComplete && dummyHand.length > 0 && currentDeal?.dummy ? (
        <section className="section-block">
          <div className="section-heading">
            <h2>더미 손패</h2>
            <span>{seatLabels[currentDeal.dummy]}</span>
          </div>
          <div className="bridge-hand">
            {dummyHand.map((card) => {
              const { rank, suit } = parseCard(card);
              const isRed = suit === "H" || suit === "D";

              if (canPlayDummyHand) {
                return (
                  <BridgeActionForm action={playBridgeCardAction} key={card}>
                    <input type="hidden" name="roomId" value={room.id} />
                    <input type="hidden" name="card" value={card} />
                    <button className={isRed ? "playing-card red playable" : "playing-card playable"}>
                      <span className="playing-card-rank">{rank}</span>
                      <span className="playing-card-suit">{suitLabels[suit]}</span>
                    </button>
                  </BridgeActionForm>
                );
              }

              return (
                <article className={isRed ? "playing-card red" : "playing-card"} key={card}>
                  <span className="playing-card-rank">{rank}</span>
                  <span className="playing-card-suit">{suitLabels[suit]}</span>
                </article>
              );
            })}
          </div>
        </section>
      ) : !sessionIsComplete && contractIsSet && currentDeal?.dummy ? (
        <section className="section-block">
          <div className="section-heading">
            <h2>더미 손패</h2>
            <span>{seatLabels[currentDeal.dummy]}</span>
          </div>
          <p className="empty">선플레이어가 첫 카드를 낸 뒤 공개됩니다.</p>
        </section>
      ) : null}

      {!sessionIsComplete ? (
      <section className="section-block">
        <div className="section-heading">
          <h2>내 손패</h2>
          <span>{mySeat ? `${seatLabels[mySeat.position]}${canPlayMyHand ? " · 내 차례" : ""}` : "관전"}</span>
        </div>
        {myHand.length > 0 ? (
          <div className="bridge-hand">
            {myHand.map((card) => {
              const { rank, suit } = parseCard(card);
              const isRed = suit === "H" || suit === "D";

              if (canPlayMyHand) {
                return (
                  <BridgeActionForm action={playBridgeCardAction} key={card}>
                    <input type="hidden" name="roomId" value={room.id} />
                    <input type="hidden" name="card" value={card} />
                    <button className={isRed ? "playing-card red playable" : "playing-card playable"}>
                      <span className="playing-card-rank">{rank}</span>
                      <span className="playing-card-suit">{suitLabels[suit]}</span>
                    </button>
                  </BridgeActionForm>
                );
              }

              return (
                <article className={isRed ? "playing-card red" : "playing-card"} key={card}>
                  <span className="playing-card-rank">{rank}</span>
                  <span className="playing-card-suit">{suitLabels[suit]}</span>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="empty">아직 생성된 딜이 없습니다.</p>
        )}
      </section>
      ) : null}
    </main>
  );
}
