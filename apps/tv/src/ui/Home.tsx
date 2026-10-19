import type { Member } from "@open-game-system/ogs-protocol";
import { useState } from "react";
import { cardChip, cardResume, spotLine } from "../launcher/facts";
import type { Art, CardModel, HomeModel, IconModel } from "../launcher/home";
import { clock } from "../launcher/layout";
import { type CouchSession, stickerUrl } from "../session/data";
import { safeStyle } from "./art";
import { Couch } from "./Couch";
import { roomTitle } from "./copy";
import { JoinCode } from "./JoinCode";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** What the room shows: the focused game, or the Surprise card's shuffle. */
type Spot = { kind: "game"; icon: IconModel } | { kind: "surprise"; room: Art } | null;

function spotOf(home: HomeModel, focus: string | null): Spot {
  const icon = home.icons.find((i) => i.itemId === focus);
  if (icon) return { kind: "game", icon };
  const card = home.cards.find((c) => c.itemId === focus);
  if (card?.kind === "surprise") return { kind: "surprise", room: card.room };
  const game = card && home.icons.find((i) => i.appId === card.appId);
  if (game) return { kind: "game", icon: game };
  const first = home.icons[0];
  return first ? { kind: "game", icon: first } : null;
}

/**
 * PS5-style home: the focused game's art fills the room with its logo in the left third, a row of
 * game icons across the top, and activity cards (sittings to jump back into, Surprise me) below.
 */
export function Home(props: {
  home: HomeModel;
  focus: string | null;
  session: CouchSession;
  members: Member[];
  /** Who played each game last time (its roster), for the spotlight. */
  playersOf: (appId: string) => Member[];
  remoteHolder: string | null;
  now: number;
}) {
  const { home, focus, session, now } = props;
  const spot = spotOf(home, focus);
  const inCards = home.cards.some((c) => c.itemId === focus);
  const spotApp = spot?.kind === "game" ? spot.icon.appId : null;
  const zone = inCards ? "cards" : "icons";
  const spotResume = spot?.kind === "game" ? spotLine(spot.icon, zone).resume : "";
  return (
    <div className="screen home" data-testid="home" data-zone={inCards ? "cards" : "icons"}>
      <Room spot={spot} />
      <header className="topbar">
        <h1 className="room-name">{roomTitle(session.tvName, session.host.name)}</h1>
        <div className="clock">
          <span className="clock-time">{clock(now)}</span>
          <span className="clock-day">{WEEKDAYS[new Date(now).getDay()]}</span>
        </div>
      </header>
      {home.icons.length > 0 ? (
        <div className="icon-row" data-row="games">
          {home.icons.map((i) => (
            <GameIcon
              key={i.itemId}
              icon={i}
              focused={i.itemId === focus}
              current={inCards && spot?.kind === "game" && spot.icon.appId === i.appId}
            />
          ))}
        </div>
      ) : (
        <EmptyHero name={props.remoteHolder} />
      )}
      {spot && (
        <Spotlight
          spot={spot}
          zone={zone}
          players={spot.kind === "game" ? props.playersOf(spot.icon.appId) : []}
        />
      )}
      {home.cards.length > 0 && (
        <div className="cards" data-row="activity">
          {home.cards.map((c) => (
            <Card
              key={c.itemId}
              card={c}
              focused={c.itemId === focus}
              chip={c.kind === "sitting" ? cardChip(c, spotApp) : ""}
              resume={c.kind === "sitting" ? cardResume(c, spotApp, spotResume) : ""}
            />
          ))}
        </div>
      )}
      <aside className="people">
        <Couch members={props.members} />
        {props.remoteHolder && (
          <div className="remote-chip" data-testid="remote-chip">
            <RemoteIcon />
            {props.remoteHolder} has the remote
          </div>
        )}
      </aside>
      <JoinCode code={session.code} />
    </div>
  );
}

/** The whole room is the focused game's clean hero; the last one stays under it while it fades in. */
function Room({ spot }: { spot: Spot }) {
  const art = spot ? (spot.kind === "game" ? spot.icon.room : spot.room) : null;
  const id = spot?.kind === "game" ? spot.icon.appId : spot ? "surprise" : "";
  const [layers, setLayers] = useState<Art[]>(art ? [art] : []);
  if (art && layers.at(-1)?.src !== art.src) setLayers([...layers.slice(-1), art]);
  return (
    <div
      className="room"
      data-testid="hero"
      data-hero={id}
      data-surprise={spot?.kind === "surprise" || undefined}
    >
      {layers.map((l, n) => (
        <img
          key={l.src}
          className={`room-art${n === layers.length - 1 ? " in" : ""}${l.captured ? " captured" : ""}`}
          src={l.src}
          alt=""
          style={safeStyle(l.safe)}
        />
      ))}
      <div className="room-scrim" />
    </div>
  );
}

/** An icon; `current` is the game of the focused card: it stays large and named, without the ring. */
function GameIcon(props: { icon: IconModel; focused: boolean; current: boolean }) {
  const { icon, focused, current } = props;
  return (
    <div
      className={`game-icon${focused ? " focused" : ""}${current ? " current" : ""}`}
      data-item={icon.itemId}
      data-focused={focused || undefined}
    >
      <div className="game-icon-art" data-cover={icon.appId}>
        <img src={icon.icon.src} alt="" style={safeStyle(icon.icon.safe)} />
        {icon.tag.startsWith("Paused") && <span className="game-icon-dot" aria-hidden="true" />}
      </div>
      <span className="game-icon-name">{icon.name}</span>
    </div>
  );
}

/**
 * The left third: the game's logo, large, and where you left off. The only place the focused
 * game's status and tagline are said (its card doesn't repeat them).
 */
function Spotlight(props: { spot: NonNullable<Spot>; zone: "icons" | "cards"; players: Member[] }) {
  const { spot, players } = props;
  if (spot.kind === "surprise")
    return (
      <div className="spotlight" key="surprise">
        <p className="spot-wordmark">Surprise me</p>
        <p className="spot-line">A game picked at random</p>
      </div>
    );
  const { icon } = spot;
  const line = spotLine(icon, props.zone);
  return (
    <div className="spotlight" key={icon.appId}>
      {icon.logo ? (
        <img className="spot-logo" src={icon.logo} alt={icon.name} />
      ) : (
        <p className="spot-wordmark">{icon.name}</p>
      )}
      <p className="spot-line">
        {line.tag && <span className="spot-tag">{line.tag}</span>}
        {line.resume && <span className="spot-resume">{line.resume}</span>}
        {!line.tag && <span className="spot-resume">{line.tagline}</span>}
      </p>
      {line.tag && line.tagline && <p className="spot-tagline">{line.tagline}</p>}
      {players.length > 0 && (
        <p className="spot-players" data-testid="spot-players">
          {players.map((m) => (
            <img key={m.profileId} src={stickerUrl(m.sticker)} alt="" />
          ))}
          <span>Played last time</span>
        </p>
      )}
    </div>
  );
}

/** `chip` and `resume`: "" on the spotlit game's card when the spotlight already says them. */
function Card(props: { card: CardModel; focused: boolean; chip: string; resume: string }) {
  const { card, focused, chip, resume } = props;
  const common = {
    "data-item": card.itemId,
    "data-focused": focused || undefined,
  };
  if (card.kind === "again")
    return (
      <div
        className={`card again${focused ? " focused" : ""}`}
        data-card="again"
        data-app={card.appId}
        {...common}
      >
        <div className="card-art" data-cover-card={card.appId}>
          <img src={card.art.src} alt="" style={safeStyle(card.art.safe)} />
          <span className="card-tag">{card.chip}</span>
          <PlayMark />
        </div>
        <span className="card-name">{card.name}</span>
        <span className="card-resume">{card.tag}</span>
      </div>
    );
  if (card.kind === "surprise")
    return (
      <div className={`card surprise${focused ? " focused" : ""}`} data-card="surprise" {...common}>
        <div className="card-art surprise-art" data-cover-card="surprise">
          <img src={card.art.src} alt="" />
        </div>
        <span className="card-name">Surprise me</span>
        <span className="card-resume">A game for the kids</span>
      </div>
    );
  return (
    <div
      className={`card${focused ? " focused" : ""}`}
      data-card="sitting"
      data-app={card.appId}
      data-upcoming={card.upcoming || undefined}
      {...common}
    >
      <div className="card-art" data-cover-card={card.appId}>
        <img src={card.art.src} alt="" style={safeStyle(card.art.safe)} />
        {chip && <span className="card-tag">{chip}</span>}
        {card.upcoming ? <ClockMark /> : <PlayMark />}
      </div>
      <span className="card-name">{card.name}</span>
      {resume && <span className="card-resume">{resume}</span>}
    </div>
  );
}

function EmptyHero({ name }: { name: string | null }) {
  return (
    <div className="spotlight empty" data-testid="empty">
      <p className="spot-wordmark">No games yet</p>
      <p className="spot-line">Add games on {name ? `${name}'s` : "your"} phone, in Library</p>
    </div>
  );
}

/** A play triangle: this card jumps straight back in. */
function PlayMark() {
  return (
    <svg className="play-mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="rgba(23,11,31,0.72)" />
      <path d="M19 14 L35 24 L19 34 Z" fill="currentColor" />
    </svg>
  );
}

/** A clock: tonight's game night is on the calendar, not paused. */
function ClockMark() {
  return (
    <svg className="play-mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="rgba(23,11,31,0.72)" />
      <circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path
        d="M24 17 V24 L29 28"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function RemoteIcon() {
  return (
    <svg className="remote-icon" viewBox="0 0 20 32" aria-hidden="true">
      <rect
        x="2"
        y="1"
        width="16"
        height="30"
        rx="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <circle cx="10" cy="10" r="3" fill="currentColor" />
    </svg>
  );
}
