export type SessionInfo = {
  userId: string;
  userEmail: string;
  userNickname: string;
  userIsAdmin: boolean;
  userCreatedAt: string;
  userUpdatedAt: string | null;
  loggedInAt: string;
};
