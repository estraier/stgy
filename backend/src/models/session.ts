export type SessionInfo = {
  userId: string;
  userEmail: string;
  userNickname: string;
  userIsAdmin: boolean;
  userCreatedAt: string;
  userUpdatedAt: string | null;
  userLocale: string;
  userTimezone: string;
  loggedInAt: string;
};
