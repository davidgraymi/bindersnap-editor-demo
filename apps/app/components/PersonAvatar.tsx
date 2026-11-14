import { useEffect, useId, useRef, useState } from "react";

import { avatarUrl } from "../avatar";
import { getAvatarTone, getInitials } from "../documentDisplay";

interface Person {
  login: string;
  fullName: string;
}

interface PersonAvatarProps {
  person: Person;
  /** 24px in a card header, 26px in the reviewers row, 32px in the nav. */
  size?: "sm" | "md";
  /**
   * A hover card: the face, full name, `@username`, and why this person is on
   * this screen ("Infection Control · signs off on this folder"). `true` for
   * the card with no context line. Left off where the face sits inside a
   * button or a picker's option, which cannot hold a second control.
   */
  card?: string | true;
}

/** How long a pointer rests on a face before its card opens. */
const CARD_DELAY_MS = 300;

const DRAWN_SIZE = { sm: 24, md: 26 } as const;

/**
 * One person's face, wherever a person appears.
 *
 * Same circle in the reviewers row, the comment header, the picker, the top
 * bar and the sidebar, so the name beside it is the only thing that changes.
 *
 * **The pattern the API draws for them.** Initials alone
 * made a room of people look alike. The image comes from the API, by login,
 * so it is the same image on every page — the reason pull request 533 dropped Gitea's
 * pictures was that one person had two faces, and that cannot happen here.
 * The initials stay underneath, for the moment before the image arrives and
 * for an image that never does.
 */
export function PersonAvatar({ person, size = "sm", card }: PersonAvatarProps) {
  if (card !== undefined) {
    return (
      <PersonCardTrigger
        person={person}
        size={size}
        context={card === true ? null : card}
      />
    );
  }
  return <Face person={person} size={size} />;
}

function Face({ person, size }: { person: Person; size: "sm" | "md" }) {
  const name = person.fullName.trim() || person.login;

  return (
    <span
      className={`rev-avatar rev-avatar--${size} rev-avatar--tone${getAvatarTone(
        person.login,
      )}`}
      aria-hidden="true"
    >
      <AvatarFace
        login={person.login}
        initials={getInitials(name)}
        drawnSize={DRAWN_SIZE[size]}
      />
    </span>
  );
}

/**
 * A face that opens a card about the person.
 *
 * **Accessibility is the point of it.** The face is focusable and named; the
 * card opens on hover (after a moment), on keyboard focus and on tap, closes
 * on Escape and on blur, and is tied to the face with `aria-describedby`. It
 * never holds the only copy of something a person must do: everything on it
 * is already on the screen it describes, or is the person's name.
 */
function PersonCardTrigger({
  person,
  size,
  context,
}: {
  person: Person;
  size: "sm" | "md";
  context: string | null;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const name = person.fullName.trim() || person.login;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span
      className="person-card-anchor"
      tabIndex={0}
      role="img"
      aria-label={name}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => {
        clear();
        timer.current = setTimeout(() => setOpen(true), CARD_DELAY_MS);
      }}
      onMouseLeave={() => {
        clear();
        setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(event) => {
        // A tap: there is no hover on a touch screen.
        event.stopPropagation();
        setOpen((was) => !was);
      }}
    >
      <Face person={person} size={size} />
      {open ? (
        <span className="person-card" role="tooltip" id={id}>
          <Face person={person} size="md" />
          <span className="person-card-text">
            <span className="person-card-name">{name}</span>
            <span className="person-card-login">@{person.login}</span>
            {context ? (
              <span className="person-card-context">{context}</span>
            ) : null}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The image over the initials, inside whatever circle the caller draws.
 *
 * For the top bar and the sidebar, which draw their own circle.
 */
export function AvatarFace({
  login,
  initials,
  drawnSize,
}: {
  login: string;
  initials: string;
  drawnSize: number;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <>
      {initials}
      {login && !failed ? (
        <img
          className="avatar-face"
          src={avatarUrl(login, drawnSize)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : null}
    </>
  );
}
