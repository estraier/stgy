export type SessionInfo = {
  userId: string;
  userEmail: string;
  userNickname: string;
  userIsAdmin: boolean;
  userIsFrozen: boolean;
  userCreatedAt: string;
  userUpdatedAt: string | null;
  userLocale: string;
  userTimezone: string;
  loggedInAt: string;
  requiredAgreementTermId: string | null;
};

export type AuthenticatedUser = {
  id: string;
  isAdmin: boolean;
  isFrozen: boolean;
};
