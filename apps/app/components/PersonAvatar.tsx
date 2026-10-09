import { useState } from "react";

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
}

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
export function PersonAvatar({ person, size = "sm" }: PersonAvatarProps) {
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
