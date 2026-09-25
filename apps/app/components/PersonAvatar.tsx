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

/**
 * One person's face, wherever a person appears.
 *
 * Same circle in the reviewers row, the comment header and the picker, so the
 * name beside it is the only thing that changes between them.
 *
 * **Initials, always — never the image Gitea hands back.** Nobody here uploads
 * a photo, so that image is Gitea's generated pattern: a coloured star that
 * says nothing about who it is, beside the same person drawn as "AN" in the
 * top bar, the sidebar and every list. One person had two faces depending on
 * the page. The API cannot tell a photo from a pattern, so neither is drawn.
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
      {getInitials(name)}
    </span>
  );
}
