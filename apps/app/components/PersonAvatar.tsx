import { getAvatarTone, getInitials } from "../documentDisplay";

interface Person {
  login: string;
  fullName: string;
  avatarUrl?: string;
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
 */
export function PersonAvatar({ person, size = "sm" }: PersonAvatarProps) {
  const name = person.fullName.trim() || person.login;

  if (person.avatarUrl) {
    return (
      <img
        className={`rev-avatar rev-avatar--${size}`}
        src={person.avatarUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }

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
